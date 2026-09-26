/**
 * script.js
 * ---------
 * TEAM MEMBER 2 — Frontend JavaScript
 * Handles: API calls, rendering cards, filters, match score animation,
 *          form submission micro-interactions, image preview, toasts.
 *
 * All pages share this single file. Functions are guarded with
 *   if (document.getElementById("..."))
 * so they only activate on the relevant page.
 */

"use strict";

/* ============================================================
   GLOBAL UTILITIES
   ============================================================ */

/**
 * Show a toast notification at the bottom-right of the screen.
 * @param {string} message
 * @param {"success"|"error"} type
 */
function showToast(message, type = "success") {
  // Remove existing toast if any
  const old = document.querySelector(".toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.className = "toast" + (type === "error" ? " error" : "");
  toast.innerHTML = `<span>${type === "success" ? "✅" : "❌"}</span> ${message}`;
  document.body.appendChild(toast);

  // Trigger transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("show"));
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

/**
 * Format an ISO date-time string into a friendly readable form.
 * e.g. "2024-03-15T14:30" → "Mar 15, 2024 · 2:30 PM"
 */
function formatDateTime(dt) {
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
         + " · "
         + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dt;
  }
}

/**
 * Category emoji map for visual flair on cards.
 */
const CATEGORY_EMOJI = {
  "Electronics":   "📱",
  "Clothing":      "👕",
  "Accessories":   "👜",
  "Books/Notes":   "📚",
  "ID/Cards":      "🪪",
  "Keys":          "🔑",
  "Glasses":       "👓",
  "Stationery":    "✏️",
  "Sports":        "⚽",
  "Food/Drink":    "🧴",
  "Other":         "📦",
};

/**
 * Build the image src string for a report.
 * Uses the placeholder if no image is saved.
 */
function imgSrc(report, cls = "card__img") {
  if (report.image_file) {
    return `<img class="${cls}" src="/uploads/${report.image_file}" alt="${report.item_name}" loading="lazy">`;
  }
  const emoji = CATEGORY_EMOJI[report.category] || "📦";
  return `<div class="card__img-placeholder">
    <span class="icon">${emoji}</span>
    <span>No photo</span>
  </div>`;
}

/**
 * Calculate the CSS class for a match score (high / medium / low).
 */
function scoreClass(score) {
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}


/* ============================================================
   REPORT CARD HTML
   ============================================================ */

/**
 * Render one report as a card HTML string.
 * @param {Object} r — report dict from the API
 * @param {number} delay — animation delay index (for staggered reveal)
 */
function reportCardHTML(r, delay = 0) {
  const emoji = CATEGORY_EMOJI[r.category] || "📦";
  const typeLabel = r.type === "lost"
    ? `<span class="card__tag lost">🔍 Lost</span>`
    : `<span class="card__tag found">✅ Found</span>`;

  return `
    <div class="card card-anim" style="animation-delay:${delay * 80}ms"
         data-type="${r.type}" data-category="${r.category}" data-id="${r.id}">
      ${r.image_file
        ? `<img class="card__img" src="/uploads/${r.image_file}" alt="${r.item_name}" loading="lazy">`
        : `<div class="card__img-placeholder"><span class="icon">${emoji}</span><span>No photo</span></div>`
      }
      <div class="card__body">
        ${typeLabel}
        <div class="card__title"><strong>${escapeHtml(r.item_name)}</strong></div>
        <p style="font-size:.88rem;margin:.35rem 0 0;color:var(--clr-muted)">
          ${escapeHtml((r.description || "").slice(0, 90))}${r.description && r.description.length > 90 ? "…" : ""}
        </p>
        <div class="card__meta">
          <span>📍 ${escapeHtml(r.location)}</span>
          <span>🕐 ${formatDateTime(r.date_time)}</span>
          <span>${emoji} ${escapeHtml(r.category)}</span>
        </div>
      </div>
    </div>`;
}

/** Escape HTML to prevent XSS from user-supplied text. */
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}


