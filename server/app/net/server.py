"""Async WebSocket server.

Everything protocol- and transport-specific lives here; game logic lives
in handlers. The server resolves its collaborators (codec, registry,
account repo) from the DI container.
"""
import logging
from dataclasses import dataclass

import websockets

from .. import config
from ..container import Container
from ..repositories.base import AccountRepository
from .codec import PacketCodec
from .packet import Packet
from .registry import PacketHandlerRegistry
from .session import Session

log = logging.getLogger("uw-server")


@dataclass
class HandlerContext:
    packet: Packet
    session: Session
    container: Container


class GameServer:
    def __init__(self, container: Container) -> None:
        self._c = container
        self._codec: PacketCodec = container.resolve(PacketCodec)
        self._registry: PacketHandlerRegistry = container.resolve(PacketHandlerRegistry)

    async def start(self) -> None:
        log.info("listening on ws://%s:%d (%d packet types)",
                 config.HOST, config.PORT, len(self._registry.types()))
        async with websockets.serve(self._handle_conn, config.HOST, config.PORT):
            await self.get_stop_future()

    @staticmethod
    async def get_stop_future():
        import asyncio
        return await asyncio.Future()

    async def _handle_conn(self, ws) -> None:
        session = Session(websocket=ws)
        peer = ws.remote_address
        log.info("connect %s", peer)
        try:
            async for raw in ws:
                reply = await self._dispatch(raw, session)
                if reply is not None:
                    await ws.send(self._codec.encode(reply))
        except websockets.ConnectionClosed:
            pass
        finally:
            log.info("disconnect %s", peer)

    async def _dispatch(self, raw, session: Session) -> Packet | None:
        try:
            packet = self._codec.decode(raw)
        except Exception as e:  # noqa: BLE001
            return Packet.error(0, "bad_packet", str(e))

        entry = self._registry.get(packet.type)
        if entry is None:
            return Packet.error(packet.seq, "unknown_type", f"unknown packet type {packet.type!r}")
        handler, requires_auth = entry

        if requires_auth:
            await self._resolve_auth(packet, session)
            if not session.authenticated:
                return Packet.error(packet.seq, "unauthorized", "not logged in")

        ctx = HandlerContext(packet=packet, session=session, container=self._c)
        try:
            return await handler(ctx)
        except Exception as e:  # noqa: BLE001
            log.exception("handler %s failed", packet.type)
            return Packet.error(packet.seq, "internal", str(e))

    async def _resolve_auth(self, packet: Packet, session: Session) -> None:
        if session.authenticated or not packet.token:
            return
        repo: AccountRepository = self._c.resolve(AccountRepository)
        account_id = repo.account_id_for_token(packet.token)
        if account_id:
            session.token = packet.token
            session.account_id = account_id
