"""Auth service: registration, login, tokens."""
import hashlib
import hmac
import os
import secrets
from typing import Optional, Tuple

from .. import config
from ..models.account import Account
from ..repositories.base import AccountRepository


class AuthService:
    def __init__(self, accounts: AccountRepository) -> None:
        self._accounts = accounts

    @staticmethod
    def _hash(password: str, salt: str) -> str:
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt),
                                 config.PBKDF2_ITERATIONS)
        return dk.hex()

    def register(self, username: str, password: str) -> Tuple[Optional[Account], Optional[str]]:
        """Returns (account, None) or (None, error_code)."""
        username = username.strip()
        if not (3 <= len(username) <= 20):
            return None, "bad_username"
        if len(password) < 4:
            return None, "weak_password"
        if self._accounts.find_by_username(username):
            return None, "username_taken"
        salt = os.urandom(16).hex()
        account = self._accounts.create(username, self._hash(password, salt), salt)
        return account, None

    def login(self, username: str, password: str) -> Tuple[Optional[str], Optional[str]]:
        """Returns (token, None) or (None, error_code)."""
        row = self._accounts.find_by_username(username.strip())
        if not row:
            return None, "bad_credentials"
        account_id, _name, stored_hash, salt = row
        if not hmac.compare_digest(self._hash(password, salt), stored_hash):
            return None, "bad_credentials"
        token = secrets.token_hex(16)
        self._accounts.create_token(account_id, token)
        return token, None
