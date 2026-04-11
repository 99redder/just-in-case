# Just In Case — Architecture & Developer Guide

A private emergency information PWA for two users (the family). Stores critical financial, insurance, and password data in a dark-themed mobile-first interface.

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
    └── favicon.svg    # Shield icon
```

---

## Authentication System

### Overview

- **Only two users are allowed**: `***@***` and `***@***`
- These are hardcoded in `ALLOWED_EMAILS` at the top of `worker.js` — no account creation is possible
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

- Single D1 table: `app_data` with columns `id` and `content` (JSON string)
- GET `/api/data` — returns the stored JSON; falls back to `defaultAppData()` if table is empty
- POST `/api/data` — upserts the full JSON payload

### Data Schema

```json
{
  "firststeps": [{ "id", "title", "details", "notes" }],
  "insurance":  [{ "id", "type", "name", "details", "notes" }],
  "money":      [{ "id", "account", "type", "balance", "loginUrl", "username", "instructions" }],
  "passwords":  [{ "id", "service", "username", "password", "instructions" }]
}
```

---

## Environment Variables (wrangler.toml)

```toml
[vars]
APP_URL = "https://your-deployed-domain.workers.dev"
EMAIL_FROM = "noreply@yourdomain.com"

# Add as a secret (wrangler secret put RESEND_API_KEY):
# RESEND_API_KEY = "re_..."
```

- `APP_URL` — used to build the reset link URL in reset emails
- `EMAIL_FROM` — the "from" address in reset emails (must be verified in Resend)
- `RESEND_API_KEY` — Resend API key for sending reset emails; if not set, reset emails are silently skipped (worker still returns success)

---

## First-Time Setup

After deploying for the first time, neither user has a password. Each user must:

1. Go to `/login.html`
2. Click **"Forgot your password?"**
3. Enter their email address
4. Click the reset link in their email
5. Set a password (min 8 characters)

This only works once per user — subsequent resets follow the same flow.

---

## Password Reset Flow

1. User visits `/reset.html` (no token in URL) → enters email → submits
2. Worker creates a reset token (expires in 1 hour), emails a link to `/reset.html?token=<token>`
3. User clicks link → `/reset.html` detects `?token=` → shows "Set New Password" form
4. User submits new password → worker validates token, hashes password, updates `users` table, invalidates all sessions for that email
5. User is shown a success screen with a link back to login

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
