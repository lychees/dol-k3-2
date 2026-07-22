"""Auth packet handlers: auth.register, auth.login, auth.whoami."""
from ..net.packet import Packet
from ..repositories.base import AccountRepository
from ..services.auth_service import AuthService


def register(registry, container) -> None:
    auth = container.resolve(AuthService)
    accounts = container.resolve(AccountRepository)

    async def auth_register(ctx):
        p = ctx.packet.payload
        account, err = auth.register(str(p.get("username", "")), str(p.get("password", "")))
        if err:
            return Packet.error(ctx.packet.seq, err, f"registration failed: {err}")
        return Packet.ok(ctx.packet, {"account_id": account.id, "username": account.username})

    async def auth_login(ctx):
        p = ctx.packet.payload
        token, err = auth.login(str(p.get("username", "")), str(p.get("password", "")))
        if err:
            return Packet.error(ctx.packet.seq, err, "bad credentials")
        ctx.session.token = token
        return Packet.ok(ctx.packet, {"token": token})

    async def auth_whoami(ctx):
        account = accounts.find_by_id(ctx.session.account_id)
        return Packet.ok(ctx.packet, {"account_id": account.id, "username": account.username})

    registry.add("auth.register", auth_register, auth=False)
    registry.add("auth.login", auth_login, auth=False)
    registry.add("auth.whoami", auth_whoami, auth=True)
