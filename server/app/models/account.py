"""Domain models.

PlayerData is intentionally a *schema-free document*: the game evolves
fast (fleet, equipment, mates, quests, ...), so the full player blob is
stored as versioned JSON (see repositories/player_repo.py). The account
table is the only strictly relational entity.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

DATA_VERSION = 1


@dataclass
class Account:
    id: int
    username: str
    created_at: float


@dataclass
class PlayerData:
    """The persistent game-state document of one account.

    `data` is free-form JSON (see DESIGN.md §storage-spec). Bump
    DATA_VERSION and add a migration in player_repo when its shape
    changes incompatibly.
    """
    account_id: int
    version: int = DATA_VERSION
    data: Dict[str, Any] = field(default_factory=dict)

    @staticmethod
    def fresh(account_id: int) -> "PlayerData":
        """Starting state of a new account."""
        return PlayerData(
            account_id=account_id,
            data={
                "gold": 1000,
                "fame": 0,
                "fleet": [{"ship": "Balsa", "hull": 60}],
                "cargo": {},
                "cargoCost": {},
                "bank": 0,
                "crew": 5,
                "mates": [],
                "shipCabins": {},
                "equipment": {"sails": 0, "cannons": 0, "ram": False,
                              "figurehead": False, "boarding": False, "armor": False},
                "hero": {"lv": 1, "exp": 0, "hp": 28, "weapon": 0, "armor": 0, "balms": 0},
                "discoveries": [],
                "portsFound": [],
                "character": 0,
            },
        )
