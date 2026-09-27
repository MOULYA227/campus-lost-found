/**
 * script.js — CampusFind (extended with Auth + Claims)
 */
"use strict";

/* ── GLOBAL UTILITIES ─────────────────────────────────────────────────── */

function showToast(message, type = "success") {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = "toast" + (type === "error" ? " error" : "");
  toast.innerHTML = `<span>${type === "success" ? "✅" : "❌"}</span> ${message}`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 3500);
}

function formatDateTime(dt) {
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
         + " · "
         + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return dt; }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

const CATEGORY_EMOJI = {
  "Electronics": "📱", "Clothing": "👕", "Accessories": "👜",
  "Books/Notes": "📚", "ID/Cards": "🪪", "Keys": "🔑",
  "Glasses": "👓", "Stationery": "✏️", "Sports": "⚽",
  "Food/Drink": "🧴", "Other": "📦",
};

function scoreClass(score) {
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

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
        : `<div class="card__img-placeholder"><span class="icon">${emoji}</span><span>No photo</span></div>`}
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

/* ── AUTH STATE (runs on every page) ──────────────────────────────────── */

let _currentUser = null;

async function initAuthState() {
  const navAuth = document.getElementById("nav-auth");
  if (!navAuth) return;
  try {
    const res  = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.logged_in) {
      _currentUser = data.user;
      navAuth.innerHTML = `
        <span class="nav__user">👤 ${escapeHtml(data.user.name)}</span>
        <button class="btn btn-outline nav__logout-btn" id="logout-btn">Logout</button>`;
      document.getElementById("logout-btn").addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        showToast("Logged out successfully");
        setTimeout(() => window.location.href = "index.html", 800);
      });
    } else {
      _currentUser = null;
      navAuth.innerHTML = `
        <a href="login.html"    class="btn btn-outline"  style="padding:.4rem .9rem;font-size:.85rem">Login</a>
        <a href="register.html" class="btn btn-primary"  style="padding:.4rem .9rem;font-size:.85rem">Register</a>`;
    }
  } catch (e) {
    // Server might not be ready — fail silently
  }
}

