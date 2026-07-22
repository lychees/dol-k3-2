"""Database interface.

Anything that wants a DB connection depends on this protocol, never on a
concrete driver. Swap implementations in the container (main.py).
"""
from typing import Protocol


class Database(Protocol):
    def execute(self, sql: str, params: tuple = ()) -> "CursorLike":
        """Run a write statement, return a cursor-like object."""
        ...

    def query(self, sql: str, params: tuple = ()) -> list:
        """Run a read statement, return a list of row tuples."""
        ...

    def query_one(self, sql: str, params: tuple = ()) -> tuple | None:
        """Run a read statement, return the first row or None."""
        ...

    def close(self) -> None: ...
