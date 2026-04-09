/* ============================================================
   QUIZORA — app.js
   Shared utilities, API wrappers, and session management
   ============================================================ */

'use strict';

// ── Storage Keys ─────────────────────────────────────────────
const KEYS = {
  QUIZZES:     'qfy_quizzes',
  ATTEMPTS:    'qfy_attempts',
  LEADERBOARD: 'qfy_leaderboard',
  USER:        'qfy_user',
  API_KEY:     'qfy_api_key',
  SEEDED:      'qfy_seeded_v5'
};

const API_BASE = 'http://localhost:3000/api';

// ── ID Generator ─────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Storage Wrappers ──────────────────────────────────────────
const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
  },
  remove(key) { localStorage.removeItem(key); }
};

// ── User / Session ─────────────────────────────────────────────
const User = {
  get() {
    return store.get(KEYS.USER) || { name: 'You', xp: 0, quizzesTaken: 0, avatar: '🧠', isLoggedIn: false };
  },
  set(data) { 
    store.set(KEYS.USER, data);
    // Sync to backend if logged in
    if (data.isLoggedIn && data.id) {
      this.sync(data);
    }
  },
  async sync(data) {
    try {
      await fetch(`${API_BASE}/users/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (e) {
      console.warn("User sync failed", e);
    }
  },
  addXP(xp) {
    const user = this.get();
    user.xp = (user.xp || 0) + xp;
    user.quizzesTaken = (user.quizzesTaken || 0) + 1;
    this.set(user);
    Leaderboard.updateUser(user);
    return user;
  }
};

// ── Quiz CRUD ─────────────────────────────────────────────────
const Quizzes = {
  all()        { return store.get(KEYS.QUIZZES) || []; },
  get(id)      { return this.all().find(q => q.id === id) || null; },
  async save(quiz) {
    const user = User.get();
    if (user.isLoggedIn) {
      quiz.authorId = user.id;
      quiz.authorName = user.name;
    } else {
      quiz.authorId = 'guest';
      quiz.authorName = 'Guest';
    }

    const all = this.all();
    const idx = all.findIndex(q => q.id === quiz.id);
    const method = idx >= 0 ? 'PUT' : 'POST';
    const url = idx >= 0 ? `${API_BASE}/quizzes/${quiz.id}` : `${API_BASE}/quizzes`;
    
    if (idx >= 0) all[idx] = quiz; else all.unshift(quiz);
    store.set(KEYS.QUIZZES, all);
    
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quiz)
      });
      return await res.json();
    } catch (e) {
      console.warn("Quiz sync failed", e);
      return quiz;
    }
  },
  async delete(id) {
    const user = User.get();
    const quiz = this.get(id);
    
    // Check if user is the owner
    if (!quiz || quiz.authorId !== user.id) {
      toast('You can only delete your own quizzes', 'error');
      return;
    }
    
    store.set(KEYS.QUIZZES, this.all().filter(q => q.id !== id));
    try {
      await fetch(`${API_BASE}/quizzes/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.warn(e);
    }
  },
  create(data) {
    const quiz = {
      id: genId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      playCount: 0,
      visibility: 'public',
      context: data.context || '', 
      ...data
    };
    return this.save(quiz);
  },
  async update(id, data) {
    const user = User.get();
    const quiz = this.get(id);
    
    // Check if user is the owner
    if (!quiz || quiz.authorId !== user.id) {
      toast('You can only edit your own quizzes', 'error');
      return;
    }
    
    if (quiz) {
      Object.assign(quiz, data);
      return this.save(quiz);
    }
  }
};

// ── Attempt CRUD ──────────────────────────────────────────────
const Attempts = {
  all()        { return store.get(KEYS.ATTEMPTS) || []; },
  forQuiz(qid) { return this.all().filter(a => a.quizId === qid); },
  async save(attempt) {
    const all = this.all();
    all.unshift(attempt);
    store.set(KEYS.ATTEMPTS, all.slice(0, 500));
    
    try {
      await fetch(`${API_BASE}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt)
      });
    } catch (e) { console.warn(e); }
    
    return attempt;
  },
  create(data) {
    const attempt = {
      id: genId(),
      timestamp: Date.now(),
      ...data
    };
    return this.save(attempt);
  }
};

function trackDemoAttempt() {
  const user = User.get();
  if (!user.isLoggedIn) {
    user.demoQuizzesTaken = (user.demoQuizzesTaken || 0) + 1;
    store.set(KEYS.USER, user);
  }
}

// ── Leaderboard ───────────────────────────────────────────────
const Leaderboard = {
  all() { return (store.get(KEYS.LEADERBOARD) || []).sort((a,b) => b.xp - a.xp); },
  updateUser(user) {
    const all = store.get(KEYS.LEADERBOARD) || [];
    const idx = all.findIndex(e => e.name === user.name);
    const entry = { name: user.name, xp: user.xp, avatar: user.avatar };
    if (idx >= 0) all[idx] = entry; else all.push(entry);
    store.set(KEYS.LEADERBOARD, all);
  }
};

// ── XP & Toast & Helpers ──────────────────────────────────────
function calcXP({ correct, total, timeTaken, timeLimitSec, streak }) {
  const base       = correct * 10;
  const accuracy   = correct / total;
  const speedRatio = Math.max(0, 1 - timeTaken / (timeLimitSec || 30));
  const speedBonus = Math.round(speedRatio * 5 * correct);
  const streakBonus = Math.min(streak * 2, 20);
  return Math.round(base * accuracy + speedBonus + streakBonus);
}

function initToasts() {
  if (!document.getElementById('toast-container')) {
    const el = document.createElement('div');
    el.id = 'toast-container';
    document.body.appendChild(el);
  }
}

function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', info: 'ℹ', warn: '⚠' };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeAllModals() { document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); }

function difficultyBadge(d) {
  const map = { easy: '<span class="badge badge-green">Easy</span>', medium: '<span class="badge badge-amber">Medium</span>', hard: '<span class="badge badge-pink">Hard</span>' };
  return map[d] || map.easy;
}

function difficultyPips(d) {
  const n = { easy: 1, medium: 2, hard: 3 }[d] || 1;
  return `<div class="difficulty-pips">${[1,2,3].map(i => `<div class="pip ${i <= n ? `active-${d}` : ''}"></div>`).join('')}</div>`;
}

const CATEGORY_COLORS = { 'Science':'cyan', 'History':'amber', 'Math':'violet', 'Tech':'pink', 'Pop Culture':'green', 'Geography':'cyan', 'Language':'amber', 'General':'violet' };
function categoryBadge(cat) { return `<span class="badge badge-${CATEGORY_COLORS[cat] || 'muted'}">${cat}</span>`; }
function fmtTime(secs) { return secs >= 60 ? `${Math.floor(secs/60)}m ${secs%60}s` : `${secs}s`; }
function timeSince(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff/60000), hrs = Math.floor(diff/3600000), days = Math.floor(diff/86400000);
  if (days > 0) return `${days}d ago`;
  if (hrs > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'Just now';
}

// ── Navigation & Auth UI ──────────────────────────────────────

function handleLogout() {
  const user = User.get();
  user.isLoggedIn = false;
  store.set(KEYS.USER, user);
  toast('Logged out successfully', 'info');
  setTimeout(() => { window.location.href = 'index.html'; }, 1000);
}

function toggleProfileDropdown() {
  const menu = document.getElementById('profile-dropdown');
  if (menu) menu.classList.toggle('active');
}

window.toggleMobileMenu = function() {
  const navLinks = document.getElementById('nav-links-menu');
  if (navLinks) navLinks.classList.toggle('active');
}

// Global click listener to close dropdowns
document.addEventListener('click', (e) => {
  const profileAction = e.target.closest('.profile-trigger');
  const dropdown = document.getElementById('profile-dropdown');
  if (!profileAction && dropdown) dropdown.classList.remove('active');

  const mobileMenuToggle = e.target.closest('.mobile-menu-trigger');
  const navLinksMenu = document.getElementById('nav-links-menu');
  if (!mobileMenuToggle && navLinksMenu) navLinksMenu.classList.remove('active');
});

function renderNav() {
  const navEl = document.getElementById('app-nav');
  if (!navEl) return;
  const user = User.get();
  const isLoggedIn = user?.isLoggedIn;
  
  const logoHTML = `
    <a href="index.html" class="nav-logo">
      <img src="favicon.png" alt="Logo" class="nav-icon-main">
      QUIZORA
    </a>`;

  if (isLoggedIn || user.isGuest) {
    const displayName = user.name || 'Explorer';
    const firstChar = (displayName || 'E')[0].toUpperCase();

    navEl.innerHTML = `
      ${logoHTML}
      <div class="nav-actions">
        <div class="nav-links-container" id="nav-links-menu">
          <a href="creator.html" class="btn btn-primary nav-link-btn">Create</a>
          <a href="dashboard.html" class="btn btn-ghost nav-link-btn">Library</a>
        </div>
        <button class="mobile-menu-trigger" onclick="toggleMobileMenu()" aria-label="Toggle navigation">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        <div class="user-profile-wrap">
          <button class="profile-trigger" onclick="toggleProfileDropdown()">
            ${user.avatarUrl ? `<img src="${user.avatarUrl}" class="profile-img">` : `<div class="profile-initial">${firstChar}</div>`}
          </button>
          <div class="profile-dropdown" id="profile-dropdown">
            <div class="dropdown-header">
              <div class="dropdown-user-info">
                <strong>${displayName}</strong>
                <span>${user.email || 'Guest Session'}</span>
              </div>
            </div>
            <div class="dropdown-stats">
              <div class="drop-stat">
                <span class="lb-xp">${user.xp}</span>
                <label>Total XP</label>
              </div>
              <div class="drop-stat">
                <span style="color:var(--neon-cyan)">${user.quizzesTaken || 0}</span>
                <label>Quizzes</label>
              </div>
            </div>
            <div class="divider"></div>
            <a href="dashboard.html?tab=my" class="dropdown-item">📁 My Quizzes</a>
            <a href="dashboard.html" class="dropdown-item">🌍 Public Library</a>
            <div class="divider"></div>
            <button class="dropdown-item logout" onclick="handleLogout()">🚪 Log Out</button>
          </div>
        </div>
      </div>
    `;
  } else {
    navEl.innerHTML = `
      ${logoHTML}
      <div class="nav-actions">
        <a href="dashboard.html" class="btn btn-ghost btn-sm">Library</a>
        <a href="login.html" class="btn btn-ghost btn-sm">Log In</a>
        <a href="signup.html" class="btn btn-primary btn-sm">Sign Up</a>
      </div>
    `;
  }
}

// ── Init & Sync ───────────────────────────────────────────────

async function syncFromServer() {
  try {
    const [resQ, resA] = await Promise.all([
      fetch(`${API_BASE}/quizzes`),
      fetch(`${API_BASE}/attempts`)
    ]);
    if (resQ.ok) {
      const data = await resQ.json();
      store.set(KEYS.QUIZZES, data);
    }
    if (resA.ok) {
      const data = await resA.json();
      store.set(KEYS.ATTEMPTS, data);
    }
  } catch (e) {
    console.warn("Using offline data.");
  }
}

document.addEventListener('DOMContentLoaded', () => {
  syncFromServer().then(() => {
    if (typeof window.filterQuizzes === 'function') window.filterQuizzes();
  });
  initToasts();
  renderNav();
});

// ── Expose globals ─────────────────────────────────────────────
window.Quizzes = Quizzes; window.Attempts = Attempts; window.User = User;
window.Leaderboard = Leaderboard; window.store = store;
window.genId = genId; window.calcXP = calcXP; window.toast = toast;
window.openModal = openModal; window.closeModal = closeModal;
window.difficultyBadge = difficultyBadge; window.difficultyPips = difficultyPips;
window.categoryBadge = categoryBadge; window.fmtTime = fmtTime;
window.timeSince = timeSince; window.handleLogout = handleLogout;
window.toggleProfileDropdown = toggleProfileDropdown;
window.trackDemoAttempt = trackDemoAttempt;
