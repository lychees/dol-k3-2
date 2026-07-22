"""Server entry point: build the DI container, wire everything, run.

This is the ONLY place concrete implementations are chosen. Swap them
here (e.g. MysqlDatabase instead of SqliteDatabase) and the whole
application follows — that is the point of the DI design.
"""
import logging

from app import config
from app.container import Container
from app.db.base import Database
from app.db.sqlite_db import SqliteDatabase
from app.net.codec import JsonCodec, PacketCodec
from app.net.registry import PacketHandlerRegistry
from app.net.server import GameServer
from app.repositories.account_repo import SqlAccountRepository
from app.repositories.base import AccountRepository, PlayerDataRepository
from app.repositories.player_repo import SqlPlayerDataRepository
from app.services.auth_service import AuthService
from app.services.player_service import PlayerService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")


def build_container(db_path: str = config.DB_PATH) -> Container:
    c = Container()

    # infrastructure (singletons)
    c.singleton(Database, lambda c: SqliteDatabase(db_path))
    c.instance(PacketCodec, JsonCodec())

    # repositories
    c.singleton(AccountRepository, lambda c: SqlAccountRepository(c.resolve(Database)))
    c.singleton(PlayerDataRepository, lambda c: SqlPlayerDataRepository(c.resolve(Database)))

    # services
    c.singleton(AuthService, lambda c: AuthService(c.resolve(AccountRepository)))
    c.singleton(PlayerService, lambda c: PlayerService(c.resolve(PlayerDataRepository)))

    # packet handler registry (auto-discovers app/handlers/*)
    c.singleton(PacketHandlerRegistry, lambda c: PacketHandlerRegistry.load_modules(c))

    # server
    c.singleton(GameServer, lambda c: GameServer(c))
    return c


def main() -> None:
    import asyncio
    container = build_container()
    server = container.resolve(GameServer)
    asyncio.run(server.start())


if __name__ == "__main__":
    main()
