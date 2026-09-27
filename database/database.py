"""
database/database.py
--------------------
TEAM MEMBER 3 — Database
Owns the SQLite schema and every read/write helper function.
Flask (app.py) imports these functions to store and retrieve data.

Extended with:
  - users table  (auth)
  - claims table (claim workflow)
  - reporter_id column on reports
"""

import sqlite3
import os

# The .db file sits in the project root (one level above this folder)
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "lost_and_found.db")


def get_connection():
    """Return an open SQLite connection. Columns accessible by name via row_factory."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables on first run. Safe to call every time — uses IF NOT EXISTS."""
    conn = get_connection()
    c = conn.cursor()

    # ── Original tables ────────────────────────────────────────────────────────

    c.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            type        TEXT    NOT NULL CHECK(type IN ('lost','found')),
            item_name   TEXT    NOT NULL,
            category    TEXT    NOT NULL,
            description TEXT    DEFAULT '',
            location    TEXT    NOT NULL,
            date_time   TEXT    NOT NULL,
            image_file  TEXT    DEFAULT '',
            status      TEXT    DEFAULT 'open',
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS matches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            lost_id     INTEGER NOT NULL,
            found_id    INTEGER NOT NULL,
            score       REAL    NOT NULL,
            reasons     TEXT    NOT NULL,
            status      TEXT    DEFAULT 'pending',
            created_at  TEXT    DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (lost_id)  REFERENCES reports(id),
            FOREIGN KEY (found_id) REFERENCES reports(id)
        )
    """)

    # ── New tables ─────────────────────────────────────────────────────────────

    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            email         TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            created_at    TEXT    DEFAULT (datetime('now','localtime'))
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS claims (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id       INTEGER NOT NULL,
            claimant_id     INTEGER NOT NULL,
            finder_id       INTEGER NOT NULL,
            claim_code_hash TEXT    NOT NULL,
            status          TEXT    DEFAULT 'pending',
            created_at      TEXT    DEFAULT (datetime('now','localtime')),
            verified_at     TEXT,
            FOREIGN KEY (report_id)   REFERENCES reports(id),
            FOREIGN KEY (claimant_id) REFERENCES users(id),
            FOREIGN KEY (finder_id)   REFERENCES users(id)
        )
    """)

    # ── Migrate existing reports table to add reporter_id (safe — idempotent) ──
    try:
        c.execute("ALTER TABLE reports ADD COLUMN reporter_id INTEGER DEFAULT NULL")
    except sqlite3.OperationalError:
        pass  # Column already exists

    # ── Migrate users table to add contact_info (safe — idempotent) ──
    # contact_info: free-text field for phone, WhatsApp, email alias, etc.
    # Visible ONLY to the other party of an active claim — never on public endpoints.
    try:
        c.execute("ALTER TABLE users ADD COLUMN contact_info TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass  # Column already exists

    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# REPORTS
# ══════════════════════════════════════════════════════════════════════════════

def save_report(type_, item_name, category, description, location, date_time,
                image_file="", user_id=None):
    """Insert a new report row. Returns the auto-assigned integer id."""
    conn = get_connection()
    c = conn.cursor()
    c.execute(
        "INSERT INTO reports "
        "(type, item_name, category, description, location, date_time, image_file, reporter_id) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (type_, item_name, category, description, location, date_time, image_file, user_id)
    )
    new_id = c.lastrowid
    conn.commit()
    conn.close()
    return new_id


def get_all_reports(filter_type=None, filter_category=None):
    """Return all reports as a list of dicts. Optional type/category filters."""
    conn = get_connection()
    c = conn.cursor()
    sql = "SELECT * FROM reports WHERE 1=1"
    params = []
    if filter_type:
        sql += " AND type=?"; params.append(filter_type)
    if filter_category:
        sql += " AND category=?"; params.append(filter_category)
    sql += " ORDER BY created_at DESC"
    c.execute(sql, params)
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_report_by_id(report_id):
    """Return one report dict or None."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM reports WHERE id=?", (report_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None


def get_lost_reports():
    """All open LOST reports, newest first."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM reports WHERE type='lost' AND status='open' ORDER BY created_at DESC")
    rows = c.fetchall(); conn.close()
    return [dict(r) for r in rows]


