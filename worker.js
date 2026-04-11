const ALLOWED_EMAILS = ['***@***', '***@***'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Public auth routes
    if (path === '/api/auth/login'          && request.method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/logout'         && request.method === 'POST') return handleLogout(request, env);
    if (path === '/api/auth/me'             && request.method === 'GET')  return handleMe(request, env);
    if (path === '/api/auth/reset-request'  && request.method === 'POST') return handleResetRequest(request, env);
    if (path === '/api/auth/reset-password' && request.method === 'POST') return handleResetPassword(request, env);

    // Protected data routes
    if (path.startsWith('/api/data')) {
      const session = await validateSession(request, env);
      if (!session) return jsonRes({ error: 'Unauthorized' }, 401);
      if (request.method === 'GET')  return handleGetData(request, env);
      if (request.method === 'POST') return handleSaveData(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ── Auth handlers ─────────────────────────────────────────────

async function handleLogin(request, env) {
  try {
    await ensureAuthTables(env);
    const { email, password } = await request.json();
    if (!email || !password) return jsonRes({ error: 'Email and password are required' }, 400);

    const norm = email.toLowerCase().trim();
    if (!ALLOWED_EMAILS.includes(norm)) return jsonRes({ error: 'Invalid email or password' }, 401);

    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(norm).first();
    if (!user || !user.password_hash) {
      return jsonRes({ error: 'No password set for this account. Use "Forgot Password" to set one.' }, 401);
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      return jsonRes({ error: 'Invalid email or password' }, 401);
    }

    const token = await genToken();
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 days
    await env.DB.prepare('INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)')
      .bind(token, norm, exp).run();

    return jsonRes({ token, email: norm });
  } catch (e) {
    console.error('login error:', e);
    return jsonRes({ error: 'Login failed' }, 500);
  }
}

async function handleLogout(request, env) {
  try {
    const token = getToken(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  } catch (e) { /* ignore */ }
  return jsonRes({ success: true });
}

async function handleMe(request, env) {
  try {
    await ensureAuthTables(env);
    const session = await validateSession(request, env);
    if (!session) return jsonRes({ error: 'Unauthorized' }, 401);
    return jsonRes({ email: session.email });
  } catch (e) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }
}

async function handleResetRequest(request, env) {
  try {
    await ensureAuthTables(env);
    const { email } = await request.json();
    if (!email) return jsonRes({ error: 'Email is required' }, 400);

    const norm = email.toLowerCase().trim();
    // Always return the same message to prevent email enumeration
    const ok = { success: true, message: 'If that address is registered, a reset link is on its way.' };
    if (!ALLOWED_EMAILS.includes(norm)) return jsonRes(ok);

    // Replace any existing token for this email
    await env.DB.prepare('DELETE FROM password_resets WHERE email = ?').bind(norm).run();

    const token = await genToken();
    const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    await env.DB.prepare('INSERT INTO password_resets (token, email, expires_at) VALUES (?, ?, ?)')
      .bind(token, norm, exp).run();

    const appUrl = (env.APP_URL || '').replace(/\/$/, '');
    const resetUrl = `${appUrl}/reset.html?token=${token}`;
    await sendResetEmail(norm, resetUrl, env);

    return jsonRes(ok);
  } catch (e) {
    console.error('reset-request error:', e);
    return jsonRes({ error: 'Failed to process request' }, 500);
  }
}

async function handleResetPassword(request, env) {
  try {
    await ensureAuthTables(env);
    const { token, password } = await request.json();
    if (!token || !password) return jsonRes({ error: 'Token and password are required' }, 400);
    if (password.length < 8) return jsonRes({ error: 'Password must be at least 8 characters' }, 400);

    const now = Math.floor(Date.now() / 1000);
    const rec = await env.DB.prepare(
      'SELECT * FROM password_resets WHERE token = ? AND expires_at > ?'
    ).bind(token, now).first();

    if (!rec) return jsonRes({ error: 'This reset link is invalid or has expired' }, 400);

    const salt = await genSalt();
    const hash = await hashPassword(password, salt);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE email = ?')
      .bind(`${salt}:${hash}`, rec.email).run();

    // Invalidate the used token and all active sessions for this user
    await env.DB.prepare('DELETE FROM password_resets WHERE token = ?').bind(token).run();
    await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(rec.email).run();

    return jsonRes({ success: true });
  } catch (e) {
    console.error('reset-password error:', e);
    return jsonRes({ error: 'Failed to reset password' }, 500);
  }
}

// ── Data handlers ─────────────────────────────────────────────

async function handleGetData(request, env) {
  try {
    const data = await env.DB.prepare('SELECT * FROM app_data LIMIT 1').first();
    if (data) {
      return new Response(data.content, {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    return new Response(JSON.stringify(defaultAppData()), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (e) {
    console.error('get data error:', e);
    return jsonRes({ error: 'Failed to fetch data' }, 500);
  }
}

async function handleSaveData(request, env) {
  try {
    const body = await request.json();
    const content = JSON.stringify(body);
    const existing = await env.DB.prepare('SELECT id FROM app_data LIMIT 1').first();
    if (existing) {
      await env.DB.prepare('UPDATE app_data SET content = ? WHERE id = ?')
        .bind(content, existing.id).run();
    } else {
      await env.DB.prepare('INSERT INTO app_data (content) VALUES (?)').bind(content).run();
    }
    return jsonRes({ success: true });
  } catch (e) {
    console.error('save data error:', e);
    return jsonRes({ error: 'Failed to save data' }, 500);
  }
}

// ── Crypto & sessions ─────────────────────────────────────────

function getToken(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function validateSession(request, env) {
  const token = getToken(request);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  return await env.DB.prepare(
    'SELECT * FROM sessions WHERE token = ? AND expires_at > ?'
  ).bind(token, now).first() || null;
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return (await hashPassword(password, salt)) === hash;
}

async function genToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function genSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ── Email ─────────────────────────────────────────────────────

async function sendResetEmail(to, resetUrl, env) {
  if (!env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — cannot send reset email. Set APP_URL and RESEND_API_KEY in wrangler.toml.');
    return false;
  }
  try {
    const from = env.EMAIL_FROM || 'noreply@example.com';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Just In Case <${from}>`,
        to: [to],
        subject: 'Reset your Just In Case password',
        html: `
          <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f172a;color:#f1f5f9;border-radius:12px">
            <h2 style="margin-top:0;color:#f1f5f9">&#x1F6E1;&#xFE0F; Reset your password</h2>
            <p style="color:#94a3b8">Someone requested a password reset for your Just In Case account. Click below to set a new password.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Reset Password</a>
            <p style="color:#64748b;font-size:0.82em;margin-top:24px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            <p style="color:#475569;font-size:0.78em;word-break:break-all">Or copy: ${resetUrl}</p>
          </div>
        `,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Resend API error:', err);
    }
    return res.ok;
  } catch (e) {
    console.error('email send error:', e);
    return false;
  }
}

// ── DB bootstrap ──────────────────────────────────────────────

async function ensureAuthTables(env) {
  // Run each statement individually — D1's exec() is unreliable with multiple statements.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();

  await env.DB.prepare(`INSERT OR IGNORE INTO users (email) VALUES (?)`).bind('***@***').run();
  await env.DB.prepare(`INSERT OR IGNORE INTO users (email) VALUES (?)`).bind('***@***').run();
}

// ── Default app data ──────────────────────────────────────────

function defaultAppData() {
  return {
    firststeps: [
      { id: 1, title: 'Contact Information', details: 'Key people to call:\n- Spouse: 555-123-4567\n- Jane: 555-987-6543\n- Attorney: 555-246-8101', notes: 'Call first if something happens' },
      { id: 2, title: 'Will & Estate', details: 'Location of documents:\n- Will: Filed with attorney John Smith\n- Trust: Stored in safe deposit box #123\n- Power of Attorney: Same location', notes: 'Provide death certificate copies' },
      { id: 3, title: 'Digital Assets', details: 'What to do with online accounts:\n- Social Media: Facebook memorial, Twitter deleted\n- Email: Forward to Jane for 6 months\n- Cloud Storage: Google Drive shared with Jane', notes: 'Delete unused accounts after 1 year' },
      { id: 4, title: 'Debts & Obligations', details: 'What needs to be paid:\n- Mortgage: 6AL Property - $2,500/mo\n- Credit Cards: Close all, pay off balances\n- Car Loans: 2 vehicles - 95EB and 446BB', notes: 'Contact banks immediately' },
    ],
    insurance: [
      { id: 1, type: 'Health', name: 'Primary Plan', details: 'Plan: Blue Cross Blue Shield\nMember ID: BCBS-12345678\nGroup: BCBS-9876\nPhone: 1-800-XXX-XXXX\nPolicy: Self + Spouse', notes: 'Dental and vision included' },
      { id: 2, type: 'Auto', name: 'State Farm', details: 'Agent: John Smith\nPhone: 555-123-4567\nPolicy: AF-7890123\nCoverage: Full', notes: 'Roadside assistance included' },
      { id: 3, type: 'Rental', name: '6AL Property', details: 'Provider: Nationwide\nPolicy: RL-4567890\nDeductible: $1,000', notes: 'Rental insurance for primary rental property' },
      { id: 4, type: 'Life', name: 'Term Life Insurance', details: 'Provider: Prudential\nPolicy: LT-2345678\nBeneficiaries: Spouse 100%\nCoverage: $500,000', notes: 'Policy number: 2345678' },
    ],
    money: [
      { id: 1, account: 'Chase Checking', type: 'Bank', balance: '$12,450.82', loginUrl: 'https://chase.com', username: 'chris.jane', instructions: 'Use phone number verification' },
      { id: 2, account: 'Capital One Savings', type: 'Bank', balance: '$8,235.19', loginUrl: 'https://capitalone.com', username: 'chris.jane', instructions: 'Security token required' },
      { id: 3, account: 'Vanguard IRA', type: 'Investment', balance: '$45,678.42', loginUrl: 'https://vanguard.com', username: '99redder', instructions: 'Use LastPass for credentials' },
      { id: 4, account: 'Robinhood', type: 'Investment', balance: '$2,145.00', loginUrl: 'https://robinhood.com', username: 'chris@99redder.com', instructions: 'Biometric login enabled' },
    ],
    passwords: [
      { id: 1, service: 'Gmail / Google', username: 'chris@99redder.com', password: 'password123', instructions: '2FA via Authy' },
      { id: 2, service: 'iCloud', username: 'chris@icloud.com', password: 'password123', instructions: 'Use this if phone is lost' },
      { id: 3, service: 'GitHub', username: '99redder', password: 'password123', instructions: 'PAT for automation' },
      { id: 4, service: 'LastPass', username: 'chris@99redder.com', password: 'password123', instructions: 'Emergency access to Spouse' },
      { id: 5, service: 'Netflix', username: 'chris@99redder.com', password: 'password123', instructions: 'Shared account' },
      { id: 6, service: 'Disney+', username: 'chris@99redder.com', password: 'password123', instructions: 'Shared account' },
    ],
  };
}
