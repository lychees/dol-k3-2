"""Player-data packet handlers: player.load, player.save."""
from ..net.packet import Packet
from ..services.player_service import PlayerService


def register(registry, container) -> None:
    players = container.resolve(PlayerService)

    async def player_load(ctx):
        return Packet.ok(ctx.packet, {"data": players.get(ctx.session.account_id)})

    async def player_save(ctx):
        try:
            players.put(ctx.session.account_id, ctx.packet.payload.get("data"))
        except ValueError as e:
            return Packet.error(ctx.packet.seq, "bad_data", str(e))
        return Packet.ok(ctx.packet, {"saved": True})

    registry.add("player.load", player_load, auth=True)
    registry.add("player.save", player_save, auth=True)
