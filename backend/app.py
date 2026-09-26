"""
backend/app.py
--------------
TEAM MEMBER 1 — Backend + Integration
This is the Flask web server.  It:
  - Serves all HTML pages from the frontend/ folder
  - Provides a REST-like JSON API for the frontend to call
  - Handles image uploads (saves files to uploads/)
  - Runs the matching algorithm on demand

How to start the server:
    cd backend
    pip install -r requirements.txt
    python app.py

Then open http://localhost:5000 in your browser.
"""

import os
import sys
import uuid
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename

# ── Path setup ────────────────────────────────────────────────────────────────
# Makes sure Python can find the database/ and matching/ folders
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from database.database import (
    init_db, save_report, get_all_reports, get_report_by_id,
    get_lost_reports, get_found_reports,
    save_match, get_all_matches, get_match_by_id, update_match_status
)
from matching.matcher import find_matches

# ── App configuration ─────────────────────────────────────────────────────────
FRONTEND_FOLDER = os.path.join(ROOT, "frontend")
UPLOADS_FOLDER  = os.path.join(ROOT, "uploads")
ALLOWED_EXTS    = {"png", "jpg", "jpeg", "gif", "webp"}

app = Flask(__name__, static_folder=FRONTEND_FOLDER, static_url_path="")
app.config["UPLOAD_FOLDER"] = UPLOADS_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024   # 10 MB max upload

# Initialise the database on startup (creates tables if missing)
with app.app_context():
    init_db()


def allowed_file(filename):
    """Return True if the filename extension is in ALLOWED_EXTS."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTS


# ── Static page routes ────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the landing page."""
    return send_from_directory(FRONTEND_FOLDER, "index.html")

@app.route("/<page>.html")
def serve_page(page):
    """Serve any .html file from the frontend/ folder."""
    return send_from_directory(FRONTEND_FOLDER, f"{page}.html")

@app.route("/style.css")
def serve_css():
    return send_from_directory(FRONTEND_FOLDER, "style.css")

@app.route("/script.js")
def serve_js():
    return send_from_directory(FRONTEND_FOLDER, "script.js")

@app.route("/uploads/<filename>")
def serve_upload(filename):
    """Serve an uploaded image file."""
    return send_from_directory(UPLOADS_FOLDER, filename)


# ── API: Reports ──────────────────────────────────────────────────────────────

@app.route("/api/reports", methods=["GET"])
def api_get_reports():
    """
    GET /api/reports
    Optional query params: ?type=lost|found  &category=Electronics
    Returns JSON list of reports.
    """
    filter_type     = request.args.get("type")
    filter_category = request.args.get("category")
    reports = get_all_reports(filter_type, filter_category)
    return jsonify(reports)


@app.route("/api/reports/<int:report_id>", methods=["GET"])
def api_get_report(report_id):
    """GET /api/reports/<id>  — single report."""
    report = get_report_by_id(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404
    return jsonify(report)


@app.route("/api/reports", methods=["POST"])
def api_submit_report():
    """
    POST /api/reports  (multipart/form-data)
    Fields: type, item_name, category, description, location, date_time
    File  : image (optional)
    Returns the new report id.
    """
    # ── Validate required fields ─────────────────────────────────────────
    required = ["type", "item_name", "category", "location", "date_time"]
    for field in required:
        if not request.form.get(field):
            return jsonify({"error": f"Missing field: {field}"}), 400

    type_       = request.form["type"].lower()
    item_name   = request.form["item_name"].strip()
    category    = request.form["category"].strip()
    description = request.form.get("description", "").strip()
    location    = request.form["location"].strip()
    date_time   = request.form["date_time"]

    if type_ not in ("lost", "found"):
        return jsonify({"error": "type must be lost or found"}), 400

    # ── Handle optional image upload ─────────────────────────────────────
    image_file = ""
    if "image" in request.files:
        file = request.files["image"]
        if file and file.filename and allowed_file(file.filename):
            ext = file.filename.rsplit(".", 1)[1].lower()
            # Use a UUID so filenames are unique and safe
            image_file = f"{uuid.uuid4().hex}.{ext}"
            file.save(os.path.join(UPLOADS_FOLDER, image_file))

    new_id = save_report(type_, item_name, category, description, location, date_time, image_file)

    # Immediately run matching so new suggestions are available at once
    _refresh_matches()

    return jsonify({"id": new_id, "message": "Report saved successfully"}), 201


# ── API: Matches ──────────────────────────────────────────────────────────────

@app.route("/api/matches", methods=["GET"])
def api_get_matches():
    """GET /api/matches  — all match suggestions."""
    matches = get_all_matches()
    return jsonify(matches)


@app.route("/api/matches/refresh", methods=["POST"])
def api_refresh_matches():
    """POST /api/matches/refresh  — rerun the matching algorithm."""
    _refresh_matches()
    matches = get_all_matches()
    return jsonify({"count": len(matches), "matches": matches})


@app.route("/api/matches/<int:match_id>", methods=["GET"])
def api_get_match(match_id):
    """GET /api/matches/<id>  — single match detail."""
    match = get_match_by_id(match_id)
    if not match:
        return jsonify({"error": "Match not found"}), 404
    return jsonify(match)


@app.route("/api/matches/<int:match_id>/verify", methods=["POST"])
def api_verify_match(match_id):
    """POST /api/matches/<id>/verify  — mark a match as verified."""
    update_match_status(match_id, "verified")
    return jsonify({"message": "Match verified"})


@app.route("/api/matches/<int:match_id>/reject", methods=["POST"])
def api_reject_match(match_id):
    """POST /api/matches/<id>/reject  — mark a match as rejected."""
    update_match_status(match_id, "rejected")
    return jsonify({"message": "Match rejected"})


# ── Internal helper ───────────────────────────────────────────────────────────

def _refresh_matches():
    """
    Run the matcher on all open reports and persist any new matches found.
    Called automatically after every new report submission.
    """
    lost_reports  = get_lost_reports()
    found_reports = get_found_reports()
    suggested     = find_matches(lost_reports, found_reports)

    for m in suggested:
        reasons_str = "|".join(m["reasons"])
        save_match(m["lost_id"], m["found_id"], m["score"], reasons_str)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n  Smart Campus Lost & Found — Flask Server")
    print("  Open: http://localhost:5000\n")
    app.run(debug=True, port=5000)
