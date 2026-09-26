"""
database/database.py
--------------------
TEAM MEMBER 3 — Database
Owns the SQLite schema and every read/write helper function.
Flask (app.py) imports these functions to store and retrieve data.
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

    conn.commit()
    conn.close()


def save_report(type_, item_name, category, description, location, date_time, image_file=""):
    """Insert a new report row. Returns the auto-assigned integer id."""
    conn = get_connection()
    c = conn.cursor()
    c.execute(
        "INSERT INTO reports (type,item_name,category,description,location,date_time,image_file) "
        "VALUES (?,?,?,?,?,?,?)",
        (type_, item_name, category, description, location, date_time, image_file)
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
               f.item_name   AS found_item, f.category    AS found_category,
               f.description AS found_desc, f.location    AS found_loc,
               f.date_time   AS found_dt,   f.image_file  AS found_img
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
