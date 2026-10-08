"""Master treasury: external USDC transfers, transaction signing and reconciliation.

Architecture
------------
* One master treasury wallet holds all ecosystem USDC on the administrator's
  chosen network. Agent allocations are sub-ledgers of that wallet, so agents
  never hold keys.
* Outbound transfers are created as `Transfer` rows and executed by a
  `Signer`. The simulated signer moves balances on a simulated chain. The live
  signer is an adapter to an external, policy-enforcing signing service
  (e.g. a Safe multisig module, Coinbase CDP server wallet, Fireblocks, or an
  HSM-backed signer). Private keys never enter this process or any prompt.
"""
import hashlib
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import NotConfigured, PolicyViolation
from .ledger import Ledger, is_wallet_held
from .models import Position, SimChainBalance, Transfer
from .money import fmt

SIM_TREASURY_ADDRESS = "SIM-TREASURY"
SIM_OPERATOR_FUNDING_ADDRESS = "SIM-OPERATOR-FUNDING"


class SimulatedChain:
    def __init__(self, s: Session):
        self.s = s

    def _row(self, address: str) -> SimChainBalance:
        row = self.s.get(SimChainBalance, address)
        if row is None:
            row = SimChainBalance(address=address, balance=0)
            self.s.add(row)
            self.s.flush()
        return row

    def balance(self, address: str) -> int:
        return self._row(address).balance

    def mint(self, address: str, amount: int) -> None:
        self._row(address).balance += amount

    def transfer(self, src: str, dst: str, amount: int) -> None:
        a = self._row(src)
        if a.balance < amount:
            raise PolicyViolation(f"simulated chain: insufficient balance at {src}")
        a.balance -= amount
        self._row(dst).balance += amount


class SimulatedSigner:
    name = "simulated"
    live = False

    def __init__(self, s: Session):
        self.chain = SimulatedChain(s)

    def simulate(self, transfer: Transfer) -> None:
        if self.chain.balance(transfer.from_address) < transfer.amount:
            raise PolicyViolation("simulation failed: treasury balance too low")

    def submit(self, transfer: Transfer) -> str:
        self.simulate(transfer)
        self.chain.transfer(transfer.from_address, transfer.to_address, transfer.amount)
        digest = hashlib.sha256(f"{transfer.id}:{transfer.to_address}:{transfer.amount}".encode()).hexdigest()
        return "SIM-" + digest[:40]

    def balance(self, address: str) -> int:
        return self.chain.balance(address)


class ExternalSignerAdapter:
    """Live signer. Delegates to an external signing service that enforces its own
    allow-list and per-transfer limits. Awaiting administrator configuration."""

    name = "external"
    live = True

    def __init__(self):
        self.url = os.getenv("GENESIS_SIGNER_URL")
        self.credential_name = os.getenv("GENESIS_SIGNER_CREDENTIAL", "signer")

    @property
    def configured(self) -> bool:
        return bool(self.url)

    def _require(self):
        if not self.configured:
            raise NotConfigured("live signing service is not configured (GENESIS_SIGNER_URL)")

    def simulate(self, transfer: Transfer) -> None:  # pragma: no cover - requires external service
        self._require()
        raise NotConfigured("live transaction simulation requires the signing-service integration")

    def submit(self, transfer: Transfer) -> str:  # pragma: no cover - requires external service
        self._require()
        raise NotConfigured("live transaction submission requires the signing-service integration")

    def balance(self, address: str) -> int:  # pragma: no cover - requires RPC
        self._require()
        raise NotConfigured("live balance lookup requires an RPC/indexer integration")


def reconcile(s: Session, signer, treasury_address: str) -> dict:
    """Compare the ledger with the chain and internal invariants."""
    ledger = Ledger(s)
    issues: list[str] = []
    if not ledger.is_balanced():
        issues.append("journal does not balance")

    ledger_wallet = ledger.wallet_held_total()
    try:
        chain_balance = signer.balance(treasury_address)
    except NotConfigured as exc:
        chain_balance = None
        issues.append(str(exc))
    if chain_balance is not None and chain_balance != ledger_wallet:
        issues.append(f"wallet mismatch: chain {fmt(chain_balance)} vs ledger {fmt(ledger_wallet)}")

    # Position sub-ledger must equal open position cost basis per agent.
    tb = ledger.trial_balance()
    pos_rows = s.execute(select(Position.agent_id, Position.cost_basis)).all()
    by_agent: dict[str, int] = {}
    for agent_id, cost in pos_rows:
        by_agent[agent_id] = by_agent.get(agent_id, 0) + cost
    for acct, bal in tb.items():
        if acct.endswith(":positions"):
            agent_id = acct.split(":")[2]
            if by_agent.get(agent_id, 0) != bal:
                issues.append(f"position sub-ledger mismatch for {agent_id}")
    # No wallet-held account may ever be negative (no borrowing / overdraft).
    for acct, bal in tb.items():
        if is_wallet_held(acct) and bal < 0:
            issues.append(f"negative balance in {acct}")
    pending = s.scalar(select(Transfer.id).where(Transfer.status.in_(["submitted"])).limit(1))
    if pending:
        issues.append("transfers awaiting confirmation")
    return {
        "ok": not issues,
        "issues": issues,
        "ledger_wallet_total": ledger_wallet,
        "chain_balance": chain_balance,
    }