/* ── HOME PAGE ────────────────────────────────────────────────────────── */

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
      <div class="stat-item"><div class="stat-item__num">${allReports.length}</div><div class="stat-item__lbl">Total Reports</div></div>
      <div class="stat-item"><div class="stat-item__num" style="color:var(--clr-lost)">${lost.length}</div><div class="stat-item__lbl">Lost Items</div></div>
      <div class="stat-item"><div class="stat-item__num" style="color:var(--clr-found)">${found.length}</div><div class="stat-item__lbl">Found Items</div></div>
      <div class="stat-item"><div class="stat-item__num" style="color:var(--clr-accent)">${verified.length}</div><div class="stat-item__lbl">Reunions ✨</div></div>`;
  } catch {
    statsContainer.innerHTML = "<p style='color:var(--clr-muted)'>Could not load stats.</p>";
  }
}

/* ── REGISTER PAGE ────────────────────────────────────────────────────── */

function initRegisterPage() {
  const form = document.getElementById("register-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const btn     = document.getElementById("reg-submit-btn");
    const btnText = btn.querySelector(".btn-text");
    const spinner = btn.querySelector(".spinner");
    btn.disabled = true; btn.classList.add("loading");
    btnText.textContent = "Creating account…";
    const name     = document.getElementById("reg-name").value.trim();
    const email    = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const confirm  = document.getElementById("reg-confirm").value;
    if (password !== confirm) {
      btn.disabled = false; btn.classList.remove("loading");
      btnText.textContent = "Create Account";
      showToast("Passwords do not match", "error"); return;
    }
    try {
      const res  = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      showToast("Account created! Redirecting to login…");
      setTimeout(() => window.location.href = "login.html", 1500);
    } catch (err) {
      btn.disabled = false; btn.classList.remove("loading");
      btnText.textContent = "Create Account";
      showToast(err.message, "error");
    }
  });
}

/* ── LOGIN PAGE ───────────────────────────────────────────────────────── */

function initLoginPage() {
  const form = document.getElementById("login-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const btn     = document.getElementById("login-submit-btn");
    const btnText = btn.querySelector(".btn-text");
    btn.disabled = true; btn.classList.add("loading");
    btnText.textContent = "Logging in…";
    const email    = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      const res  = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      showToast(`Welcome back, ${data.user.name}!`);
      const redirect = new URLSearchParams(window.location.search).get("next") || "index.html";
      setTimeout(() => window.location.href = redirect, 1000);
    } catch (err) {
      btn.disabled = false; btn.classList.remove("loading");
      btnText.textContent = "Log In";
      showToast(err.message, "error");
    }
  });
}

/* ── REPORT FORM PAGE ─────────────────────────────────────────────────── */

function initReportForm() {
  const form = document.getElementById("report-form");
  if (!form) return;

  // Image preview
  const imageInput    = document.getElementById("image");
  const uploadArea    = document.getElementById("upload-area");
  const uploadPreview = document.getElementById("upload-preview");

  imageInput && imageInput.addEventListener("change", function () {
    const file = this.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      uploadPreview.src = e.target.result;
      uploadPreview.style.display = "block";
      uploadArea.querySelector(".upload-hint").style.display = "none";
    };
    reader.readAsDataURL(file);
  });
  uploadArea && uploadArea.addEventListener("click", () => imageInput && imageInput.click());
  uploadArea && uploadArea.addEventListener("dragover", e => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea && uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea && uploadArea.addEventListener("drop", e => {
    e.preventDefault(); uploadArea.classList.remove("drag-over");
    if (e.dataTransfer.files[0] && imageInput) {
      const dt = new DataTransfer(); dt.items.add(e.dataTransfer.files[0]);
      imageInput.files = dt.files; imageInput.dispatchEvent(new Event("change"));
    }
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    // Soft login check — warn but still allow (backward compat)
    if (!_currentUser) {
      showToast("Tip: Log in before reporting so you can manage claims!", "success");
    }
    const btn     = document.getElementById("submit-btn");
    const btnText = btn.querySelector(".btn-text");
    const spinner = btn.querySelector(".spinner");
    btn.disabled = true; btn.classList.add("loading");
    btnText.textContent = "Submitting…";
    const formData = new FormData(form);
    try {
      const res  = await fetch("/api/reports", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      btn.classList.remove("loading"); btn.classList.add("btn-success");
      btnText.textContent = "✅ Submitted!"; spinner.style.display = "none";
      showToast("Report submitted successfully!", "success");
      setTimeout(() => window.location.href = "reports.html", 1800);
    } catch (err) {
      btn.disabled = false; btn.classList.remove("loading");
      btnText.textContent = "Submit Report"; showToast(err.message, "error");
    }
  });
}

/* ── BROWSE REPORTS PAGE ──────────────────────────────────────────────── */

let allReportsCache = [];

async function initBrowsePage() {
  const grid = document.getElementById("reports-grid");
  if (!grid) return;
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
    allReportsCache = reports; renderReports(reports);
  } catch {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__icon">⚠️</div><h3>Could not load reports</h3><p>Make sure the Flask server is running.</p></div>`;
  }
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const filterGroup = chip.dataset.group;
      if (filterGroup === "type") document.querySelectorAll("[data-group='type']").forEach(c => c.classList.remove("active"));
      if (filterGroup === "category") document.querySelectorAll("[data-group='category']").forEach(c => c.classList.remove("active"));
      chip.classList.toggle("active"); applyFilters();
    });
  });
  const catSelect = document.getElementById("filter-category");
  catSelect && catSelect.addEventListener("change", applyFilters);
}

function applyFilters() {
  const activeType = document.querySelector("[data-group='type'].active");
  const typeVal    = activeType ? activeType.dataset.value : null;
  const catSelect  = document.getElementById("filter-category");
  const catVal     = catSelect && catSelect.value ? catSelect.value : null;
  renderReports(allReportsCache.filter(r => {
    if (typeVal && r.type !== typeVal) return false;
    if (catVal  && r.category !== catVal) return false;
    return true;
  }));
}

function renderReports(reports) {
  const grid = document.getElementById("reports-grid");
  if (!reports.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__icon">🔍</div><h3>No reports found</h3><p>Try adjusting your filters, or be the first to submit a report!</p></div>`;
    return;
  }
  grid.innerHTML = reports.map((r, i) => reportCardHTML(r, i)).join("");
}

/* ── MATCH PAGE ───────────────────────────────────────────────────────── */

