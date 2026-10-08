"""Clocks. All internal timestamps are naive UTC datetimes."""
from datetime import datetime, timedelta, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SystemClock:
    simulated = False

    def now(self) -> datetime:
        return utcnow()


class SimClock:
    """Deterministic, manually advanced clock used by the simulation."""

    simulated = True

    def __init__(self, start: datetime | None = None):
        self._now = start or datetime(2026, 1, 5, 0, 0, 0)  # a Monday

    def now(self) -> datetime:
        return self._now

    def advance(self, delta: timedelta) -> datetime:
        self._now += delta
        return self._now

    def set(self, when: datetime) -> None:
        self._now = when
