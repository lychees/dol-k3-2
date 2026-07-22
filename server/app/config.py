"""Server configuration. Everything overridable via environment variables."""
import os

HOST = os.environ.get("UW_HOST", "127.0.0.1")
PORT = int(os.environ.get("UW_PORT", "8790"))
DB_PATH = os.environ.get("UW_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "uw_server.db"))
PACKET_VERSION = 1
# pbkdf2 iterations for password hashing
PBKDF2_ITERATIONS = int(os.environ.get("UW_PBKDF2_ITER", "60000"))
