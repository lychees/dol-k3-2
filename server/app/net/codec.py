"""Packet codec interface + JSON implementation.

Want a binary format later (msgpack/protobuf)? Write another codec and
register it in the container — the server only knows this interface.
"""
import json
from typing import Protocol

from .packet import Packet


class PacketCodec(Protocol):
    def encode(self, packet: Packet) -> str | bytes: ...
    def decode(self, raw: str | bytes) -> Packet: ...


class JsonCodec(PacketCodec):
    def encode(self, packet: Packet) -> str:
        return json.dumps(packet.to_dict(), ensure_ascii=False)

    def decode(self, raw: str | bytes) -> Packet:
        return Packet.from_dict(json.loads(raw))