async function initMatchPage() {
  const matchGrid = document.getElementById("matches-grid");
  if (!matchGrid) return;
  try {
    const matches = await fetch("/api/matches").then(r => r.json());
    renderMatchCards(matches);
  } catch {
    matchGrid.innerHTML = `<div class="empty-state"><div class="empty-state__icon">⚠️</div><h3>Could not load matches</h3><p>Make sure the Flask server is running.</p></div>`;
  }
  const refreshBtn = document.getElementById("refresh-matches-btn");
  refreshBtn && refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true; refreshBtn.textContent = "🔄 Scanning…";
    try {
      const data = await fetch("/api/matches/refresh", { method: "POST" }).then(r => r.json());
      renderMatchCards(data.matches);
      showToast(`Found ${data.count} possible match(es)`, "success");
    } catch { showToast("Refresh failed", "error"); }
    finally { refreshBtn.disabled = false; refreshBtn.textContent = "🔄 Refresh Matches"; }
  });
}

function renderMatchCards(matches) {
  const grid = document.getElementById("matches-grid");
  const pending = matches.filter(m => m.status === "pending");
  if (!pending.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state__icon">🤝</div><h3>No pending matches</h3><p>Submit more reports or click <strong>Refresh Matches</strong> to scan again.</p></div>`;
    return;
  }
  grid.innerHTML = pending.map((m, i) => {
    const sc = scoreClass(m.score);
    return `
      <div class="match-card card-anim" style="animation-delay:${i * 80}ms">
        <div style="display:flex;gap:1rem;align-items:center;margin-bottom:1rem">
          <div class="match-score-ring ${sc}">${m.score}<span style="font-size:.6rem">/100</span></div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:.85rem;color:var(--clr-muted);margin-bottom:.25rem">MATCH SCORE</div>
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
          <a href="match_detail.html?id=${m.id}" class="btn btn-secondary" style="font-size:.85rem;padding:.55rem 1.1rem">View Details →</a>
        </div>
      </div>`;
  }).join("");
}

/* ── MATCH DETAIL PAGE ────────────────────────────────────────────────── */

