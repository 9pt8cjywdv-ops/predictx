BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE TABLE agent_events (
    id SERIAL NOT NULL, 
    agent_id VARCHAR(16), 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    type VARCHAR(32) NOT NULL, 
    severity VARCHAR(16) NOT NULL, 
    summary TEXT NOT NULL, 
    data JSON NOT NULL, 
    PRIMARY KEY (id)
);

CREATE INDEX ix_agent_events_agent_id ON agent_events (agent_id);

CREATE INDEX ix_agent_events_ts ON agent_events (ts);

CREATE INDEX ix_agent_events_type ON agent_events (type);

CREATE TABLE agents (
    id VARCHAR(16) NOT NULL, 
    seq INTEGER NOT NULL, 
    name VARCHAR(64) NOT NULL, 
    parent_id VARCHAR(16), 
    generation INTEGER NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    status VARCHAR(16) NOT NULL, 
    status_reason TEXT, 
    deceased_at TIMESTAMP WITHOUT TIME ZONE, 
    starting_capital BIGINT NOT NULL, 
    reproduction_count INTEGER NOT NULL, 
    next_reproduction_threshold BIGINT NOT NULL, 
    capital_after_last_reproduction BIGINT, 
    strategy_key VARCHAR(64) NOT NULL, 
    strategy_profile JSON NOT NULL, 
    objective TEXT, 
    permissions JSON NOT NULL, 
    budget_overrides JSON NOT NULL, 
    final_performance JSON, 
    last_planned_at TIMESTAMP WITHOUT TIME ZONE, 
    last_daily_run_at TIMESTAMP WITHOUT TIME ZONE, 
    consecutive_losing_days INTEGER NOT NULL, 
    version INTEGER NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(parent_id) REFERENCES agents (id), 
    UNIQUE (seq)
);

CREATE INDEX ix_agents_parent_id ON agents (parent_id);

CREATE INDEX ix_agents_status ON agents (status);

CREATE TABLE approvals (
    id SERIAL NOT NULL, 
    kind VARCHAR(48) NOT NULL, 
    agent_id VARCHAR(16), 
    title VARCHAR(255) NOT NULL, 
    payload JSON NOT NULL, 
    status VARCHAR(16) NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    decided_at TIMESTAMP WITHOUT TIME ZONE, 
    decided_by VARCHAR(64), 
    decision_note TEXT, 
    PRIMARY KEY (id)
);

CREATE INDEX ix_approvals_agent_id ON approvals (agent_id);

CREATE INDEX ix_approvals_kind ON approvals (kind);

CREATE INDEX ix_approvals_status ON approvals (status);

CREATE TABLE audit_log (
    id SERIAL NOT NULL, 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    actor VARCHAR(64) NOT NULL, 
    action VARCHAR(64) NOT NULL, 
    target VARCHAR(64), 
    details JSON NOT NULL, 
    prev_hash VARCHAR(64) NOT NULL, 
    hash VARCHAR(64) NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (hash)
);

CREATE INDEX ix_audit_log_action ON audit_log (action);

CREATE INDEX ix_audit_log_ts ON audit_log (ts);

CREATE TABLE daily_snapshots (
    day VARCHAR(10) NOT NULL, 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    metrics JSON NOT NULL, 
    PRIMARY KEY (day)
);

CREATE TABLE journal_entries (
    id SERIAL NOT NULL, 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    kind VARCHAR(32) NOT NULL, 
    agent_id VARCHAR(16), 
    counterparty_agent_id VARCHAR(16), 
    description TEXT NOT NULL, 
    external_ref VARCHAR(255), 
    evidence_source VARCHAR(64), 
    simulated BOOLEAN NOT NULL, 
    idempotency_key VARCHAR(255), 
    created_by VARCHAR(64) NOT NULL, 
    meta JSON NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (idempotency_key)
);

CREATE INDEX ix_journal_entries_agent_id ON journal_entries (agent_id);

CREATE INDEX ix_journal_entries_kind ON journal_entries (kind);

CREATE INDEX ix_journal_entries_ts ON journal_entries (ts);

CREATE TABLE secrets (
    name VARCHAR(64) NOT NULL, 
    ciphertext TEXT NOT NULL, 
    scopes JSON NOT NULL, 
    description TEXT, 
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (name)
);

CREATE TABLE sim_chain_balances (
    address VARCHAR(128) NOT NULL, 
    balance BIGINT NOT NULL, 
    PRIMARY KEY (address)
);

CREATE TABLE state (
    key VARCHAR(64) NOT NULL, 
    value JSON, 
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (key)
);

CREATE TABLE usage_records (
    id SERIAL NOT NULL, 
    agent_id VARCHAR(16), 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    provider VARCHAR(32) NOT NULL, 
    model VARCHAR(64) NOT NULL, 
    purpose VARCHAR(64) NOT NULL, 
    input_tokens INTEGER NOT NULL, 
    output_tokens INTEGER NOT NULL, 
    cost BIGINT NOT NULL, 
    simulated BOOLEAN NOT NULL, 
    PRIMARY KEY (id)
);

