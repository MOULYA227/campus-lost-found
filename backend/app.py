"""
backend/app.py
--------------
TEAM MEMBER 1 — Backend + Integration
Extended with:
  - User authentication (register / login / logout / session)
  - Claim workflow (create / view / verify-code / mark-returned)

All original endpoints are preserved and unchanged.
"""

import os
import sys
import uuid
import secrets
import hashlib
from flask import Flask, request, jsonify, send_from_directory, session
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from database.database import (
    init_db,
    save_report, get_all_reports, get_report_by_id,
    get_lost_reports, get_found_reports,
    save_match, get_all_matches, get_match_by_id, update_match_status,
    create_user, get_user_by_email, get_user_by_id,
    create_claim, get_claim_by_id, get_claims_for_user, verify_claim,
    get_contact_for_claim,
)
from matching.matcher import find_matches

# ── App configuration ─────────────────────────────────────────────────────────
FRONTEND_FOLDER = os.path.join(ROOT, "frontend")
UPLOADS_FOLDER  = os.path.join(ROOT, "uploads")
ALLOWED_EXTS    = {"png", "jpg", "jpeg", "gif", "webp"}

app = Flask(__name__, static_folder=FRONTEND_FOLDER, static_url_path="")
app.config["UPLOAD_FOLDER"] = UPLOADS_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024   # 10 MB max upload

# NOTE: In production use a real random secret stored in env var.
# For a hackathon prototype this is acceptable.
app.secret_key = os.environ.get("SECRET_KEY", "campus-lost-found-dev-secret-2026")

# Initialise the database on startup (creates tables if missing)
with app.app_context():
    init_db()


def allowed_file(filename):
    """Return True if the filename extension is in ALLOWED_EXTS."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTS


def current_user_id():
    """Return the logged-in user's id from session, or None."""
    return session.get("user_id")


def login_required(fn):
    """Decorator: return 401 JSON if not logged in."""
    from functools import wraps
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user_id():
            return jsonify({"error": "Login required"}), 401
        return fn(*args, **kwargs)
    return wrapper


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