async function initMatchDetailPage() {
  const container = document.getElementById("match-detail-container");
  if (!container) return;
  const params  = new URLSearchParams(window.location.search);
  const matchId = params.get("id");
  if (!matchId) { container.innerHTML = "<p>Invalid match ID.</p>"; return; }
  try {
    const m  = await fetch(`/api/matches/${matchId}`).then(r => r.json());
    if (m.error) throw new Error(m.error);
    const sc      = scoreClass(m.score);
    const reasons = m.reasons.split("|");

    // Determine if logged-in user can claim (they must not be the finder)
    const canClaim = _currentUser && m.found_reporter_id && _currentUser.id !== m.found_reporter_id;
    const claimBtn = m.status === "pending" && canClaim
      ? `<button class="btn btn-primary" id="claim-btn" style="background:linear-gradient(135deg,#7c3aed,#4f46e5)">🤝 Claim This Item</button>`
      : (m.status === "pending" && !_currentUser
          ? `<a href="login.html?next=match_detail.html%3Fid=${matchId}" class="btn btn-primary" style="background:linear-gradient(135deg,#7c3aed,#4f46e5)">🔐 Login to Claim</a>`
          : "");

    container.innerHTML = `
      <div class="score-meter">
        <div class="score-meter__label">Match Confidence Score</div>
        <div class="score-meter__number" id="score-num">0</div>
        <div class="score-bar-track"><div class="score-bar-fill ${sc}" id="score-bar"></div></div>
        <div class="reasons-list" style="margin-top:1rem">
          ${reasons.map(r => `<span class="reason-pill">${escapeHtml(r)}</span>`).join("")}
        </div>
        <div style="margin-top:.75rem"><span class="status-badge ${m.status}">${m.status.toUpperCase()}</span></div>
      </div>
      <div class="comparison-grid">
        ${comparisonBoxHTML(m, "lost")}
        <div class="comparison-vs">VS</div>
        ${comparisonBoxHTML(m, "found")}
      </div>
      ${m.status === "pending" ? `
      <div class="action-row" id="action-row">
        <button class="btn btn-success" id="verify-btn">✅ Verify — It's a Match!</button>
        <button class="btn btn-danger"  id="reject-btn">❌ Reject — Not a Match</button>
        ${claimBtn}
        <a href="match.html" class="btn btn-secondary" style="background:transparent;color:var(--clr-muted);border-color:var(--clr-border)">← Back</a>
      </div>` : `
      <div class="action-row">
        ${claimBtn}
        <a href="match.html" class="btn btn-secondary">← Back to Matches</a>
      </div>`}`;

    animateScore(m.score, sc);
    wireDetailActions(matchId);
    wireClaim(m);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Match not found</h3><p>${err.message}</p></div>`;
  }
}

function comparisonBoxHTML(m, side) {
  const label   = side === "lost" ? "🔍 Lost Item" : "✅ Found Item";
  const imgFile = m[`${side}_img`];
  return `
    <div class="comparison-box">
      <div class="comparison-box__header ${side}">
        <span class="card__tag ${side}">${label}</span>
        <div style="font-size:1.1rem;font-weight:700;margin-top:.4rem">${escapeHtml(m[side + "_item"])}</div>
      </div>
      ${imgFile
        ? `<img class="comparison-box__img" src="/uploads/${imgFile}" alt="${m[side + "_item"]}">`
        : `<div class="comparison-box__img" style="display:flex;align-items:center;justify-content:center;background:var(--clr-bg);height:180px;color:var(--clr-muted);font-size:.9rem">No photo</div>`}
      <div class="comparison-box__body">
        <div class="comparison-box__field"><div class="field-label">Category</div><div class="field-value">${escapeHtml(m[side + "_category"])}</div></div>
        <div class="comparison-box__field"><div class="field-label">Location</div><div class="field-value">📍 ${escapeHtml(m[side + "_loc"])}</div></div>
        <div class="comparison-box__field"><div class="field-label">Date / Time</div><div class="field-value">🕐 ${formatDateTime(m[side + "_dt"])}</div></div>
        <div class="comparison-box__field"><div class="field-label">Description</div><div class="field-value">${escapeHtml(m[side + "_desc"] || "—")}</div></div>
      </div>
    </div>`;
}

function animateScore(targetScore, cls) {
  const numEl = document.getElementById("score-num");
  const barEl = document.getElementById("score-bar");
  if (!numEl || !barEl) return;
  let current = 0;
  const step  = targetScore / 60;
  const timer = setInterval(() => {
    current = Math.min(current + step, targetScore);
    numEl.textContent = Math.round(current);
    if (current >= targetScore) clearInterval(timer);
  }, 16);
  setTimeout(() => { barEl.style.width = targetScore + "%"; }, 100);
}

function wireDetailActions(matchId) {
  const verifyBtn = document.getElementById("verify-btn");
  const rejectBtn = document.getElementById("reject-btn");
  verifyBtn && verifyBtn.addEventListener("click", async () => {
    verifyBtn.disabled = true; rejectBtn && (rejectBtn.disabled = true);
    try {
      await fetch(`/api/matches/${matchId}/verify`, { method: "POST" });
      showToast("Match verified! Both reports are now closed. 🎉", "success");
      document.getElementById("action-row").innerHTML = `
        <div style="font-weight:600;color:var(--clr-found)">✅ Match verified!</div>
        <a href="match.html" class="btn btn-secondary">← Back to Matches</a>`;
    } catch { showToast("Could not verify. Try again.", "error"); verifyBtn.disabled = false; rejectBtn && (rejectBtn.disabled = false); }
  });
  rejectBtn && rejectBtn.addEventListener("click", async () => {
    verifyBtn && (verifyBtn.disabled = true); rejectBtn.disabled = true;
    try {
      await fetch(`/api/matches/${matchId}/reject`, { method: "POST" });
      showToast("Match rejected.", "success");
      document.getElementById("action-row").innerHTML = `
        <div style="font-weight:600;color:var(--clr-lost)">❌ Match rejected.</div>
        <a href="match.html" class="btn btn-secondary">← Back to Matches</a>`;
    } catch { showToast("Could not reject. Try again.", "error"); verifyBtn && (verifyBtn.disabled = false); rejectBtn.disabled = false; }
  });
}

function wireClaim(m) {
  const claimBtn = document.getElementById("claim-btn");
  if (!claimBtn) return;
  claimBtn.addEventListener("click", async () => {
    claimBtn.disabled = true; claimBtn.textContent = "⏳ Requesting…";
    try {
      const res  = await fetch("/api/claims", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: m.found_id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Claim failed");
      // Show the code ONCE to the person who claimed (they are finder if finder_code returned)
      // Actually per our design: finder_code is for the FINDER to share out-of-band.
      // We show it in a prominent box.
      claimBtn.replaceWith((() => {
        const box = document.createElement("div");
        box.className = "claim-code-box";
        box.innerHTML = `
          <div class="claim-code-box__title">🎉 Claim Submitted!</div>
          <p style="margin:.4rem 0 .8rem;font-size:.9rem;color:var(--clr-muted)">
            Share this code with the finder during handover. The finder will enter it to verify the transfer.
          </p>
          <div class="claim-code-reveal">${escapeHtml(data.finder_code)}</div>
          <p style="font-size:.78rem;color:var(--clr-muted);margin-top:.5rem">
            ⚠️ This code is shown only once. Copy it now.
          </p>
          <a href="claims.html" class="btn btn-secondary" style="margin-top:.75rem;font-size:.85rem">View My Claims →</a>`;
        return box;
      })());
      showToast("Claim created! Save the code shown on screen.", "success");
    } catch (err) {
      claimBtn.disabled = false; claimBtn.textContent = "🤝 Claim This Item";
      showToast(err.message, "error");
    }
  });
}

/* ── CLAIMS PAGE ──────────────────────────────────────────────────────── */

async function initClaimsPage() {
  const content  = document.getElementById("claims-content");
  const loginWall = document.getElementById("claims-login-wall");
  if (!content) return;

  // Wait for auth state to settle
  await new Promise(r => setTimeout(r, 300));

  if (!_currentUser) {
    loginWall && (loginWall.style.display = "block");
    return;
  }
  content.style.display = "block";

  try {
    const res  = await fetch("/api/claims/mine");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load claims");

    const uid       = data.user_id;
    const asClaimer = data.claims.filter(c => c.claimant_id === uid);
    const asFinder  = data.claims.filter(c => c.finder_id  === uid);

    renderClaimantList(asClaimer);
    renderFinderList(asFinder, uid);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-state__icon">⚠️</div><h3>Could not load claims</h3><p>${err.message}</p></div>`;
  }
}

