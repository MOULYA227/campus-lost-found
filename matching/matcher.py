"""
matching/matcher.py
-------------------
TEAM MEMBER 4 — Matching Logic
Compares every open LOST report against every open FOUND report and
produces a ranked list of possible matches with an explainable score.

Scoring breakdown (max 100 points):
  Category match       : 30 pts  — exact same category
  Location similarity  : 25 pts  — SequenceMatcher on location strings
  Description similarity: 25 pts — SequenceMatcher on description strings
  Time proximity       : 20 pts  — sliding scale (0 h=full, >72 h=0)

No machine learning — just transparent string comparison and simple maths.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from difflib import SequenceMatcher
from datetime import datetime

# Only matches with a score >= this threshold are returned
MIN_SCORE = 20


def _similarity(a: str, b: str) -> float:
    """
    Return a 0.0–1.0 similarity ratio between two strings.
    SequenceMatcher finds the longest common subsequences.
    Lowercasing first so 'Library' and 'library' still match.
    """
    a = (a or "").lower().strip()
    b = (b or "").lower().strip()
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _time_score(dt_lost: str, dt_found: str, max_pts: int = 20) -> float:
    """
    Award more points the closer the two timestamps are.
    - Within 6 hours  → full points
    - 6–24 hours      → 75 %
    - 24–72 hours     → 40 %
    - Beyond 72 hours → 10 %  (could still match, just less likely)
    """
    fmt = "%Y-%m-%dT%H:%M"
    try:
        t_lost  = datetime.strptime(dt_lost[:16],  fmt)
        t_found = datetime.strptime(dt_found[:16], fmt)
    except (ValueError, TypeError):
        return max_pts * 0.1   # Can't parse → give minimal credit

    diff_hours = abs((t_lost - t_found).total_seconds()) / 3600

    if diff_hours <= 6:
        factor = 1.0
    elif diff_hours <= 24:
        factor = 0.75
    elif diff_hours <= 72:
        factor = 0.40
    else:
        factor = 0.10

    return round(max_pts * factor, 2)


def score_pair(lost: dict, found: dict) -> tuple[float, list[str]]:
    """
    Given one LOST report dict and one FOUND report dict,
    return (total_score, [reason_strings]).

    reason_strings explain *why* the score is what it is —
    displayed on the match detail page for transparency.
    """
    total = 0.0
    reasons = []

    # ── 1. Category (30 pts) ────────────────────────────────────────────
    if lost["category"].lower() == found["category"].lower():
        total += 30
        reasons.append(f"Same category: {lost['category']}")
    else:
        reasons.append(f"Different categories: {lost['category']} vs {found['category']}")

    # ── 2. Location similarity (25 pts) ─────────────────────────────────
    loc_ratio = _similarity(lost["location"], found["location"])
    loc_pts   = round(loc_ratio * 25, 2)
    total    += loc_pts
    if loc_ratio >= 0.8:
        reasons.append(f"Very similar location ({int(loc_ratio*100)}% match)")
    elif loc_ratio >= 0.5:
        reasons.append(f"Somewhat similar location ({int(loc_ratio*100)}% match)")
    elif loc_ratio > 0:
        reasons.append(f"Location partially overlaps ({int(loc_ratio*100)}% match)")
    else:
        reasons.append("Locations do not overlap")

    # ── 3. Description similarity (25 pts) ──────────────────────────────
    desc_ratio = _similarity(
        (lost.get("description") or "") + " " + lost["item_name"],
        (found.get("description") or "") + " " + found["item_name"]
    )
    desc_pts  = round(desc_ratio * 25, 2)
    total    += desc_pts
    if desc_ratio >= 0.6:
        reasons.append(f"Descriptions are very similar ({int(desc_ratio*100)}% match)")
    elif desc_ratio >= 0.3:
        reasons.append(f"Descriptions share common keywords ({int(desc_ratio*100)}% match)")
    else:
        reasons.append("Descriptions have little overlap")

    # ── 4. Time proximity (20 pts) ──────────────────────────────────────
    time_pts = _time_score(lost["date_time"], found["date_time"])
    total   += time_pts
    reasons.append(f"Time proximity score: {int(time_pts)}/20")

    return round(total, 1), reasons


def find_matches(lost_reports: list, found_reports: list) -> list[dict]:
    """
    Cross-compare all open LOST reports with all open FOUND reports.
    Returns a sorted list of match dicts (highest score first),
    filtered to >= MIN_SCORE.

    Each dict:
      lost_id, found_id, score (0–100), reasons (list of strings)
    """
    results = []

    for lost in lost_reports:
        for found in found_reports:
            score, reasons = score_pair(lost, found)
            if score >= MIN_SCORE:
                results.append({
                    "lost_id":  lost["id"],
                    "found_id": found["id"],
                    "score":    score,
                    "reasons":  reasons,
                })

    # Sort: best score first
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