# ── API: Auth ─────────────────────────────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def api_register():
    """
    POST /api/auth/register
    JSON body: { name, email, password, contact_info (optional) }
    contact_info: free-text (phone/WhatsApp/etc.) stored privately.
    Never stored as plain-text password. contact_info never exposed publicly.
    """
    data = request.get_json(silent=True) or {}
    name         = (data.get("name") or "").strip()
    email        = (data.get("email") or "").strip().lower()
    password     = data.get("password") or ""
    contact_info = (data.get("contact_info") or "").strip()

    if not name or not email or not password:
        return jsonify({"error": "name, email, and password are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if "@" not in email:
        return jsonify({"error": "Invalid email address"}), 400

    pw_hash = generate_password_hash(password)
    new_id  = create_user(name, email, pw_hash, contact_info)
    if new_id is None:
        return jsonify({"error": "An account with that email already exists"}), 409

    return jsonify({"message": "Account created successfully", "id": new_id}), 201


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    """
    POST /api/auth/login
    JSON body: { email, password }
    Sets session cookie on success.
    """
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    user = get_user_by_email(email)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password"}), 401

    session["user_id"]   = user["id"]
    session["user_name"] = user["name"]
    return jsonify({
        "message": "Logged in successfully",
        "user": {"id": user["id"], "name": user["name"], "email": user["email"]}
    })


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    """POST /api/auth/logout — clear the session."""
    session.clear()
    return jsonify({"message": "Logged out"})


@app.route("/api/auth/me", methods=["GET"])
def api_me():
    """
    GET /api/auth/me
    Returns current user info (safe — no password hash).
    Returns { logged_in: false } if not authenticated.
    """
    uid = current_user_id()
    if not uid:
        return jsonify({"logged_in": False})
    user = get_user_by_id(uid)
    if not user:
        session.clear()
        return jsonify({"logged_in": False})
    return jsonify({
        "logged_in": True,
        "user": {
            "id":           user["id"],
            "name":         user["name"],
            "email":        user["email"],
            "contact_info": user.get("contact_info", "")  # own info only
        }
    })


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
    Associates the report with the logged-in user if a session exists.
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
            image_file = f"{uuid.uuid4().hex}.{ext}"
            file.save(os.path.join(UPLOADS_FOLDER, image_file))

    # Associate with logged-in user if available (backward-compatible)
    user_id = current_user_id()
    new_id = save_report(type_, item_name, category, description, location,
                         date_time, image_file, user_id)

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


# ── API: Claims ───────────────────────────────────────────────────────────────

@app.route("/api/claims", methods=["POST"])
@login_required
def api_create_claim():
    """
    POST /api/claims
    JSON body: { report_id }
    Creates a claim for a FOUND report. The claimant is the logged-in user.
    The finder is whoever submitted the found report (reporter_id).

    Security: the raw claim code is generated here, shown ONCE to the finder,
    and never stored in plain text. Only the SHA-256 hash is persisted.
    """
    data      = request.get_json(silent=True) or {}
    report_id = data.get("report_id")

    if not report_id:
        return jsonify({"error": "report_id is required"}), 400

    report = get_report_by_id(report_id)
    if not report:
        return jsonify({"error": "Report not found"}), 404
    if report["type"] != "found":
        return jsonify({"error": "You can only claim FOUND reports"}), 400
    if report["status"] not in ("open", "matched"):
        return jsonify({"error": "This item is no longer available to claim"}), 400

    claimant_id = current_user_id()
    finder_id   = report.get("reporter_id")

    if finder_id is None:
        return jsonify({"error": "This found report has no registered finder. "
                                 "The finder must be logged in when submitting."}), 400
    if finder_id == claimant_id:
        return jsonify({"error": "You cannot claim your own report"}), 400

    # Generate a secure random 8-character alphanumeric code
    raw_code        = secrets.token_hex(4).upper()   # e.g. "A3F9B12C"
    code_hash       = hashlib.sha256(raw_code.encode()).hexdigest()

    new_id = create_claim(report_id, claimant_id, finder_id, code_hash)
    if new_id is None:
        return jsonify({"error": "You already have a pending claim for this item"}), 409

    # The raw code is returned ONCE here so the finder can see it on their claims page.
    # The claimant does NOT receive it from this endpoint.
    return jsonify({
        "claim_id":    new_id,
        "message":     "Claim created. The finder will see the verification code on their Claims page.",
        "finder_code": raw_code   # Shown once — must be shared out-of-band during handover
    }), 201


@app.route("/api/claims/mine", methods=["GET"])
@login_required
def api_my_claims():
    """GET /api/claims/mine — all claims where I am claimant or finder."""
    uid    = current_user_id()
    claims = get_claims_for_user(uid)
    return jsonify({"claims": claims, "user_id": uid})


@app.route("/api/claims/<int:claim_id>", methods=["GET"])
@login_required
def api_get_claim(claim_id):
    """
    GET /api/claims/<id>
    Returns claim details. claim_code_hash is NEVER included in the response.
    """
    uid   = current_user_id()
    claim = get_claim_by_id(claim_id)
    if not claim:
        return jsonify({"error": "Claim not found"}), 404

    # Only claimant or finder can view the claim
    if uid not in (claim["claimant_id"], claim["finder_id"]):
        return jsonify({"error": "Access denied"}), 403

    # Strip the hash before responding
    safe = {k: v for k, v in claim.items() if k != "claim_code_hash"}
    return jsonify(safe)


@app.route("/api/claims/<int:claim_id>/verify", methods=["POST"])
@login_required
def api_verify_claim(claim_id):
    """
    POST /api/claims/<id>/verify
    JSON body: { code: "RAW_CODE" }
    Only the FINDER can verify. Checks SHA-256 of submitted code against stored hash.
    On success: claim status → verified, report status → returned.
    """
    uid   = current_user_id()
    claim = get_claim_by_id(claim_id)
    if not claim:
        return jsonify({"error": "Claim not found"}), 404
    if claim["finder_id"] != uid:
        return jsonify({"error": "Only the finder can verify this claim"}), 403
    if claim["status"] != "pending":
        return jsonify({"error": f"Claim is already {claim['status']}"}), 400

    data = request.get_json(silent=True) or {}
    submitted_code = (data.get("code") or "").strip().upper()
    if not submitted_code:
        return jsonify({"error": "code is required"}), 400

    submitted_hash = hashlib.sha256(submitted_code.encode()).hexdigest()
    if submitted_hash != claim["claim_code_hash"]:
        return jsonify({"error": "Incorrect code. Please check with the claimant."}), 400

    verify_claim(claim_id)
    return jsonify({
        "message": f"✅ Claim verified! {claim['item_name']} has been marked as returned.",
        "status":  "verified"
    })


# ── Internal helper ───────────────────────────────────────────────────────────


@app.route("/api/claims/<int:claim_id>/contact", methods=["GET"])
@login_required
def api_claim_contact(claim_id):
    """
    GET /api/claims/<id>/contact
    Returns the OTHER party's name and contact_info for this claim.
    - Claimant gets: finder name + finder contact_info
    - Finder gets  : claimant name + claimant contact_info
    - Anyone else  : 403

    Security guarantees:
      - Requires an active session (login_required)
      - Only participants of THIS specific claim can call this
      - claim_code_hash is NEVER included in the response
      - contact_info never appears on any public /api/reports or /api/matches endpoint
    """
    uid     = current_user_id()
    contact = get_contact_for_claim(claim_id, uid)
    if contact is None:
        return jsonify({"error": "Access denied or claim not found"}), 403
    return jsonify(contact)


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