def get_found_reports():
    """All open FOUND reports, newest first."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM reports WHERE type='found' AND status='open' ORDER BY created_at DESC")
    rows = c.fetchall(); conn.close()
    return [dict(r) for r in rows]


def update_report_status(report_id, status):
    """Set a report's status (e.g. 'returned')."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("UPDATE reports SET status=? WHERE id=?", (status, report_id))
    conn.commit(); conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# MATCHES
# ══════════════════════════════════════════════════════════════════════════════

def save_match(lost_id, found_id, score, reasons):
    """
    Save a suggested match.  reasons is a pipe-separated string.
    Returns existing match id if the pair already exists (avoids duplicates).
    """
    conn = get_connection()
    c = conn.cursor()
    c.execute(
        "SELECT id FROM matches WHERE lost_id=? AND found_id=? AND status='pending'",
        (lost_id, found_id)
    )
    existing = c.fetchone()
    if existing:
        conn.close()
        return existing[0]

    c.execute(
        "INSERT INTO matches (lost_id,found_id,score,reasons) VALUES (?,?,?,?)",
        (lost_id, found_id, score, reasons)
    )
    new_id = c.lastrowid
    conn.commit(); conn.close()
    return new_id


def get_all_matches():
    """All matches with both reports joined in."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        SELECT m.id, m.lost_id, m.found_id, m.score, m.reasons, m.status, m.created_at,
               l.item_name  AS lost_item,  l.category AS lost_category,
               l.location   AS lost_loc,   l.date_time AS lost_dt,  l.image_file AS lost_img,
               f.item_name  AS found_item, f.category AS found_category,
               f.location   AS found_loc,  f.date_time AS found_dt, f.image_file AS found_img
        FROM matches m
        JOIN reports l ON m.lost_id  = l.id
        JOIN reports f ON m.found_id = f.id
        ORDER BY m.score DESC, m.created_at DESC
    """)
    rows = c.fetchall(); conn.close()
    return [dict(r) for r in rows]


def get_match_by_id(match_id):
    """One match with full report details joined, or None."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        SELECT m.id, m.lost_id, m.found_id, m.score, m.reasons, m.status, m.created_at,
               l.item_name   AS lost_item,  l.category    AS lost_category,
               l.description AS lost_desc,  l.location    AS lost_loc,
               l.date_time   AS lost_dt,    l.image_file  AS lost_img,
               l.reporter_id AS lost_reporter_id,
               f.item_name   AS found_item, f.category    AS found_category,
               f.description AS found_desc, f.location    AS found_loc,
               f.date_time   AS found_dt,   f.image_file  AS found_img,
               f.reporter_id AS found_reporter_id
        FROM matches m
        JOIN reports l ON m.lost_id  = l.id
        JOIN reports f ON m.found_id = f.id
        WHERE m.id=?
    """, (match_id,))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None


def update_match_status(match_id, status):
    """
    Set match status to 'verified' or 'rejected'.
    On verify, close both linked reports so they no longer appear in suggestions.
    """
    conn = get_connection()
    c = conn.cursor()
    c.execute("UPDATE matches SET status=? WHERE id=?", (status, match_id))
    if status == "verified":
        c.execute("SELECT lost_id, found_id FROM matches WHERE id=?", (match_id,))
        row = c.fetchone()
        if row:
            c.execute(
                "UPDATE reports SET status='matched' WHERE id IN (?,?)",
                (row[0], row[1])
            )
    conn.commit(); conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════════════════════

def create_user(name, email, password_hash, contact_info=""):
    """
    Insert a new user. Returns new user id, or None if email already exists.
    contact_info is optional free-text (phone, WhatsApp, etc.) — never public.
    """
    conn = get_connection()
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO users (name, email, password_hash, contact_info) VALUES (?,?,?,?)",
            (name, email, password_hash, contact_info or "")
        )
        new_id = c.lastrowid
        conn.commit()
        return new_id
    except sqlite3.IntegrityError:
        return None  # Duplicate email
    finally:
        conn.close()


