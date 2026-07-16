# GoldLabel — Pre-Deployment Checklist (Supervisor)

This lists everything that must be done **before deployment**. Engineering work
in the app/backend code is already complete (summary at the bottom); the items
below need account access, secrets, infrastructure, or a sign-off decision — so
they fall to the supervisor.

Priority key: **[BLOCKER]** = ship is unsafe/broken without it · **[REQUIRED]**
= needed for a store release · **[DECISION]** = a judgement call to sign off.

---

## A. Database (Supabase)

1. **[BLOCKER] Run `backend/migrations/001_scan_contributions.sql`**
   in the Supabase SQL Editor. Creates the insert-only anonymized dataset table.
   Without it, every contribution silently fails.

2. **[BLOCKER] Run `backend/migrations/002_lock_down_labels.sql`.**
   The legacy `Labels` table is currently world-readable and holds previously
   stored personal scans. **Export anything needed, then lock it (or drop it).**
   Treat all existing rows as already exposed.

3. **[BLOCKER] Verify RLS actually holds.** With the publishable key, confirm you
   *cannot* read `scan_contributions` and *cannot* read `Labels`. (Insert into
   `scan_contributions` should succeed; reads should return nothing/denied.)

## B. Secrets & API keys

4. **[BLOCKER] Rotate both API keys** — Google Cloud Vision and Gemini. They have
   been present in local working files and shared context, so treat them as
   compromised and reissue.

5. **[BLOCKER] Restrict the Google Vision key** in Google Cloud Console:
   API restriction = Vision API only; add application restrictions. An
   unrestricted key is fully usable by anyone who obtains it.

6. **[BLOCKER] Delete the `EXPO_PUBLIC_` copies of the secret keys** from the EAS
   environments: `EXPO_PUBLIC_GEMINI_API_KEY`, `EXPO_PUBLIC_GOOGLE_CLOUD_VISION_API_KEY`.
   (Already removed from `.env`.) They are backend-only; the `EXPO_PUBLIC_` prefix
   risks baking them into the app.

7. **[DECISION] Confirm secret hygiene.** `.env` was never committed (verified),
   but both GitHub repos are **public**. Decide whether the backend repo should be
   made private.

## C. Backend hosting (Railway)

8. **[BLOCKER] Deploy the backend** (see `backend/DEPLOY.md` for step-by-step):
   set Root Directory to `backend`, add env vars (the two secret keys +
   `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY`), generate the HTTPS
   domain. This also gives you the HTTPS URL needed in section D.

9. **[REQUIRED] Set `ALLOWED_ORIGINS`** on Railway if the web build will be
   exposed in a browser (locks CORS). Not needed for the native app alone.

## D. App build for release (after the Railway URL exists)

10. **[BLOCKER] Set `"usesCleartextTraffic": false`** in `app.json`. It is only on
    now for local HTTP testing; production is HTTPS.

11. **[BLOCKER] Point the app at the production backend.** In the EAS build
    environment set `EXPO_PUBLIC_BACKEND_URL` = the Railway HTTPS URL, plus the two
    `EXPO_PUBLIC_SUPABASE_*` vars.

12. **[BLOCKER] Rebuild** the release APK/AAB with the production config and
    re-test on a device that is **not** on the dev Wi-Fi.

## E. Store release & compliance (if publishing to Play Store / App Store)

13. **[REQUIRED] Privacy policy.** Required for a health app and for camera/photo
    permissions. Must describe: personal scan history stored only on-device
    (encrypted); anonymized, opt-in contributions sent to the server; and the
    consent mechanism.

14. **[REQUIRED] Play Console Data Safety / App Privacy form.** Declare camera,
    photos, and health-related data handling. Reflect the on-device-only personal
    data + anonymized server contribution split.

15. **[DECISION] Review the consent copy & flow.** An opt-in prompt is implemented
    ("save an anonymized copy…"). Confirm the wording satisfies PDPA/GDPR for your
    jurisdiction and users.

16. **[REQUIRED] Confirm release metadata & signing.** App name, icon, version,
    bundle IDs (`com.goldlabel.app`), and the EAS-managed production keystore
    (ensure it is backed up / access is retained).

## F. Sign-offs / accepted risks (supervisor judgement)

17. **[DECISION] No-login design → OCR endpoint is protected only by rate
    limiting.** Real auth isn't possible without accounts. A determined abuser
    could still burn some Vision/Gemini quota. Accept this, or approve adding an
    app-attestation header.

18. **[DECISION] Anonymization is LLM-based.** It performed correctly in testing
    (names, NRIC, dates, phone, address all redacted), but is not a 100% guarantee.
    Plan periodic audits of `scan_contributions` for any leaked PII.

19. **[DECISION] Medical-safety posture.** The app prints medication pictograms.
    There is a human confirmation screen and a `requires_review` flag, but the
    supervisor should sign off on clinical accuracy expectations and add an
    appropriate disclaimer ("verify with your pharmacist").

---

## Already done in code (context — no action needed)

- Personal history moved **on-device, encrypted** (AES via crypto-js; key in
  `expo-secure-store`; secure-random polyfilled with `expo-crypto`).
- New **insert-only** `scan_contributions` flow with **server-side PII scrubbing**
  (Gemini) in the backend `/api/contribute` route.
- **Rate limiting** on both backend endpoints; **CORS** lockable via
  `ALLOWED_ORIGINS`; centralized JSON **error handler** (no stack-trace leaks).
- **Base64 image validation** + unified 5MB limit; model **free-text sanitized**.
- Removed `EXPO_PUBLIC_` secret keys from `.env`; dropped the unneeded
  `READ_EXTERNAL_STORAGE` Android permission.
- **Multer upgraded to 2.x**; backend `npm audit` = 0 vulnerabilities.
- Backend health check (`GET /`), `start` script, Node 20 engine, and Railway
  deploy guide (`backend/DEPLOY.md`).
