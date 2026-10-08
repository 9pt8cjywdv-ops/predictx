"""Database schema (SQLAlchemy 2.0). PostgreSQL in production, SQLite for dev/tests.

All money columns are BigInteger micro-USDC. All timestamps are naive UTC.
"""
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class AgentStatus:
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DECEASED = "deceased"
    ALL = (ACTIVE, SUSPENDED, DECEASED)


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)  # AGT-0001
    seq: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id"), nullable=True, index=True)
    generation: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=AgentStatus.ACTIVE, index=True)
    status_reason: Mapped[str | None] = mapped_column(Text)
    deceased_at: Mapped[datetime | None] = mapped_column(DateTime)

    starting_capital: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reproduction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_reproduction_threshold: Mapped[int] = mapped_column(BigInteger, nullable=False)
    capital_after_last_reproduction: Mapped[int | None] = mapped_column(BigInteger)

    strategy_key: Mapped[str] = mapped_column(String(64), nullable=False)
    strategy_profile: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    objective: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    budget_overrides: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    final_performance: Mapped[dict | None] = mapped_column(JSON)

    last_planned_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_daily_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    consecutive_losing_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Optimistic-concurrency token. Every financial mutation of the agent row bumps it.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    __mapper_args__ = {"version_id_col": version}

    parent = relationship("Agent", remote_side=[id], backref="children")


class JournalEntry(Base):
    """Double-entry journal header. Lines must sum to zero."""

    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(16), index=True)
    counterparty_agent_id: Mapped[str | None] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    external_ref: Mapped[str | None] = mapped_column(String(255))
    evidence_source: Mapped[str | None] = mapped_column(String(64))
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), unique=True)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="core")
    meta: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    lines = relationship("JournalLine", back_populates="entry", cascade="all, delete-orphan")


class JournalLine(Base):
    """Signed amount: positive = debit, negative = credit."""

    __tablename__ = "journal_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"), nullable=False, index=True)
    account: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(16), index=True)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category: Mapped[str | None] = mapped_column(String(32))
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)

    entry = relationship("JournalEntry", back_populates="lines")

    __table_args__ = (Index("ix_lines_agent_account", "agent_id", "account"),)


class Position(Base):
    """Open spot position. Cost basis mirrors the agent's positions ledger account."""

    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cost_basis: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    mark_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    __table_args__ = (UniqueConstraint("agent_id", "symbol", name="uq_position_agent_symbol"),)


class ReproductionEvent(Base):
    __tablename__ = "reproduction_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    child_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), nullable=False, unique=True)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    parent_capital_before: Mapped[int] = mapped_column(BigInteger, nullable=False)
    offspring_capital: Mapped[int] = mapped_column(BigInteger, nullable=False)
    parent_capital_after: Mapped[int] = mapped_column(BigInteger, nullable=False)
    threshold_used: Mapped[int] = mapped_column(BigInteger, nullable=False)
    next_threshold: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mutation: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # The database itself refuses a second birth for the same parent/sequence.
    __table_args__ = (UniqueConstraint("parent_id", "seq", name="uq_reproduction_parent_seq"),)


class Distribution(Base):
    __tablename__ = "distributions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime, nullable=False, unique=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    period_profit: Mapped[int] = mapped_column(BigInteger, nullable=False)
    cumulative_profit: Mapped[int] = mapped_column(BigInteger, nullable=False)
    hwm_before: Mapped[int] = mapped_column(BigInteger, nullable=False)
    hwm_after: Mapped[int] = mapped_column(BigInteger, nullable=False)
    distributable: Mapped[int] = mapped_column(BigInteger, nullable=False)
    owner_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    retained_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reimbursement_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    transfer_id: Mapped[int | None] = mapped_column(ForeignKey("transfers.id"))
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class Transfer(Base):
    """An external (on-chain) movement of USDC into or out of the master treasury."""

    __tablename__ = "transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # payout, reimbursement, deposit, expense
    network: Mapped[str] = mapped_column(String(32), nullable=False)
    from_address: Mapped[str | None] = mapped_column(String(128))
    to_address: Mapped[str] = mapped_column(String(128), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tx_hash: Mapped[str | None] = mapped_column(String(128))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    approval_id: Mapped[int | None] = mapped_column(ForeignKey("approvals.id"))
    meta: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(16), index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    decided_by: Mapped[str | None] = mapped_column(String(64))
    decision_note: Mapped[str | None] = mapped_column(Text)


class AuditLog(Base):
    """Append-only, hash-chained audit trail. Tampering breaks the chain."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)


class StateKV(Base):
    """Ecosystem policy and state (limits, pause flags, HWM, wallet config)."""

    __tablename__ = "state"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AgentEvent(Base):
    """Agent activity feed: decisions, tool calls, strategy changes, warnings."""

    __tablename__ = "agent_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str | None] = mapped_column(String(16), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class AgentMemory(Base):
    __tablename__ = "agent_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), nullable=False, index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # lesson, note, experiment
    content: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float | None] = mapped_column(Float)


class UsageRecord(Base):
    """Metered model / API usage. The cost is also posted to the ledger."""

    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str | None] = mapped_column(String(16), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(String(64), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    simulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Opportunity(Base):
    """A revenue opportunity moving through the 8-step evaluation pipeline."""

    __tablename__ = "opportunities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), nullable=False, index=True)
    strategy_key: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(48), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)  # proposed/assessed/testing/active/rejected/retired/awaiting_authorization
    assessment: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    results: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Secret(Base):
    """Encrypted integration credential. Plaintext never leaves the vault module."""

    __tablename__ = "secrets"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    description: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class SimChainBalance(Base):
    """Balances on the simulated USDC chain (simulation mode only)."""

    __tablename__ = "sim_chain_balances"

    address: Mapped[str] = mapped_column(String(128), primary_key=True)
    balance: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class DailySnapshot(Base):
    """End-of-day ecosystem metrics used for dashboard charts."""

    __tablename__ = "daily_snapshots"

    day: Mapped[str] = mapped_column(String(10), primary_key=True)  # YYYY-MM-DD
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