/* ============================================================
   HOME PAGE  (index.html)
   ============================================================ */

async function initHomePage() {
  const statsContainer = document.getElementById("stats-container");
  if (!statsContainer) return;

  try {
    const [allReports, allMatches] = await Promise.all([
      fetch("/api/reports").then(r => r.json()),
      fetch("/api/matches").then(r => r.json()),
    ]);
    const lost     = allReports.filter(r => r.type === "lost");
    const found    = allReports.filter(r => r.type === "found");
    const verified = allMatches.filter(m => m.status === "verified");

    statsContainer.innerHTML = `
      <div class="stat-item">
        <div class="stat-item__num">${allReports.length}</div>
        <div class="stat-item__lbl">Total Reports</div>
      </div>
      <div class="stat-item">
        <div class="stat-item__num" style="color:var(--clr-lost)">${lost.length}</div>
        <div class="stat-item__lbl">Lost Items</div>
      </div>
      <div class="stat-item">
        <div class="stat-item__num" style="color:var(--clr-found)">${found.length}</div>
        <div class="stat-item__lbl">Found Items</div>
      </div>
      <div class="stat-item">
        <div class="stat-item__num" style="color:var(--clr-accent)">${verified.length}</div>
        <div class="stat-item__lbl">Reunions ✨</div>
      </div>
    `;
  } catch (e) {
    statsContainer.innerHTML = "<p style='color:var(--clr-muted)'>Could not load stats.</p>";
  }
}


/* ============================================================
   REPORT FORM PAGE  (report.html)
   ============================================================ */

function initReportForm() {
  const form = document.getElementById("report-form");
  if (!form) return;

  // ── Image preview ──────────────────────────────────────────
  const imageInput   = document.getElementById("image");
  const uploadArea   = document.getElementById("upload-area");
  const uploadPreview = document.getElementById("upload-preview");

  imageInput && imageInput.addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      uploadPreview.src = e.target.result;
      uploadPreview.style.display = "block";
      uploadArea.querySelector(".upload-hint").style.display = "none";
    };
    reader.readAsDataURL(file);
  });

  uploadArea && uploadArea.addEventListener("click", () => imageInput && imageInput.click());

  // Drag-and-drop
  uploadArea && uploadArea.addEventListener("dragover", e => {
    e.preventDefault(); uploadArea.classList.add("drag-over");
  });
  uploadArea && uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea && uploadArea.addEventListener("drop", e => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    if (e.dataTransfer.files[0] && imageInput) {
      const dt = new DataTransfer();
      dt.items.add(e.dataTransfer.files[0]);
      imageInput.files = dt.files;
      imageInput.dispatchEvent(new Event("change"));
    }
  });

  // ── Form submit ────────────────────────────────────────────
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const btn      = document.getElementById("submit-btn");
    const btnText  = btn.querySelector(".btn-text");
    const spinner  = btn.querySelector(".spinner");

    // Loading state
    btn.disabled = true;
    btn.classList.add("loading");
    btnText.textContent = "Submitting…";

    const formData = new FormData(form);

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Submission failed");

      // Success animation
      btn.classList.remove("loading");
      btn.classList.add("btn-success");
      btnText.textContent = "✅ Submitted!";
      spinner.style.display = "none";

      showToast("Report submitted successfully!", "success");

      // Redirect after 1.8 s
      setTimeout(() => {
        window.location.href = "reports.html";
      }, 1800);

    } catch (err) {
      btn.disabled = false;
      btn.classList.remove("loading");
      btnText.textContent = "Submit Report";
      showToast(err.message, "error");
    }
  });
}


/* ============================================================
   BROWSE REPORTS PAGE  (reports.html)
   ============================================================ */

let allReportsCache = [];