function claimStatusBadge(status) {
  const map = { pending: "🟡 Pending", verified: "✅ Verified", returned: "📦 Returned" };
  return `<span class="claim-status-badge claim-status--${status}">${map[status] || status}</span>`;
}

function renderClaimantList(claims) {
  const el = document.getElementById("claimant-list");
  if (!el) return;
  if (!claims.length) {
    el.innerHTML = `<div class="empty-state" style="padding:2rem"><div class="empty-state__icon">📭</div><h3>No claims yet</h3><p>Browse found items and claim ones that belong to you.</p><a href="reports.html" class="btn btn-primary" style="margin-top:1rem">Browse Found Items</a></div>`;
    return;
  }
  el.innerHTML = claims.map(c => `
    <div class="claim-card card-anim">
      <div class="claim-card__header">
        <div>
          <div class="claim-card__item">${escapeHtml(c.item_name)}</div>
          <div class="claim-card__meta">📁 ${escapeHtml(c.category)} &nbsp;·&nbsp; Finder: ${escapeHtml(c.finder_name)}</div>
        </div>
        ${claimStatusBadge(c.status)}
      </div>
      <div class="claim-card__sub">
        Claim #${c.id} &nbsp;·&nbsp; Created ${formatDateTime(c.created_at)}
        ${c.verified_at ? ` &nbsp;·&nbsp; Verified ${formatDateTime(c.verified_at)}` : ""}
      </div>
      <!-- Contact Finder button — reveals finder contact info privately -->
      <div class="claim-contact-row" id="contact-claimant-${c.id}">
        <button class="btn btn-contact" onclick="showContact(${c.id}, 'contact-claimant-${c.id}')">
          📞 Contact Finder
        </button>
      </div>
      ${c.status === "pending"
        ? `<p style="font-size:.85rem;color:var(--clr-muted);margin-top:.5rem">
             Waiting for the finder to verify your code. During handover, tell the finder your claim code.
           </p>`
        : c.status === "verified"
          ? `<p style="font-size:.85rem;color:var(--clr-found);margin-top:.5rem">Claim verified &mdash; item returned!</p>`
          : ""}
    </div>`).join("");
}

