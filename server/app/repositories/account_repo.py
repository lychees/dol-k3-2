"""Account + session-token persistence (SQL)."""
import time

from ..db.base import Database
from ..models.account import Account
from .base import AccountRepository


class SqlAccountRepository(AccountRepository):
    def __init__(self, db: Database) -> None:
        self._db = db

    def create(self, username: str, password_hash: str, salt: str) -> Account:
        cur = self._db.execute(
            "INSERT INTO account (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, salt, time.time()),
        )
        return Account(id=cur.lastrowid, username=username, created_at=time.time())

    def find_by_username(self, username: str):
        return self._db.query_one(
            "SELECT id, username, password_hash, salt FROM account WHERE username = ?",
            (username,),
        )

    def find_by_id(self, account_id: int):
        row = self._db.query_one(
            "SELECT id, username, created_at FROM account WHERE id = ?", (account_id,))
        return Account(*row) if row else None

    def create_token(self, account_id: int, token: str) -> None:
        self._db.execute(
            "INSERT INTO session_token (token, account_id, created_at) VALUES (?, ?, ?)",
            (token, account_id, time.time()),
        )

    def account_id_for_token(self, token: str):
        row = self._db.query_one(
            "SELECT account_id FROM session_token WHERE token = ?", (token,))
        return row[0] if row else None