async function initBrowsePage() {
  const grid = document.getElementById("reports-grid");
  if (!grid) return;

  // Show skeletons while loading
  grid.innerHTML = Array(6).fill(
    `<div class="card" style="height:320px">
       <div class="skeleton" style="width:100%;height:180px"></div>
       <div class="card__body">
         <div class="skeleton" style="width:60%;height:18px;margin-bottom:.75rem"></div>
         <div class="skeleton" style="width:90%;height:14px;margin-bottom:.5rem"></div>
         <div class="skeleton" style="width:70%;height:14px"></div>
       </div>
     </div>`
  ).join("");

  try {
    const reports = await fetch("/api/reports").then(r => r.json());
    allReportsCache = reports;
    renderReports(reports);
  } catch {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">⚠️</div>
      <h3>Could not load reports</h3>
      <p>Make sure the Flask server is running.</p>
    </div>`;
  }

  // Wire up filter chips
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      // For type chips, toggle exclusive; for "all", reset
      const filterGroup = chip.dataset.group;
      if (filterGroup === "type") {
        document.querySelectorAll("[data-group='type']").forEach(c => c.classList.remove("active"));
      }
      if (filterGroup === "category") {
        document.querySelectorAll("[data-group='category']").forEach(c => c.classList.remove("active"));
      }
      chip.classList.toggle("active");
      applyFilters();
    });
  });

  // Category select
  const catSelect = document.getElementById("filter-category");
  catSelect && catSelect.addEventListener("change", applyFilters);
}

function applyFilters() {
  const activeType = document.querySelector("[data-group='type'].active");
  const typeVal    = activeType ? activeType.dataset.value : null;

  const catSelect  = document.getElementById("filter-category");
  const catVal     = catSelect && catSelect.value ? catSelect.value : null;

  const filtered = allReportsCache.filter(r => {
    if (typeVal && r.type !== typeVal) return false;
    if (catVal  && r.category !== catVal) return false;
    return true;
  });

  renderReports(filtered);
}

function renderReports(reports) {
  const grid = document.getElementById("reports-grid");
  if (!reports.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">🔍</div>
      <h3>No reports found</h3>
      <p>Try adjusting your filters, or be the first to submit a report!</p>
    </div>`;
    return;
  }
  grid.innerHTML = reports.map((r, i) => reportCardHTML(r, i)).join("");
}


/* ============================================================
   MATCH PAGE  (match.html)
   ============================================================ */

async function initMatchPage() {
  const matchGrid = document.getElementById("matches-grid");
  if (!matchGrid) return;

  try {
    const matches = await fetch("/api/matches").then(r => r.json());
    renderMatchCards(matches);
  } catch {
    matchGrid.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">⚠️</div>
      <h3>Could not load matches</h3>
      <p>Make sure the Flask server is running.</p>
    </div>`;
  }

  // Refresh button
  const refreshBtn = document.getElementById("refresh-matches-btn");
  refreshBtn && refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "🔄 Scanning…";
    try {
      const data = await fetch("/api/matches/refresh", { method: "POST" }).then(r => r.json());
      renderMatchCards(data.matches);
      showToast(`Found ${data.count} possible match(es)`, "success");
    } catch {
      showToast("Refresh failed", "error");
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "🔄 Refresh Matches";
    }
  });
}

function renderMatchCards(matches) {
  const grid = document.getElementById("matches-grid");
  const pending = matches.filter(m => m.status === "pending");

  if (!pending.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-state__icon">🤝</div>
      <h3>No pending matches</h3>
      <p>Submit more reports or click <strong>Refresh Matches</strong> to scan again.</p>
    </div>`;
    return;
  }

  grid.innerHTML = pending.map((m, i) => {
    const sc = scoreClass(m.score);
    return `
      <div class="match-card card-anim" style="animation-delay:${i * 80}ms">
        <div style="display:flex;gap:1rem;align-items:center;margin-bottom:1rem">
          <div class="match-score-ring ${sc}">
            ${m.score}<span style="font-size:.6rem">/100</span>
          </div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:.85rem;color:var(--clr-muted);margin-bottom:.25rem">
              MATCH SCORE
            </div>
            <div style="font-size:.82rem;color:var(--clr-muted)">
              ${m.reasons.split("|").slice(0, 2).map(r => `<span>• ${escapeHtml(r)}</span>`).join(" ")}
            </div>
          </div>
        </div>

        <div class="match-pair">
          <div class="match-item-box lost">
            <div style="font-size:.72rem;font-weight:700;color:var(--clr-lost);text-transform:uppercase;letter-spacing:.06em">Lost</div>
            <div style="font-weight:600;margin:.2rem 0">${escapeHtml(m.lost_item)}</div>
            <div style="font-size:.82rem;color:var(--clr-muted)">📍 ${escapeHtml(m.lost_loc)}</div>
          </div>
          <div class="match-arrow">⇄</div>
          <div class="match-item-box found">
            <div style="font-size:.72rem;font-weight:700;color:var(--clr-found);text-transform:uppercase;letter-spacing:.06em">Found</div>
            <div style="font-weight:600;margin:.2rem 0">${escapeHtml(m.found_item)}</div>
            <div style="font-size:.82rem;color:var(--clr-muted)">📍 ${escapeHtml(m.found_loc)}</div>
          </div>
        </div>

        <div style="margin-top:1rem;text-align:right">
          <a href="match_detail.html?id=${m.id}" class="btn btn-secondary" style="font-size:.85rem;padding:.55rem 1.1rem">
            View Details →
          </a>
        </div>
      </div>`;
  }).join("");
}