function renderFinderList(claims, uid) {
  const el = document.getElementById("finder-list");
  if (!el) return;
  if (!claims.length) {
    el.innerHTML = `<div class="empty-state" style="padding:2rem"><div class="empty-state__icon">🔍</div><h3>No incoming claims</h3><p>When someone claims an item you reported as found, it will appear here.</p></div>`;
    return;
  }
  el.innerHTML = claims.map(c => `
    <div class="claim-card card-anim" id="finder-claim-${c.id}">
      <div class="claim-card__header">
        <div>
          <div class="claim-card__item">${escapeHtml(c.item_name)}</div>
          <div class="claim-card__meta">📁 ${escapeHtml(c.category)} &nbsp;·&nbsp; Claimant: ${escapeHtml(c.claimant_name)}</div>
        </div>
        ${claimStatusBadge(c.status)}
      </div>
      <div class="claim-card__sub">Claim #${c.id} &nbsp;·&nbsp; Created ${formatDateTime(c.created_at)}</div>
      <!-- Contact Claimant button — reveals claimant contact info privately -->
      <div class="claim-contact-row" id="contact-finder-${c.id}">
        <button class="btn btn-contact" onclick="showContact(${c.id}, 'contact-finder-${c.id}')">
          📞 Contact Claimant
        </button>
      </div>
      ${c.status === "pending" ? `
      <div class="verify-form" style="margin-top:1rem">
        <p style="font-size:.88rem;color:var(--clr-muted);margin-bottom:.6rem">
          Ask the claimant for their code and enter it below to confirm the handover.
        </p>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap">
          <input type="text" class="verify-code-input" id="code-input-${c.id}"
                 placeholder="Enter claim code (e.g. A3F9B12C)"
                 style="flex:1;min-width:180px;font-family:monospace;font-size:1rem;letter-spacing:.1em;text-transform:uppercase">
          <button class="btn btn-success" id="verify-claim-btn-${c.id}"
                  onclick="submitVerify(${c.id})">
            Verify Handover
          </button>
        </div>
      </div>` : c.status === "verified"
        ? `<p style="font-size:.85rem;color:var(--clr-found);margin-top:.5rem">Verified on ${formatDateTime(c.verified_at)}. Item marked as returned.</p>`
        : ""}
    </div>`).join("");
}


/* -- CONTACT REVEAL -------------------------------------------------------- */

/**
 * Fetch the other party's contact info for a claim and render it inline.
 * Calls GET /api/claims/<id>/contact (login-required, participant-only).
 * The raw claim code and claim_code_hash are NEVER in this response.
 */
async function showContact(claimId, rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const btn = row.querySelector("button");
  if (btn) { btn.disabled = true; btn.textContent = "Loading..."; }
  try {
    const res  = await fetch(`/api/claims/${claimId}/contact`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load contact info");
    const roleLabel = data.role === "claimant" ? "Finder" : "Claimant";
    row.innerHTML = `
      <div class="contact-card">
        <div class="contact-card__header">
          <span class="contact-card__icon">📞</span>
          <span class="contact-card__label">Contact ${escapeHtml(roleLabel)}</span>
          <span class="contact-card__privacy">Private &mdash; visible only to you</span>
        </div>
        <div class="contact-card__name">${escapeHtml(data.their_name)}</div>
        <div class="contact-card__info">${escapeHtml(data.their_contact)}</div>
        <div class="contact-card__item-tag">Re: ${escapeHtml(data.item_name)}</div>
      </div>`;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = "Contact"; }
    showToast(err.message, "error");
  }
}

async function submitVerify(claimId) {
  const input = document.getElementById(`code-input-${claimId}`);
  const btn   = document.getElementById(`verify-claim-btn-${claimId}`);
  const code  = (input.value || "").trim().toUpperCase();
  if (!code) { showToast("Please enter the claim code", "error"); return; }
  btn.disabled = true; btn.textContent = "⏳ Verifying…";
  try {
    const res  = await fetch(`/api/claims/${claimId}/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Verification failed");
    showToast(data.message, "success");
    const card = document.getElementById(`finder-claim-${claimId}`);
    if (card) {
      card.querySelector(".verify-form").innerHTML =
        `<p style="font-size:.9rem;color:var(--clr-found);margin-top:.5rem;font-weight:600">✅ Claim verified! Item has been marked as returned.</p>`;
      card.querySelector(".claim-status-badge").className = "claim-status-badge claim-status--verified";
      card.querySelector(".claim-status-badge").textContent = "✅ Verified";
    }
  } catch (err) {
    btn.disabled = false; btn.textContent = "✅ Verify Handover";
    showToast(err.message, "error");
  }
}

/* ── ROUTER ───────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", async () => {
  await initAuthState();   // Must run first — populates _currentUser

  initHomePage();
  initRegisterPage();
  initLoginPage();
  initReportForm();
  initBrowsePage();
  initMatchPage();
  initMatchDetailPage();
  initClaimsPage();

  // Highlight active nav link
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav__links a").forEach(a => {
    if (a.getAttribute("href") === currentPage ||
        (currentPage === "" && a.getAttribute("href") === "index.html")) {
      a.classList.add("active");
    }
  });
});
