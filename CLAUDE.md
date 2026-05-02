# Just In Case — Architecture & Developer Guide

A private emergency information PWA for two users. Stores critical financial and insurance data in a dark-themed mobile-first interface.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Backend | Cloudflare Workers (ES modules) |
| Database | Cloudflare D1 (SQLite) |
| Email | Resend API (for password reset emails) |
| Hosting | Cloudflare Workers + Assets |

---

## File Structure

```
just-in-case/
├── worker.js          # Cloudflare Worker — all API routes + auth logic
├── wrangler.toml      # Cloudflare deployment config (worker name, D1 binding, vars)
├── CLAUDE.md          # This file
└── public/
    ├── index.html     # Main read-only view of all data (auth-guarded)
    ├── editor.html    # Full CRUD editor (auth-guarded)
    ├── login.html     # Login page (email + password)
    ├── reset.html     # Password reset (request link + set new password)
    ├── sw.js          # Service worker — network-first PWA caching
    └── favicon.svg    # Shield icon
```

---

## Deployment

- **Live URL**: `https://just-in-case.99redder.workers.dev`
- **Deploy command**: `wrangler deploy`
- **D1 database name**: `just-in-case-db`
- **D1 database ID**: `f75d17ed-9561-4a98-ba7c-5f786f178895`
- **Email from address**: `noreply@easternshore.ai` (verified in Resend)
- **RESEND_API_KEY**: stored as a Wrangler secret (`wrangler secret put RESEND_API_KEY`)

---

## Gotchas (don't repeat)

These bit us already; the comments in code say so but it's worth stating up
front:

- **`html_handling = "none"` in `wrangler.toml` is load-bearing.** The default
  (`auto-trailing-slash`) makes Cloudflare's assets binding 307-redirect
  `/login.html` → `/login`. Our worker wraps every asset response, and the
  307 used to trigger an SPA-fallback branch that served `index.html` for
  every `.html` URL. Don't remove `html_handling = "none"` without also
  rethinking the worker's asset wrapper.
- **Root URL needs an explicit rewrite to `/index.html`.** A side effect of
  `html_handling = "none"` is that `env.ASSETS.fetch("/")` returns 404 — the
  binding no longer auto-serves `index.html` at root. The worker rewrites
  `/` → `/index.html` before delegating to the asset binding.
- **Schema changes need `ALTER TABLE`, not just an updated `CREATE TABLE`.**
  `ensureAuthTables` uses `CREATE TABLE IF NOT EXISTS`, which is a no-op on
  pre-existing tables. When `ua_hash` was added to `sessions`, every login
  500'd until an `ALTER TABLE sessions ADD COLUMN ua_hash TEXT` was added
  (D1 doesn't support `IF NOT EXISTS` on `ALTER`, so swallow the duplicate-
  column error on subsequent runs). Same pattern applies to any future
  column adds.

---

## Authentication System

### Overview

- **Only two users are allowed.** The list is configured via the `ALLOWED_EMAILS` Wrangler secret (comma-separated emails). Out-of-scope emails are rejected before reaching the password check.
- No account creation endpoint exists — users are added by updating the secret and redeploying.
- Passwords are stored in D1 hashed with **PBKDF2-SHA256** (100,000 iterations, random 16-byte salt)
- Sessions use 32-byte random tokens stored in D1, expiring after **30 days**
- The session token is stored in `localStorage` under key `jic_session`
- All `/api/data` endpoints require a valid `Authorization: Bearer <token>` header

### Auth Tables (auto-created by `ensureAuthTables` on first auth request)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT       -- NULL until user sets password; format: "salt:hash"
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL  -- Unix timestamp
);

