"""A tiny dependency-injection container.

Design goals:
- Interfaces (usually typing.Protocol classes) are registered against
  implementations. Everything else resolves them through the container,
  so swapping e.g. SqliteDatabase for a MysqlDatabase is a one-line change
  in main.py — no consumer code changes.
- Supports singletons (shared state: db, services, registry) and
  factories (per-call instances: sessions).
"""
from typing import Any, Callable, Dict, Type, TypeVar

T = TypeVar("T")


class Container:
    def __init__(self) -> None:
        self._singletons: Dict[Any, Any] = {}
        self._factories: Dict[Any, Callable[["Container"], Any]] = {}

    # -- registration ------------------------------------------------------
    def instance(self, key: Any, obj: Any) -> None:
        """Register an already-built object as a singleton under `key`
        (an interface class or a string name)."""
        self._singletons[key] = obj

    def singleton(self, key: Any, factory: Callable[["Container"], Any]) -> None:
        """Register a lazy singleton: built once on first resolve."""
        def lazy(c: "Container") -> Any:
            if key not in self._singletons:
                self._singletons[key] = factory(c)
            return self._singletons[key]
        self._factories[key] = lazy

    def factory(self, key: Any, factory: Callable[["Container"], Any]) -> None:
        """Register a factory: a fresh instance on every resolve."""
        self._factories[key] = factory

    # -- resolution --------------------------------------------------------
    def resolve(self, key: Any) -> Any:
        if key in self._singletons:
            return self._singletons[key]
        if key in self._factories:
            return self._factories[key](self)
        raise KeyError(f"nothing registered for {key!r}")

    def __contains__(self, key: Any) -> bool:
        return key in self._singletons or key in self._factories
