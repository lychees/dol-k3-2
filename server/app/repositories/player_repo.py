"""Player game-data persistence: versioned JSON document per account.

Storage spec (see DESIGN.md §storage-spec):
- one row per account in player_data
- `version` = DATA_VERSION of the writer; loaders run `migrate()` to
  upgrade older documents in-place, so new fields can be introduced
  without SQL migrations.
"""
import json
import time

from ..db.base import Database
from ..models.account import DATA_VERSION, PlayerData
from .base import PlayerDataRepository

# migrations: {from_version: fn(data_dict) -> data_dict}
MIGRATIONS = {
    # 1: _migrate_1_to_2
}


class SqlPlayerDataRepository(PlayerDataRepository):
    def __init__(self, db: Database) -> None:
        self._db = db

    def load(self, account_id: int) -> PlayerData:
        row = self._db.query_one(
            "SELECT version, data FROM player_data WHERE account_id = ?", (account_id,))
        if not row:
            player = PlayerData.fresh(account_id)
            self.save(player)
            return player
        version, raw = row
        data = json.loads(raw)
        while version < DATA_VERSION:
            data = MIGRATIONS[version](data)
            version += 1
        return PlayerData(account_id=account_id, version=DATA_VERSION, data=data)

    def save(self, player: PlayerData) -> None:
        self._db.execute(
            "INSERT INTO player_data (account_id, version, data, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(account_id) DO UPDATE SET version=excluded.version, "
            "data=excluded.data, updated_at=excluded.updated_at",
            (player.account_id, player.version, json.dumps(player.data), time.time()),
        )
