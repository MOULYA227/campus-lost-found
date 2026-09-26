# 🎒 CampusFind — Smart Campus Lost & Found

> **RubiX 2026 Hackathon Project**
> NISB Computer Society · First hackathon for our team of 4 first-year students 🎉

CampusFind is a full-stack web application that helps students on campus report lost and found items and automatically suggests intelligent matches using a transparent scoring algorithm — no machine learning required.

---

## 👥 Team & Responsibilities

| Member | Role | Files Owned |
|--------|------|-------------|
| **Member 1 — Team Lead** | Backend + Integration | `backend/app.py`, GitHub, final testing |
| **Member 2 — Frontend** | HTML, CSS, JavaScript | `frontend/*.html`, `frontend/style.css`, `frontend/script.js` |
| **Member 3 — Database** | SQLite schema + queries | `database/database.py` |
| **Member 4 — Matching Logic** | Scoring algorithm | `matching/matcher.py` |

> **Note for first-year teammates:** You only need to understand your own file to contribute. Each file is heavily commented to explain every decision.

---

## 📁 Folder Structure

```
campus-lost-found/
├── frontend/               # MEMBER 2 — all pages & styles
│   ├── index.html          # Landing page
│   ├── report.html         # Submit lost/found report
│   ├── reports.html        # Browse all reports
│   ├── match.html          # View match suggestions
│   ├── match_detail.html   # Match score + verify/reject
│   ├── style.css           # Global stylesheet
│   └── script.js           # All frontend JavaScript
│
├── backend/                # MEMBER 1 — Flask server
│   ├── app.py              # Routes, API endpoints, image uploads
│   └── requirements.txt    # Python dependencies
│
├── database/               # MEMBER 3 — SQLite
│   └── database.py         # Schema + CRUD helpers
│
├── matching/               # MEMBER 4 — Algorithm
│   └── matcher.py          # Score & reason generation
│
├── uploads/                # Uploaded images (gitignored)
│   └── .gitkeep
│
├── lost_and_found.db       # Auto-created on first run (gitignored)
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.9 or newer
- pip (comes with Python)

### Installation

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd campus-lost-found

# 2. Install Python dependencies
pip install -r backend/requirements.txt

# 3. Start the Flask server
cd backend
python app.py
```

### Open the App

Open your browser and go to: **http://localhost:5000**

That's it! The SQLite database and uploads folder are created automatically on first run.

---

## 🔄 Core Workflow

```
1. User submits LOST item report
      ↓ (saved to SQLite, matching runs automatically)
2. Another user submits FOUND item report
      ↓ (matching runs again)
3. System compares all open LOST vs FOUND reports
      ↓
4. Match suggestions appear on the Matches page with a score + reasons
      ↓
5. User views the match detail page, sees animated score + side-by-side comparison
      ↓
6. User clicks Verify (both reports closed) or Reject (ignored in future)
```

---

## 🧮 Matching Algorithm (Member 4's file: `matching/matcher.py`)

We use **plain Python** — no machine learning. The algorithm is fully transparent.

| Signal | Max Points | Method |
|--------|-----------|--------|
| Category match | 30 | Exact string match |
| Location similarity | 25 | `difflib.SequenceMatcher` ratio × 25 |
| Description similarity | 25 | `difflib.SequenceMatcher` on description + item name |
| Time proximity | 20 | Sliding scale: ≤6 h = 20 pts, ≤24 h = 15 pts, ≤72 h = 8 pts, >72 h = 2 pts |
| **Total** | **100** | |

Only matches scoring **≥ 20** are shown. Each match also carries plain-English "reason" strings displayed on the UI.

---

## 🌐 API Reference (Member 1's file: `backend/app.py`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/reports` | All reports. Params: `?type=lost\|found&category=Electronics` |
| `GET`  | `/api/reports/<id>` | Single report |
| `POST` | `/api/reports` | Submit new report (multipart/form-data) |
| `GET`  | `/api/matches` | All match suggestions |
| `POST` | `/api/matches/refresh` | Re-run the matching algorithm |
| `GET`  | `/api/matches/<id>` | Single match detail |
| `POST` | `/api/matches/<id>/verify` | Mark match as verified |
| `POST` | `/api/matches/<id>/reject` | Mark match as rejected |
| `GET`  | `/uploads/<filename>` | Serve an uploaded image |

---

## 🎨 Design Decisions

- **Color palette:** Deep teal `#1a5f7a` (primary) + warm amber `#e8934a` (accent) — chosen to feel trustworthy and campus-friendly without looking like Bootstrap.
- **Fonts:** Playfair Display (headings) + Inter (body) — serious but approachable.
- **Animations:** Pure CSS `@keyframes` for card reveal; vanilla JS `setInterval` for score counter; CSS `transition` for progress bar fill.
- **No build tools:** Runs directly from `python app.py` with zero npm/webpack.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5 + CSS3 + Vanilla JavaScript |
| Backend | Python + Flask |
| Database | SQLite (built into Python) |
| Images | Local filesystem (`uploads/` folder) |
| Matching | Python `difflib.SequenceMatcher` |

---

## 📝 Development Tips

- **Hot reload:** Flask runs in debug mode by default (`debug=True`), so it auto-restarts when you edit `app.py`.
- **Reset database:** Delete `lost_and_found.db` and restart the server to start fresh.
- **Test the full workflow:** Submit a lost item → submit a found item in the same category → click Refresh Matches → verify the match.
- **CORS:** Everything is served from the same Flask origin, so no CORS issues.

---

*Made with ❤️ by Team CampusFind for RubiX 2026 — NISB Computer Society*
