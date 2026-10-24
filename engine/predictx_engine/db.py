"""Database schema and session handling (PostgreSQL in production)."""
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; everything in this app is UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class Base(DeclarativeBase):
    type_annotation_map = {datetime: DateTime(timezone=True)}


class Event(Base):
    """A fixture or result, as reported by the fixtures provider."""

    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # e.g. "espn:eng.1:740123"
    sport: Mapped[str] = mapped_column(String(20), index=True)
    league: Mapped[str] = mapped_column(String(40), index=True)
    competition: Mapped[str] = mapped_column(String(160))
    start_time: Mapped[datetime] = mapped_column(index=True)
    home_id: Mapped[str] = mapped_column(String(80), index=True)
    away_id: Mapped[str] = mapped_column(String(80), index=True)
    home_name: Mapped[str] = mapped_column(String(160))
    away_name: Mapped[str] = mapped_column(String(160))
    # Tennis/neutral venues have no home advantage. For tennis "home" is simply
    # competitor A as listed by the provider.
    neutral: Mapped[bool] = mapped_column(Boolean, default=False)
    draw_possible: Mapped[bool] = mapped_column(Boolean, default=False)
    # scheduled | in_progress | final | postponed | cancelled
    status: Mapped[str] = mapped_column(String(20), index=True)
    home_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    away_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # home | away | draw | void (no result / abandoned)
    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    source: Mapped[str] = mapped_column(String(40))
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (Index("ix_events_sport_status_start", "sport", "status", "start_time"),)


class OddsSnapshot(Base):
    """Bookmaker consensus for an event, with the bookmaker margin removed."""

    __tablename__ = "odds_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    fetched_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    bookmakers: Mapped[int] = mapped_column(Integer)
    p_home: Mapped[float] = mapped_column(Float)
    p_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_away: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(40), default="the-odds-api")


class Injury(Base):
    """Latest injury report rows per team (replaced on every refresh)."""

    __tablename__ = "injuries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    league: Mapped[str] = mapped_column(String(40), index=True)
    team_name: Mapped[str] = mapped_column(String(160), index=True)
    player: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(default=utcnow)


class Prediction(Base):
    """An immutable prediction snapshot.

    Rows are insert-only: a new row is written whenever the inputs change. On
    PostgreSQL a trigger rejects UPDATE and DELETE so history cannot be rewritten
    after results are known. The prediction used for grading is the latest row
    created before the event's start time.
    """

    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    model_version: Mapped[str] = mapped_column(String(40))
    # "ok" or "insufficient_data" (then all probabilities are NULL)
    status: Mapped[str] = mapped_column(String(24))
    p_home: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_away: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_model_home: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_model_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_model_away: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_market_home: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_market_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_market_away: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted: Mapped[str | None] = mapped_column(String(10), nullable=True)  # home|draw|away
    win_prob: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float] = mapped_column(Float)  # 0..100, NOT a win probability
    confidence_label: Mapped[str] = mapped_column(String(12))
    factors: Mapped[dict] = mapped_column(JSON, default=dict)
    missing: Mapped[list] = mapped_column(JSON, default=list)
    inputs_hash: Mapped[str] = mapped_column(String(64))
    inputs_as_of: Mapped[datetime] = mapped_column()


class GradedPrediction(Base):
    """Outcome of the last pre-start prediction for a finished event."""

    __tablename__ = "graded_predictions"

    event_id: Mapped[str] = mapped_column(ForeignKey("events.id"), primary_key=True)
    prediction_id: Mapped[int] = mapped_column(ForeignKey("predictions.id"), unique=True)
    sport: Mapped[str] = mapped_column(String(20), index=True)
    league: Mapped[str] = mapped_column(String(40))
    outcome: Mapped[str] = mapped_column(String(10))
    predicted: Mapped[str] = mapped_column(String(10))
    win_prob: Mapped[float] = mapped_column(Float)
    p_outcome: Mapped[float] = mapped_column(Float)
    correct: Mapped[bool] = mapped_column(Boolean)
    brier: Mapped[float] = mapped_column(Float)
    log_loss: Mapped[float] = mapped_column(Float)
    market_brier: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_brier: Mapped[float | None] = mapped_column(Float, nullable=True)
    graded_at: Mapped[datetime] = mapped_column(default=utcnow)


class Calibration(Base):
    """Per-sport parameters fitted on graded predictions (append-only history)."""

    __tablename__ = "calibrations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sport: Mapped[str] = mapped_column(String(20), index=True)
    fitted_at: Mapped[datetime] = mapped_column(default=utcnow)
    n: Mapped[int] = mapped_column(Integer)
    temperature: Mapped[float] = mapped_column(Float)
    market_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    log_loss_before: Mapped[float] = mapped_column(Float)
    log_loss_after: Mapped[float] = mapped_column(Float)


class ModelRun(Base):
    """One fit of a sport model, with its walk-forward backtest on past results."""

    __tablename__ = "model_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sport: Mapped[str] = mapped_column(String(20), index=True)
    run_at: Mapped[datetime] = mapped_column(default=utcnow)
    model_version: Mapped[str] = mapped_column(String(40))
    history_games: Mapped[int] = mapped_column(Integer)
    backtest: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    predictions_written: Mapped[int] = mapped_column(Integer, default=0)


class SourceStatus(Base):
    __tablename__ = "source_status"
    __table_args__ = (UniqueConstraint("source", "scope"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(40))
    scope: Mapped[str] = mapped_column(String(60))  # league key or "*"
    last_attempt: Mapped[datetime | None] = mapped_column(nullable=True)
    last_success: Mapped[datetime | None] = mapped_column(nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    backfilled_until: Mapped[datetime | None] = mapped_column(nullable=True)
    backfilled_from: Mapped[datetime | None] = mapped_column(nullable=True)


IMMUTABLE_TRIGGER_SQL = [
    """
    CREATE OR REPLACE FUNCTION predictx_reject_change() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'predictions are immutable (attempted %)', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
    """,
    "DROP TRIGGER IF EXISTS predictions_immutable ON predictions;",
    """
    CREATE TRIGGER predictions_immutable BEFORE UPDATE OR DELETE ON predictions
    FOR EACH ROW EXECUTE FUNCTION predictx_reject_change();
    """,
]

_engine = None
_SessionLocal = None


def get_engine(url: str | None = None):
    global _engine, _SessionLocal
    if _engine is None or url is not None:
        url = url or get_settings().database_url
        kwargs = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        _engine = create_engine(url, **kwargs)
        if url.startswith("sqlite"):
            _install_sqlite_guard(_engine)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def _install_sqlite_guard(engine) -> None:
    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")


def init_db(url: str | None = None) -> None:
    engine = get_engine(url)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            for stmt in IMMUTABLE_TRIGGER_SQL:
                conn.execute(text(stmt))
        elif engine.dialect.name == "sqlite":
            conn.execute(text(
                "CREATE TRIGGER IF NOT EXISTS predictions_no_update BEFORE UPDATE ON predictions "
                "BEGIN SELECT RAISE(ABORT, 'predictions are immutable'); END;"))
            conn.execute(text(
                "CREATE TRIGGER IF NOT EXISTS predictions_no_delete BEFORE DELETE ON predictions "
                "BEGIN SELECT RAISE(ABORT, 'predictions are immutable'); END;"))


@contextmanager
def session_scope() -> Session:
    get_engine()
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
