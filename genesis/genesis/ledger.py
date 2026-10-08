"""Double-entry financial ledger.

Sign convention: positive line amount = debit, negative = credit.
Every entry must balance (lines sum to zero).

Chart of accounts (prefix determines type):

  asset:treasury                      unallocated ecosystem USDC (in master wallet)
  asset:reimbursement_reserve         USDC earmarked to repay operator-paid costs
  asset:agent:<id>:cash               agent operating allocation (sub-ledger of master wallet)
  asset:agent:<id>:receivable         revenue earned but not yet collected
  asset:agent:<id>:positions          open spot positions at cost
  liability:agent:<id>:payable        agent's accrued, unpaid obligations
  liability:operator_payable          costs the administrator paid on the ecosystem's behalf
  equity:contributed                  administrator capital contributions
  equity:distributions                profit paid to the administrator (contra-equity)
  income:revenue                      verified external revenue
  income:trading_gain                 realized trading gains
  expense:<category>                  operating expenses, incl. expense:trading_loss

Wallet-held accounts (what the on-chain master treasury balance must equal):
treasury + reimbursement_reserve + every agent cash account.
"""
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .errors import LedgerError
from .models import JournalEntry, JournalLine

EXPENSE_CATEGORIES = (
    "claude_api",
    "external_api",
    "compute",
    "hosting",
    "trading_fees",
    "blockchain_fees",
    "payment_fees",
    "software",
    "marketing",
    "business",
    "other",
    "trading_loss",
)

# Entry kinds. Only REVENUE / TRADE_SELL can create income; nothing internal can.
CONTRIBUTION = "capital_contribution"
ALLOCATION = "capital_allocation"
REVENUE = "revenue"
COLLECTION = "collection"
EXPENSE = "expense"
ACCRUAL = "expense_accrual"
SETTLEMENT = "payable_settlement"
TRADE_BUY = "trade_buy"
TRADE_SELL = "trade_sell"
REPRODUCTION = "reproduction_funding"
INTERNAL_TRANSFER = "internal_transfer"
ESTATE_SWEEP = "estate_sweep"
DISTRIBUTION = "profit_distribution"
REIMBURSEMENT = "operator_reimbursement"

INTERNAL_KINDS = {ALLOCATION, REPRODUCTION, INTERNAL_TRANSFER, ESTATE_SWEEP, COLLECTION, SETTLEMENT}
INCOME_ALLOWED_KINDS = {REVENUE, TRADE_SELL}


class A:
    """Account code helpers."""

    TREASURY = "asset:treasury"
    REIMB_RESERVE = "asset:reimbursement_reserve"
    OPERATOR_PAYABLE = "liability:operator_payable"
    CONTRIBUTED = "equity:contributed"
    DISTRIBUTIONS = "equity:distributions"
    REVENUE = "income:revenue"
    TRADING_GAIN = "income:trading_gain"

    @staticmethod
    def cash(agent_id: str) -> str:
        return f"asset:agent:{agent_id}:cash"

    @staticmethod
    def receivable(agent_id: str) -> str:
        return f"asset:agent:{agent_id}:receivable"

    @staticmethod
    def positions(agent_id: str) -> str:
        return f"asset:agent:{agent_id}:positions"

    @staticmethod
    def payable(agent_id: str) -> str:
        return f"liability:agent:{agent_id}:payable"

    @staticmethod
    def expense(category: str) -> str:
        if category not in EXPENSE_CATEGORIES:
            raise LedgerError(f"unknown expense category {category!r}")
        return f"expense:{category}"


ACCOUNT_TYPES = ("asset", "liability", "equity", "income", "expense")


def account_type(code: str) -> str:
    kind = code.split(":", 1)[0]
    if kind not in ACCOUNT_TYPES:
        raise LedgerError(f"invalid account code {code!r}")
    return kind


def is_wallet_held(code: str) -> bool:
    return code in (A.TREASURY, A.REIMB_RESERVE) or (code.startswith("asset:agent:") and code.endswith(":cash"))


class Line:
    __slots__ = ("account", "amount", "agent_id", "category")

    def __init__(self, account: str, amount: int, agent_id: str | None = None, category: str | None = None):
        self.account = account
        self.amount = int(amount)
        self.agent_id = agent_id
        self.category = category