/* ============================================================
   MATCH DETAIL PAGE  (match_detail.html)
   ============================================================ */

async function initMatchDetailPage() {
  const container = document.getElementById("match-detail-container");
  if (!container) return;

  const params  = new URLSearchParams(window.location.search);
  const matchId = params.get("id");

  if (!matchId) {
    container.innerHTML = "<p>Invalid match ID.</p>";
    return;
  }

  try {
    const m = await fetch(`/api/matches/${matchId}`).then(r => r.json());
    if (m.error) throw new Error(m.error);

    const sc = scoreClass(m.score);
    const reasons = m.reasons.split("|");

    container.innerHTML = `
      <!-- Score meter -->
      <div class="score-meter">
        <div class="score-meter__label">Match Confidence Score</div>
        <div class="score-meter__number" id="score-num">0</div>
        <div class="score-bar-track">
          <div class="score-bar-fill ${sc}" id="score-bar"></div>
        </div>
        <div class="reasons-list" style="margin-top:1rem">
          ${reasons.map(r => `<span class="reason-pill">${escapeHtml(r)}</span>`).join("")}
        </div>
        <div style="margin-top:.75rem">
          <span class="status-badge ${m.status}">${m.status.toUpperCase()}</span>
        </div>
      </div>

      <!-- Side-by-side comparison -->
      <div class="comparison-grid">
        ${comparisonBoxHTML(m, "lost")}
        <div class="comparison-vs">VS</div>
        ${comparisonBoxHTML(m, "found")}
      </div>

      <!-- Action buttons -->
      ${m.status === "pending" ? `
      <div class="action-row" id="action-row">
        <button class="btn btn-success" id="verify-btn">✅ Verify — It's a Match!</button>
        <button class="btn btn-danger"  id="reject-btn">❌ Reject — Not a Match</button>
        <a href="match.html" class="btn btn-secondary" style="background:transparent;color:var(--clr-muted);border-color:var(--clr-border)">← Back</a>
      </div>
      ` : `
      <div class="action-row">
        <a href="match.html" class="btn btn-secondary">← Back to Matches</a>
      </div>
      `}
    `;

    // Animate score counter
    animateScore(m.score, sc);

    // Wire action buttons
    wireDetailActions(matchId);

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Match not found</h3><p>${err.message}</p></div>`;
  }
}

/**
 * Build the HTML for one comparison box (lost or found side).
 */
function comparisonBoxHTML(m, side) {
  const prefix = side;
  const label  = side === "lost" ? "🔍 Lost Item" : "✅ Found Item";
  const imgFile = m[`${prefix}_img`];

  return `
    <div class="comparison-box">
      <div class="comparison-box__header ${side}">
        <span class="card__tag ${side}">${label}</span>
        <div style="font-size:1.1rem;font-weight:700;margin-top:.4rem">${escapeHtml(m[prefix + "_item"])}</div>
      </div>
      ${imgFile
        ? `<img class="comparison-box__img" src="/uploads/${imgFile}" alt="${m[prefix + "_item"]}">`
        : `<div class="comparison-box__img" style="display:flex;align-items:center;justify-content:center;background:var(--clr-bg);height:180px;color:var(--clr-muted);font-size:.9rem">No photo</div>`
      }
      <div class="comparison-box__body">
        <div class="comparison-box__field">
          <div class="field-label">Category</div>
          <div class="field-value">${escapeHtml(m[prefix + "_category"])}</div>
        </div>
        <div class="comparison-box__field">
          <div class="field-label">Location</div>
          <div class="field-value">📍 ${escapeHtml(m[prefix + "_loc"])}</div>
        </div>
        <div class="comparison-box__field">
          <div class="field-label">Date / Time</div>
          <div class="field-value">🕐 ${formatDateTime(m[prefix + "_dt"])}</div>
        </div>
        <div class="comparison-box__field">
          <div class="field-label">Description</div>
          <div class="field-value">${escapeHtml(m[prefix + "_desc"] || "—")}</div>
        </div>
      </div>
    </div>`;
}

/**
 * Animate the score number counting up and the progress bar filling.
 */
function animateScore(targetScore, cls) {
  const numEl  = document.getElementById("score-num");
  const barEl  = document.getElementById("score-bar");
  if (!numEl || !barEl) return;

  // Counter animation
  let current = 0;
  const step  = targetScore / 60;   // 60 frames ≈ 1 second
  const timer = setInterval(() => {
    current = Math.min(current + step, targetScore);
    numEl.textContent = Math.round(current);
    if (current >= targetScore) clearInterval(timer);
  }, 16);

  // Bar fill — small delay so CSS transition is visible
  setTimeout(() => {
    barEl.style.width = targetScore + "%";
  }, 100);
}

function wireDetailActions(matchId) {
  const verifyBtn = document.getElementById("verify-btn");
  const rejectBtn = document.getElementById("reject-btn");

  verifyBtn && verifyBtn.addEventListener("click", async () => {
    verifyBtn.disabled = true; rejectBtn.disabled = true;
    try {
      await fetch(`/api/matches/${matchId}/verify`, { method: "POST" });
      showToast("Match verified! Both reports are now closed. 🎉", "success");
      document.getElementById("action-row").innerHTML = `
        <div style="font-weight:600;color:var(--clr-found)">✅ Match verified!</div>
        <a href="match.html" class="btn btn-secondary">← Back to Matches</a>
      `;
    } catch {
      showToast("Could not verify. Try again.", "error");
      verifyBtn.disabled = false; rejectBtn.disabled = false;
    }
  });

  rejectBtn && rejectBtn.addEventListener("click", async () => {
    verifyBtn.disabled = true; rejectBtn.disabled = true;
    try {
      await fetch(`/api/matches/${matchId}/reject`, { method: "POST" });
      showToast("Match rejected. It will be removed from suggestions.", "success");
      document.getElementById("action-row").innerHTML = `
        <div style="font-weight:600;color:var(--clr-lost)">❌ Match rejected.</div>
        <a href="match.html" class="btn btn-secondary">← Back to Matches</a>
      `;
    } catch {
      showToast("Could not reject. Try again.", "error");
      verifyBtn.disabled = false; rejectBtn.disabled = false;
    }
  });
}


/* ============================================================
   ROUTER — initialise the right page on DOMContentLoaded
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  initHomePage();
  initReportForm();
  initBrowsePage();
  initMatchPage();
  initMatchDetailPage();

  // Highlight active nav link
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav__links a").forEach(a => {
    if (a.getAttribute("href") === currentPage ||
        (currentPage === "" && a.getAttribute("href") === "index.html")) {
      a.classList.add("active");
    }
  });
});