def get_user_by_email(email):
    """Return a user dict by email, or None."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE email=?", (email,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_id(user_id):
    """Return a user dict by id, or None."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id=?", (user_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None


# ══════════════════════════════════════════════════════════════════════════════
# CLAIMS
# ══════════════════════════════════════════════════════════════════════════════

def get_contact_for_claim(claim_id, requesting_user_id):
    """
    Return the OTHER party's name and contact_info for an active claim.
    - If requesting_user_id == claimant_id  → return finder's info
    - If requesting_user_id == finder_id    → return claimant's info
    - Otherwise                             → return None (access denied)

    claim_code_hash is NEVER included. Contact info is only revealed
    for claims where the user is a participant.
    """
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        SELECT cl.claimant_id, cl.finder_id, cl.status,
               cu.name AS claimant_name, cu.contact_info AS claimant_contact,
               fu.name AS finder_name,   fu.contact_info AS finder_contact,
               r.item_name
        FROM claims cl
        JOIN users cu ON cl.claimant_id = cu.id
        JOIN users fu ON cl.finder_id   = fu.id
        JOIN reports r ON cl.report_id  = r.id
        WHERE cl.id=?
    """, (claim_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return None
    row = dict(row)
    uid = requesting_user_id
    if uid == row["claimant_id"]:
        return {
            "role":         "claimant",
            "their_name":   row["finder_name"],
            "their_contact":row["finder_contact"] or "(No contact info provided)",
            "item_name":    row["item_name"],
            "claim_status": row["status"],
        }
    elif uid == row["finder_id"]:
        return {
            "role":         "finder",
            "their_name":   row["claimant_name"],
            "their_contact":row["claimant_contact"] or "(No contact info provided)",
            "item_name":    row["item_name"],
            "claim_status": row["status"],
        }
    return None  # not a participant


def create_claim(report_id, claimant_id, finder_id, claim_code_hash):
    """
    Insert a new claim row.
    Returns new claim id, or None if a pending claim already exists for this report+claimant.
    """
    conn = get_connection()
    c = conn.cursor()
    # Prevent duplicate pending claims for the same (report, claimant) pair
    c.execute(
        "SELECT id FROM claims WHERE report_id=? AND claimant_id=? AND status='pending'",
        (report_id, claimant_id)
    )
    if c.fetchone():
        conn.close()
        return None
    c.execute(
        "INSERT INTO claims (report_id, claimant_id, finder_id, claim_code_hash) "
        "VALUES (?,?,?,?)",
        (report_id, claimant_id, finder_id, claim_code_hash)
    )
    new_id = c.lastrowid
    conn.commit(); conn.close()
    return new_id


def get_claim_by_id(claim_id):
    """Return one claim dict (with joined user names and item name), or None."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        SELECT cl.id, cl.report_id, cl.claimant_id, cl.finder_id,
               cl.claim_code_hash, cl.status, cl.created_at, cl.verified_at,
               r.item_name, r.type AS report_type, r.status AS report_status,
               cu.name AS claimant_name, cu.email AS claimant_email,
               fu.name AS finder_name,   fu.email AS finder_email
        FROM claims cl
        JOIN reports r ON cl.report_id   = r.id
        JOIN users  cu ON cl.claimant_id = cu.id
        JOIN users  fu ON cl.finder_id   = fu.id
        WHERE cl.id=?
    """, (claim_id,))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None


def get_claims_for_user(user_id):
    """
    Return all claims where the user is either the claimant or the finder.
    Joined with report and user info. claim_code_hash is intentionally excluded.
    """
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        SELECT cl.id, cl.report_id, cl.claimant_id, cl.finder_id,
               cl.status, cl.created_at, cl.verified_at,
               r.item_name, r.type AS report_type, r.category,
               cu.name AS claimant_name,
               fu.name AS finder_name
        FROM claims cl
        JOIN reports r ON cl.report_id   = r.id
        JOIN users  cu ON cl.claimant_id = cu.id
        JOIN users  fu ON cl.finder_id   = fu.id
        WHERE cl.claimant_id=? OR cl.finder_id=?
        ORDER BY cl.created_at DESC
    """, (user_id, user_id))
    rows = c.fetchall(); conn.close()
    return [dict(r) for r in rows]


def verify_claim(claim_id):
    """
    Mark claim as verified and the linked report as returned.
    Returns True on success.
    """
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        UPDATE claims
        SET status='verified', verified_at=datetime('now','localtime')
        WHERE id=?
    """, (claim_id,))
    # Get the report_id to mark as returned
    c.execute("SELECT report_id FROM claims WHERE id=?", (claim_id,))
    row = c.fetchone()
    if row:
        c.execute("UPDATE reports SET status='returned' WHERE id=?", (row["report_id"],))
    conn.commit(); conn.close()
    return True
