# Security Recommendations & Feature Ideas

This document captures practical next steps for hardening the app and expanding product value.

## Security Recommendations

1. **Move session token from `localStorage` to HttpOnly secure cookies**
   - Why: reduces blast radius of XSS token theft.
   - How: set `Set-Cookie: jic_session=...; HttpOnly; Secure; SameSite=Strict; Path=/` and read from cookie server-side.

2. **Enable strict security headers on all HTML responses**
   - Add a Content Security Policy (CSP) that disallows inline script except nonce/hash.
   - Add `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Permissions-Policy`.

3. **Encrypt data at rest immediately and migrate legacy plaintext rows**
   - `DATA_ENCRYPTION_KEY` support already exists; complete rollout and verify all rows are ciphertext.
   - Add an admin-only endpoint/cron migration that rewrites old rows after successful decrypt.

4. **Upgrade password hashing from PBKDF2 to Argon2id**
   - Use memory-hard KDF to better resist GPU cracking.
   - Keep backward compatibility by version-tagging hashes and upgrading on next successful login.

5. **Add optional MFA (TOTP) for both users**
   - Given high-sensitivity emergency financial data, second factor materially improves security.
   - Store TOTP secret encrypted with key wrapping.

6. **Tighten CORS**
   - Replace wildcard CORS with explicit origin allowlist (production domain + optional localhost for dev).

7. **Add anomaly alerts**
   - Trigger email alert on repeated failed logins, unusual user-agent changes, or reset bursts.

8. **Session management improvements**
   - Show active sessions and allow remote revoke.
   - Rotate session IDs on login/reset and shorten idle timeout.

9. **Add immutable audit log for sensitive actions**
   - Log login success/fail, password resets, data exports, and delete operations with actor + timestamp.

10. **Backup and recovery verification**
   - Schedule encrypted D1 backups and run restore drills quarterly.

## New Feature Ideas

1. **Trusted Contacts Packet**
   - One-click generation of a sanitized emergency packet for a designated person.

2. **Read-only Emergency Share Link**
   - Time-limited, one-time link with scoped fields (e.g., only first steps + insurance).

3. **Dead-man Switch**
   - Optional check-in cadence. Missing check-ins can unlock a predefined emergency workflow.

4. **Document Vault**
   - Upload and encrypt PDFs/images (policies, IDs, wills) with tags and quick search.

5. **Recurring Task Scheduler**
   - Annual/quarterly reminders for policy renewals, beneficiaries, and password updates.

6. **Version History / Undo**
   - Keep encrypted snapshots and allow rollback to prior state.

7. **Data Completeness Score**
   - Health meter that flags missing critical fields (beneficiary, policy number, account contact).

8. **Guided Incident Playbooks**
   - Step-by-step flows for common scenarios (hospitalization, death, identity theft).

9. **CSV/PDF Export & Secure Import**
   - Portable backups and migration path, encrypted with user-provided passphrase.

10. **Ask-K Safety Layer**
   - Add policy guardrails: citation mode, confidence labels, and restricted answers for unknowns.

## Suggested Delivery Order

1. Cookie sessions + security headers + CORS tightening.
2. Encryption migration verification + backup drills.
3. MFA + session management UI.
4. Document vault + emergency share link.
5. Playbooks + completeness scoring.
