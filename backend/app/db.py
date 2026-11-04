from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3

from .domain import canonical

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('reviewer','employee')), employee_id TEXT,
 salt TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL, expires TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards(
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, revision INTEGER NOT NULL,
 payload TEXT NOT NULL, content_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies(
 id TEXT PRIMARY KEY, version TEXT UNIQUE NOT NULL, document TEXT NOT NULL,
 content_hash TEXT NOT NULL, source_hash TEXT NOT NULL, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_signatures(
 policy_id TEXT PRIMARY KEY REFERENCES policies(id), signer TEXT NOT NULL,
 signed_at TEXT NOT NULL, content_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals(
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id),
 author TEXT NOT NULL REFERENCES users(id), correction TEXT NOT NULL,
 input_hash TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES policies(id),
 state TEXT NOT NULL CHECK(state IN ('proposed','manual_review','verified','committed','rejected')),
 proof TEXT, created_at TEXT NOT NULL, parent_id TEXT REFERENCES proposals(id)
);
CREATE TABLE IF NOT EXISTS attestations(
 id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id),
 actor TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('employee_confirmation','manager_attestation')),
 reason TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals(
 id TEXT PRIMARY KEY, proposal_id TEXT UNIQUE REFERENCES proposals(id),
 actor TEXT NOT NULL REFERENCES users(id), proof_hash TEXT NOT NULL,
 proof TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS write_permits(
 card_id TEXT PRIMARY KEY REFERENCES cards(id), old_revision INTEGER NOT NULL,
 new_hash TEXT NOT NULL, approval_id TEXT NOT NULL REFERENCES approvals(id)
);
CREATE TABLE IF NOT EXISTS disputes(
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id),
 actor TEXT NOT NULL REFERENCES users(id), line_id TEXT, revision INTEGER NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dispute_resolutions(
 dispute_id TEXT PRIMARY KEY REFERENCES disputes(id), actor TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS investigations(
 id TEXT PRIMARY KEY, card_id TEXT REFERENCES cards(id), actor TEXT NOT NULL,
 result TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, entity TEXT NOT NULL, details TEXT NOT NULL,
 previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
 BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
 BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS card_gate BEFORE UPDATE ON cards
 WHEN NEW.id != OLD.id OR NEW.employee_id != OLD.employee_id
 OR NEW.revision != OLD.revision + 1 OR NOT EXISTS(
 SELECT 1 FROM write_permits p WHERE p.card_id=OLD.id
 AND p.old_revision=OLD.revision AND p.new_hash=NEW.content_hash)
 BEGIN SELECT RAISE(ABORT,'Verified approval required'); END;
CREATE TRIGGER IF NOT EXISTS card_no_delete BEFORE DELETE ON cards
 BEGIN SELECT RAISE(ABORT,'Timecards cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS policy_no_update BEFORE UPDATE ON policies
 BEGIN SELECT RAISE(ABORT,'Policy versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS policy_no_delete BEFORE DELETE ON policies
 BEGIN SELECT RAISE(ABORT,'Policy versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS signature_no_update BEFORE UPDATE ON policy_signatures
 BEGIN SELECT RAISE(ABORT,'Signatures are immutable'); END;
CREATE TRIGGER IF NOT EXISTS signature_no_delete BEFORE DELETE ON policy_signatures
 BEGIN SELECT RAISE(ABORT,'Signatures are immutable'); END;
CREATE TRIGGER IF NOT EXISTS proposal_source_immutable BEFORE UPDATE ON proposals
 WHEN NEW.card_id != OLD.card_id OR NEW.author != OLD.author
 OR NEW.correction != OLD.correction OR NEW.input_hash != OLD.input_hash
 OR NEW.policy_id != OLD.policy_id
 BEGIN SELECT RAISE(ABORT,'Create a new correction revision'); END;
CREATE TRIGGER IF NOT EXISTS approval_no_update BEFORE UPDATE ON approvals
 BEGIN SELECT RAISE(ABORT,'Approvals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS approval_no_delete BEFORE DELETE ON approvals
 BEGIN SELECT RAISE(ABORT,'Approvals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS attestation_no_update BEFORE UPDATE ON attestations
 BEGIN SELECT RAISE(ABORT,'Attestations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS attestation_no_delete BEFORE DELETE ON attestations
 BEGIN SELECT RAISE(ABORT,'Attestations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS dispute_no_update BEFORE UPDATE ON disputes
 BEGIN SELECT RAISE(ABORT,'Disputes are immutable; append a resolution'); END;
CREATE TRIGGER IF NOT EXISTS dispute_no_delete BEFORE DELETE ON disputes
 BEGIN SELECT RAISE(ABORT,'Disputes are immutable'); END;
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix="") -> str:
    return prefix + secrets.token_hex(10)


def password_hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 240000).hex()


class Database:
    def __init__(self, path=None):
        self.path = str(path or os.environ.get(
            "DAYFLOW_DB", Path(__file__).resolve().parents[1] / "dayflow.sqlite3"
        ))
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)
            connection.execute("PRAGMA journal_mode=WAL")

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @contextmanager
    def transaction(self):
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def audit(connection, actor, action, entity, details):
    previous = connection.execute(
        "SELECT event_hash FROM audit ORDER BY sequence DESC LIMIT 1"
    ).fetchone()
    previous_hash = previous["event_hash"] if previous else "0" * 64
    event = {"at": now(), "actor": actor, "action": action, "entity": entity, "details": details}
    digest = hashlib.sha256((previous_hash + canonical(event)).encode()).hexdigest()
    connection.execute(
        "INSERT INTO audit(at,actor,action,entity,details,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?)",
        (event["at"], actor, action, entity, canonical(details), previous_hash, digest),
    )


def audit_integrity(connection):
    previous = "0" * 64
    rows = connection.execute("SELECT * FROM audit ORDER BY sequence").fetchall()
    for row in rows:
        event = {key: row[key] for key in ("at", "actor", "action", "entity")}
        event["details"] = json.loads(row["details"])
        expected = hashlib.sha256((previous + canonical(event)).encode()).hexdigest()
        if row["previous_hash"] != previous or row["event_hash"] != expected:
            return False
        previous = expected
    return True
