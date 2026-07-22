"""Player data service: load/save the versioned game-state document."""
from ..models.account import PlayerData
from ..repositories.base import PlayerDataRepository


class PlayerService:
    def __init__(self, players: PlayerDataRepository) -> None:
        self._players = players

    def get(self, account_id: int) -> dict:
        return self._players.load(account_id).data

    def put(self, account_id: int, data: dict) -> None:
        if not isinstance(data, dict):
            raise ValueError("player data must be an object")
        self._players.save(PlayerData(account_id=account_id, data=data))