CREATE INDEX ix_usage_records_agent_id ON usage_records (agent_id);

CREATE INDEX ix_usage_records_ts ON usage_records (ts);

CREATE TABLE agent_memory (
    id SERIAL NOT NULL, 
    agent_id VARCHAR(16) NOT NULL, 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    kind VARCHAR(16) NOT NULL, 
    content TEXT NOT NULL, 
    score FLOAT, 
    PRIMARY KEY (id), 
    FOREIGN KEY(agent_id) REFERENCES agents (id)
);

CREATE INDEX ix_agent_memory_agent_id ON agent_memory (agent_id);

CREATE TABLE journal_lines (
    id SERIAL NOT NULL, 
    entry_id INTEGER NOT NULL, 
    account VARCHAR(96) NOT NULL, 
    agent_id VARCHAR(16), 
    amount BIGINT NOT NULL, 
    category VARCHAR(32), 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(entry_id) REFERENCES journal_entries (id)
);

CREATE INDEX ix_journal_lines_account ON journal_lines (account);

CREATE INDEX ix_journal_lines_agent_id ON journal_lines (agent_id);

CREATE INDEX ix_journal_lines_entry_id ON journal_lines (entry_id);

CREATE INDEX ix_journal_lines_ts ON journal_lines (ts);

CREATE INDEX ix_lines_agent_account ON journal_lines (agent_id, account);

CREATE TABLE opportunities (
    id SERIAL NOT NULL, 
    agent_id VARCHAR(16) NOT NULL, 
    strategy_key VARCHAR(64), 
    title VARCHAR(255) NOT NULL, 
    category VARCHAR(48) NOT NULL, 
    status VARCHAR(24) NOT NULL, 
    assessment JSON NOT NULL, 
    results JSON NOT NULL, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(agent_id) REFERENCES agents (id)
);

CREATE INDEX ix_opportunities_agent_id ON opportunities (agent_id);

CREATE TABLE positions (
    id SERIAL NOT NULL, 
    agent_id VARCHAR(16) NOT NULL, 
    symbol VARCHAR(16) NOT NULL, 
    quantity FLOAT NOT NULL, 
    cost_basis BIGINT NOT NULL, 
    mark_price FLOAT NOT NULL, 
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(agent_id) REFERENCES agents (id), 
    CONSTRAINT uq_position_agent_symbol UNIQUE (agent_id, symbol)
);

CREATE INDEX ix_positions_agent_id ON positions (agent_id);

CREATE TABLE reproduction_events (
    id SERIAL NOT NULL, 
    parent_id VARCHAR(16) NOT NULL, 
    seq INTEGER NOT NULL, 
    child_id VARCHAR(16) NOT NULL, 
    ts TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    parent_capital_before BIGINT NOT NULL, 
    offspring_capital BIGINT NOT NULL, 
    parent_capital_after BIGINT NOT NULL, 
    threshold_used BIGINT NOT NULL, 
    next_threshold BIGINT NOT NULL, 
    mutation JSON NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(child_id) REFERENCES agents (id), 
    FOREIGN KEY(parent_id) REFERENCES agents (id), 
    UNIQUE (child_id), 
    CONSTRAINT uq_reproduction_parent_seq UNIQUE (parent_id, seq)
);

CREATE TABLE transfers (
    id SERIAL NOT NULL, 
    kind VARCHAR(32) NOT NULL, 
    network VARCHAR(32) NOT NULL, 
    from_address VARCHAR(128), 
    to_address VARCHAR(128) NOT NULL, 
    amount BIGINT NOT NULL, 
    status VARCHAR(32) NOT NULL, 
    simulated BOOLEAN NOT NULL, 
    tx_hash VARCHAR(128), 
    error TEXT, 
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    confirmed_at TIMESTAMP WITHOUT TIME ZONE, 
    approval_id INTEGER, 
    meta JSON NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(approval_id) REFERENCES approvals (id)
);

CREATE TABLE distributions (
    id SERIAL NOT NULL, 
    period_start TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    period_end TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    computed_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
    period_profit BIGINT NOT NULL, 
    cumulative_profit BIGINT NOT NULL, 
    hwm_before BIGINT NOT NULL, 
    hwm_after BIGINT NOT NULL, 
    distributable BIGINT NOT NULL, 
    owner_amount BIGINT NOT NULL, 
    retained_amount BIGINT NOT NULL, 
    reimbursement_amount BIGINT NOT NULL, 
    status VARCHAR(32) NOT NULL, 
    transfer_id INTEGER, 
    details JSON NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(transfer_id) REFERENCES transfers (id), 
    UNIQUE (period_end)
);

INSERT INTO alembic_version (version_num) VALUES ('0001') RETURNING alembic_version.version_num;

COMMIT;

