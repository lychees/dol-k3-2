"""Packet specification v1 (see DESIGN.md §packet-spec for the full doc).

Wire format: one JSON object per WebSocket text frame.

    {
      "v":     1,            # protocol version
      "type":  "auth.login", # dotted packet type "<domain>.<action>"
      "seq":   3,            # client sequence number (echoed in the reply)
      "token": "...",        # session token (required for non-auth packets)
      "payload": { ... }
    }

Replies:

    { "v": 1, "type": "auth.login.ok",  "seq": 3, "payload": { ... } }
    { "v": 1, "type": "error",          "seq": 3,
      "payload": {"code": "bad_credentials", "message": "..."} }

Conventions:
- request type X -> success type "X.ok"
- every reply echoes "seq"
- unknown types -> error packet with code "unknown_type"
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from .. import config


@dataclass
class Packet:
    type: str
    payload: Dict[str, Any] = field(default_factory=dict)
    seq: int = 0
    token: Optional[str] = None

    @staticmethod
    def ok(request: "Packet", payload: Dict[str, Any] | None = None) -> "Packet":
        return Packet(type=f"{request.type}.ok", payload=payload or {}, seq=request.seq)

    @staticmethod
    def error(seq: int, code: str, message: str) -> "Packet":
        return Packet(type="error", payload={"code": code, "message": message}, seq=seq)

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"v": config.PACKET_VERSION, "type": self.type,
                             "seq": self.seq, "payload": self.payload}
        if self.token:
            d["token"] = self.token
        return d

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Packet":
        if not isinstance(d, dict) or "type" not in d:
            raise ValueError("not a packet")
        if d.get("v", config.PACKET_VERSION) > config.PACKET_VERSION:
            raise ValueError("unsupported packet version")
        return Packet(type=str(d["type"]), payload=d.get("payload") or {},
                      seq=int(d.get("seq", 0)), token=d.get("token"))
