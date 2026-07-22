"""Packet handler registry — the extension point for new features.

Adding a new packet type never touches the server core:

    # app/handlers/fishing.py
    from ..net.registry import PacketHandlerRegistry

    def register(registry: PacketHandlerRegistry) -> None:
        async def fishing_cast(ctx):
            ...
            return Packet.ok(ctx.packet, {"fish": "tuna"})
        registry.add("fishing.cast", fishing_cast, auth=True)

    # app/handlers/__init__.py auto-discovers every module with register().
"""
import inspect
from typing import Awaitable, Callable, Dict, Protocol


class HandlerContext(Protocol):
    packet: "Packet"          # noqa: F821
    session: "Session"        # noqa: F821
    container: "Container"    # noqa: F821


Handler = Callable[[HandlerContext], Awaitable["Packet"]]


class PacketHandlerRegistry:
    def __init__(self) -> None:
        # type -> (handler, requires_auth)
        self._handlers: Dict[str, tuple] = {}

    def add(self, type_: str, handler: Handler, auth: bool = True) -> None:
        if type_ in self._handlers:
            raise ValueError(f"duplicate packet type {type_}")
        self._handlers[type_] = (handler, auth)

    def get(self, type_: str):
        return self._handlers.get(type_)

    def types(self) -> list:
        return sorted(self._handlers)

    @staticmethod
    def load_modules(container) -> "PacketHandlerRegistry":
        """Build a registry and let every module in app.handlers register
        its packet types (plugin discovery)."""
        from .. import handlers as handlers_pkg
        registry = PacketHandlerRegistry()
        for register in handlers_pkg.discover_registrars():
            register(registry, container)
        return registry
