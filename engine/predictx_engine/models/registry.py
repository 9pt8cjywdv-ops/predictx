from .base import SportModel
from .elo import EloModel
from .soccer import SoccerPoissonModel


def build_model(sport: str) -> SportModel:
    if sport == "soccer":
        return SoccerPoissonModel()
    return EloModel(sport)
