"""Per-connection session state."""
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class Session:
    websocket: Any
    token: Optional[str] = None
    account_id: Optional[int] = None

    @property
    def authenticated(self) -> bool:
        return self.account_id is not None
