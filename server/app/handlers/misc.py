"""Misc handlers: server.ping, server.types.

Also serves as the canonical minimal example of a handler module
(plugin pattern: just define register()).
"""
from .. import config
from ..net.packet import Packet
from ..net.registry import PacketHandlerRegistry


def register(registry: PacketHandlerRegistry, container) -> None:
    async def server_ping(ctx):
        return Packet.ok(ctx.packet, {"pong": True, "v": config.PACKET_VERSION})

    async def server_types(ctx):
        return Packet.ok(ctx.packet, {"types": registry.types()})

    registry.add("server.ping", server_ping, auth=False)
    registry.add("server.types", server_types, auth=False)
