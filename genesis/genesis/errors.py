class GenesisError(Exception):
    code = "error"

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class PolicyViolation(GenesisError):
    code = "policy_violation"


class InsufficientFunds(PolicyViolation):
    code = "insufficient_funds"


class NotFound(GenesisError):
    code = "not_found"


class Conflict(GenesisError):
    code = "conflict"


class LedgerError(GenesisError):
    code = "ledger_error"


class NotConfigured(GenesisError):
    code = "not_configured"