class Ledger:
    def __init__(self, session: Session):
        self.s = session

    # ------------------------------------------------------------------ posting
    def post(
        self,
        *,
        kind: str,
        lines: list[Line],
        ts: datetime,
        agent_id: str | None = None,
        description: str = "",
        counterparty_agent_id: str | None = None,
        external_ref: str | None = None,
        evidence_source: str | None = None,
        simulated: bool = True,
        idempotency_key: str | None = None,
        created_by: str = "core",
        meta: dict | None = None,
    ) -> JournalEntry:
        if not lines:
            raise LedgerError("entry has no lines")
        total = 0
        for ln in lines:
            if not isinstance(ln.amount, int) or ln.amount == 0:
                raise LedgerError("line amounts must be non-zero integers")
            atype = account_type(ln.account)
            if atype == "income" and kind not in INCOME_ALLOWED_KINDS:
                # Internal transfers, contributions and allocations can never be revenue.
                raise LedgerError(f"entry kind {kind!r} may not touch income accounts")
            total += ln.amount
        if total != 0:
            raise LedgerError(f"unbalanced entry (sum={total})")
        if idempotency_key is not None:
            existing = self.s.scalar(select(JournalEntry).where(JournalEntry.idempotency_key == idempotency_key))
            if existing is not None:
                raise LedgerError(f"duplicate entry {idempotency_key!r}", code="duplicate")

        entry = JournalEntry(
            ts=ts,
            kind=kind,
            agent_id=agent_id,
            counterparty_agent_id=counterparty_agent_id,
            description=description,
            external_ref=external_ref,
            evidence_source=evidence_source,
            simulated=simulated,
            idempotency_key=idempotency_key,
            created_by=created_by,
            meta=meta or {},
        )
        for ln in lines:
            entry.lines.append(
                JournalLine(account=ln.account, agent_id=ln.agent_id, amount=ln.amount, category=ln.category, ts=ts)
            )
        self.s.add(entry)
        self.s.flush()
        return entry

    # ------------------------------------------------------------------ queries
    def balance(self, account: str, *, until: datetime | None = None) -> int:
        q = select(func.coalesce(func.sum(JournalLine.amount), 0)).where(JournalLine.account == account)
        if until is not None:
            q = q.where(JournalLine.ts <= until)
        return int(self.s.scalar(q))

    def agent_balances(self, agent_id: str) -> dict[str, int]:
        rows = self.s.execute(
            select(JournalLine.account, func.sum(JournalLine.amount))
            .where(JournalLine.agent_id == agent_id)
            .group_by(JournalLine.account)
        ).all()
        return {acct: int(total) for acct, total in rows}

    def all_agent_balances(self) -> dict[str, dict[str, int]]:
        rows = self.s.execute(
            select(JournalLine.agent_id, JournalLine.account, func.sum(JournalLine.amount))
            .where(JournalLine.agent_id.is_not(None))
            .group_by(JournalLine.agent_id, JournalLine.account)
        ).all()
        out: dict[str, dict[str, int]] = defaultdict(dict)
        for agent_id, acct, total in rows:
            out[agent_id][acct] = int(total)
        return out

    def _sum_prefix(self, prefix: str, *, agent_id=None, start=None, end=None) -> int:
        q = select(func.coalesce(func.sum(JournalLine.amount), 0)).where(JournalLine.account.like(prefix + "%"))
        if agent_id is not None:
            q = q.where(JournalLine.agent_id == agent_id)
        if start is not None:
            q = q.where(JournalLine.ts > start)
        if end is not None:
            q = q.where(JournalLine.ts <= end)
        return int(self.s.scalar(q))

    def income(self, **kw) -> int:
        return -self._sum_prefix("income:", **kw)

    def revenue(self, **kw) -> int:
        return -self._sum_prefix("income:revenue", **kw)

    def expenses(self, **kw) -> int:
        return self._sum_prefix("expense:", **kw)

    def realized_profit(self, **kw) -> int:
        """Realized net profit = income - expenses. Excludes unrealized gains,
        contributions and internal transfers by construction."""
        return self.income(**kw) - self.expenses(**kw)

    def expenses_by_category(self, *, agent_id=None, start=None, end=None) -> dict[str, int]:
        q = select(JournalLine.account, func.sum(JournalLine.amount)).where(JournalLine.account.like("expense:%"))
        if agent_id is not None:
            q = q.where(JournalLine.agent_id == agent_id)
        if start is not None:
            q = q.where(JournalLine.ts > start)
        if end is not None:
            q = q.where(JournalLine.ts <= end)
        rows = self.s.execute(q.group_by(JournalLine.account)).all()
        return {acct.split(":", 1)[1]: int(total) for acct, total in rows}

    def operating_spend(self, *, agent_id=None, start=None, end=None, category=None) -> int:
        """Cash operating spend (excludes trading losses, which are not a spend)."""
        q = select(func.coalesce(func.sum(JournalLine.amount), 0)).where(
            JournalLine.account.like("expense:%"), JournalLine.account != "expense:trading_loss"
        )
        if category is not None:
            q = q.where(JournalLine.account == A.expense(category))
        if agent_id is not None:
            q = q.where(JournalLine.agent_id == agent_id)
        if start is not None:
            q = q.where(JournalLine.ts > start)
        if end is not None:
            q = q.where(JournalLine.ts <= end)
        return int(self.s.scalar(q))

    def wallet_held_total(self) -> int:
        rows = self.s.execute(select(JournalLine.account, func.sum(JournalLine.amount)).group_by(JournalLine.account))
        return sum(int(t) for acct, t in rows if is_wallet_held(acct))

    def trial_balance(self) -> dict[str, int]:
        rows = self.s.execute(select(JournalLine.account, func.sum(JournalLine.amount)).group_by(JournalLine.account))
        return {acct: int(t) for acct, t in rows}

    def is_balanced(self) -> bool:
        return int(self.s.scalar(select(func.coalesce(func.sum(JournalLine.amount), 0)))) == 0
