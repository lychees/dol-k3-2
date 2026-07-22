-- Relational schema. Only the account identity is relational;
-- all evolving game data lives in player_data.data (versioned JSON).
CREATE TABLE IF NOT EXISTS account (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS player_data (
    account_id INTEGER PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    data       TEXT NOT NULL,           -- JSON document (see DESIGN.md)
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS session_token (
    token      TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    created_at REAL NOT NULL
);