CREATE TABLE password_resets (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL  -- Unix timestamp, 1-hour TTL
);
```

User rows for both emails are auto-inserted with `INSERT OR IGNORE` when `ensureAuthTables` runs. No password is set until the user completes the reset flow.

> **Important**: `ensureAuthTables` uses individual `prepare().run()` calls for each statement — D1's `exec()` is unreliable with multiple semicolon-separated statements.

### Auth API Endpoints

| Method | Path | Auth Required | Description |
|--------|------|--------------|-------------|
| POST | `/api/auth/login` | No | Email + password → session token |
| POST | `/api/auth/logout` | No | Deletes session from DB |
| GET | `/api/auth/me` | Yes | Returns `{ email }` for current session |
| POST | `/api/auth/reset-request` | No | Sends reset link to email via Resend |
| POST | `/api/auth/reset-password` | No | Sets new password using reset token |

### Auth Guard Pattern (index.html, editor.html)

Both protected pages use this pattern at the bottom of their `<script>` block:

```javascript
(async function init() {
  const token = localStorage.getItem('jic_session');
  if (!token) { window.location.replace('login.html'); return; }
  try {
    const r = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) {
      localStorage.removeItem('jic_session');
      window.location.replace('login.html');
      return;
    }
  } catch (e) { /* network error — allow through */ }
  document.body.style.display = '';
  renderApp();
})();
```

The `<body>` tag has `style="display:none"` to prevent a flash of content before auth is checked.

---

## Data Storage

- Single D1 table: `app_data` with columns `id` (INTEGER) and `content` (JSON string)
- `GET /api/data` — returns the stored JSON; falls back to `defaultAppData()` if table is empty
- `POST /api/data` — upserts the full JSON payload (replaces entire content)

### Data Schema

```json
{
  "firststeps": [{ "id", "title", "details", "notes" }],
  "insurance":  [{ "id", "type", "name", "details", "notes" }],
  "money":      [{ "id", "account", "type", "balance", "loginUrl", "username", "instructions" }],
  "checklist":  [{ "id", "text", "completed" }]
}
```

---

## Main View (index.html)

The main view is **read-only** — it fetches data and displays it but has no edit capability. The editor is a separate page (`editor.html`).

### Key Design Patterns

**Module-level `appData` store** — all data is held in a module-level variable so onclick handlers can look up values by ID rather than embedding them inline. Inline onclick attributes break on content with single quotes, newlines, or Unicode.

```javascript
let appData = { firststeps: [], insurance: [], money: [], checklist: [] };
```

**`showDetails(section, id)`** — opens a bottom-sheet modal showing the full details text for a First Steps or Insurance item. URLs in the text are automatically converted to tappable hyperlinks by `linkify()`. The modal also has a Copy button.

**`linkify(text)`** — scans text for `https?://` URLs, HTML-escapes everything else, and wraps each URL in an `<a target="_blank">` tag. Used inside the details modal.

**`toggleChecklistItem(id)`** — flips a checklist item's `completed` boolean and re-renders the app. Note: this only persists in memory for the session; the editor must be used to save changes to D1.

### Sections Rendered

| Section | Interaction |
|---------|------------|
| First Steps | Details button → modal |
| Insurance | Details button → modal |
| Where We Have Money | View button → opens `loginUrl` in new tab |
| Checklist | Checkboxes toggle `completed` state in memory |

---

## Editor (editor.html)

Full CRUD for all sections. Uses a modal pattern:
- `openModal(section, idOrNull)` — appends a modal to `document.body`; `null` id = new item
- `saveItem(section, idArg)` — reads form fields, updates `appData`, POSTs full payload to `/api/data`
- `deleteItem(section, id)` — removes item from `appData`, POSTs to save
- Clicking the modal backdrop closes it without saving

---

## Service Worker (sw.js)

Network-first strategy: always fetches fresh from the server; only falls back to cache if the network is unreachable. Skips all `/api/*` requests entirely.

- `self.skipWaiting()` on install — activates immediately without waiting for old tabs to close
- Clears all old caches on activate, then calls `self.clients.claim()`
- All pages call `navigator.serviceWorker.register('/sw.js').then(reg => reg.update())` — this forces a version check on every page load, ensuring users always get the latest code within seconds of a deploy

To force a full cache bust after a deploy, increment `VERSION` in `sw.js`.

---

## Password Reset Flow

1. User visits `/reset.html` (no token in URL) → enters email → submits
2. Worker creates a reset token (expires in 1 hour), emails a link to `/reset.html?token=<token>`
3. User clicks link → `/reset.html` detects `?token=` → shows "Set New Password" form
4. User submits new password → worker validates token, hashes password, updates `users` table, invalidates all sessions for that email
5. User is shown a success screen with a link back to login

---

## First-Time Setup

After deploying for the first time, neither user has a password. Each user must:

1. Go to `/login.html`
2. Click **"Forgot your password?"**
3. Enter their email address
4. Click the reset link in their email
5. Set a password (min 8 characters)

---

## UI Design System

All pages share the same CSS variables:

```css
--bg: #0f172a;          /* page background */
--surface: #1e293b;     /* card backgrounds */
--surface-2: #334155;   /* borders, secondary surfaces */
--text: #f1f5f9;        /* primary text */
--text-muted: #94a3b8;  /* secondary text, labels */
--primary: #3b82f6;     /* buttons, links, focus rings */
--success: #10b981;
--warning: #f59e0b;
--danger: #ef4444;
--radius: 12px;
--shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
```

---

## Security Notes

- Passwords never leave the server in plaintext; PBKDF2 hashing happens in the worker
- Reset tokens are single-use and expire after 1 hour
- Setting a new password invalidates all active sessions for that user
- The `ALLOWED_EMAILS` list is the only mechanism preventing unauthorized access — there is no account creation endpoint
- CORS headers allow `*` origin (acceptable since the app is private and auth-guarded at the API level)
- `escapeHtml()` is used on all user-supplied content before inserting into innerHTML to prevent XSS
