# GoldLabel Backend — Railway Deployment Guide

This guide deploys the **GoldLabel backend** (an Express/Node service) to
[Railway](https://railway.com). The mobile app talks to this backend for two
things: (1) OCR + pictogram extraction from a medication-label photo, and
(2) receiving anonymized, opt-in "contributions" that are scrubbed of personal
info and stored in the shared training dataset.

The backend holds the **secret** API keys (Google Cloud Vision, Gemini). Those
keys must live only on the server as environment variables — never in the app
and never committed to the repo.

---

## Architecture at a glance

```
 Mobile app (APK)                    Railway (this backend)          Google APIs
 ────────────────                    ──────────────────────         ───────────
 - Supabase publishable key   ──►    POST /api/ocr/extract    ──►   Vision + Gemini
   (safe to ship, RLS-guarded)       POST /api/contribute
 - Backend HTTPS URL                 (holds the SECRET keys)  ──►   Supabase (insert)
```

**Two different homes for configuration:**

| Config | Lives in | Secret? |
|--------|----------|---------|
| `GEMINI_API_KEY`, `GOOGLE_CLOUD_VISION_API_KEY` | **Railway** env vars | 🔒 Yes — server only |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` | Railway env vars **and** the app | No — publishable, RLS-guarded |
| `EXPO_PUBLIC_BACKEND_URL` (the Railway HTTPS URL) | The app's EAS build | No — just a URL |

---

## Prerequisites

- A Railway account (https://railway.com) — free "Trial"/"Hobby" plan is enough
  to start; a small paid plan is recommended for an always-on service.
- Access to the GitHub repo: `https://github.com/prithvibhardwaj/goldlabel-app`
  (the backend is in the `backend/` subfolder).
- The two API key **values**:
  - Google Cloud Vision API key
  - Gemini API key

  > ⚠️ Before deploying, **rotate these keys** if they were ever shared in a
  > file or chat, and restrict the Google key to the Vision API only
  > (Google Cloud Console → Credentials → API restrictions).

---

## Step 1 — Create the project from the GitHub repo

1. Log in to Railway → **New Project**.
2. Choose **Deploy from GitHub repo**.
3. Authorize Railway to access the `goldlabel-app` repository and select it.
4. Railway creates a service and starts a first build. It will likely fail or
   build the wrong folder until Step 2 — that's expected.

## Step 2 — Point the service at the `backend/` folder

The repo root is the mobile app; the server lives in `backend/`. Tell Railway
to build that subfolder:

1. Open the service → **Settings** → **Source** (or **Build**) section.
2. Set **Root Directory** to: `backend`
3. Confirm the **Start Command** is `npm start` (the default). The backend now
   defines both `start` and a Node 20 engine, so no custom command is needed.

Railway will install from `backend/package.json` and run `node index.js`.

## Step 3 — Add environment variables

Service → **Variables** → add each of these (use **Raw Editor** to paste all at
once). Get the values from the team's secret store — do **not** paste real keys
into any shared document.

```
GEMINI_API_KEY=<gemini key>
GOOGLE_CLOUD_VISION_API_KEY=<vision key>
EXPO_PUBLIC_SUPABASE_URL=https://rnqsgsxgwadtgmqowrvq.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=<supabase publishable key>
```

Notes:
- The backend uses the Supabase URL + publishable key to load the pictogram
  allowlist and to insert contributions, so they are needed here too.
- **Do not** set `PORT`. Railway injects its own `PORT`, and the code already
  listens on `process.env.PORT`.

## Step 4 — Deploy and generate a public URL

1. Railway redeploys automatically after the variables are saved (or click
   **Deploy**).
2. Once the deploy is green, go to **Settings → Networking → Public Networking**
   → **Generate Domain**.
3. Railway gives you an HTTPS URL, e.g. `https://goldlabel-backend-production.up.railway.app`.
   Copy it — this is the app's backend URL.

## Step 5 — Verify it's running

Open the generated URL in a browser (or `curl` it). You should see:

```json
{ "service": "goldlabel-backend", "status": "ok" }
```

In the Railway **Logs** tab you should also see:

```
Loaded 117 allowed pictogram IDs
GoldLabel Backend running on http://localhost:<port>
Gemini API key: ✓ set
```

If the log says `⚠ GEMINI_API_KEY not set`, a variable is missing — recheck
Step 3.

## Step 6 — Point the mobile app at the new URL

The app reads the backend URL from `EXPO_PUBLIC_BACKEND_URL`, which is baked into
the APK at build time via EAS (not from `.env`):

```
eas env:create --name EXPO_PUBLIC_BACKEND_URL \
  --value https://<your-railway-domain> --environment preview
```

(or set it in the EAS dashboard → project → Environment Variables). Then rebuild
the app:

```
npx eas-cli build --profile preview --platform android
```

The same EAS environment must also carry `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_KEY`.

## Step 7 — Post-deploy hardening (do once the HTTPS URL exists)

- In `app.json`, set `"usesCleartextTraffic": false` — it was only on for local
  HTTP testing. Railway is HTTPS, so cleartext is no longer needed.
- Lock CORS in `backend/index.js` to the app's origin (currently open to all).
- The backend already has per-IP rate limiting on both endpoints; no action
  needed, but watch the Railway logs for `429` spikes.

---

## Ongoing operations

- **Redeploys:** every push to the connected branch triggers an automatic
  build. You can also click **Deploy** manually.
- **Logs:** service → **Logs** (or **Observability**) tab, live-streamed.
- **Secrets rotation:** update the value in **Variables**; Railway redeploys.
  Keys never live in the repo, so rotation is a dashboard-only change.
- **Cost:** this is a small always-on Node service; a Railway Hobby plan is
  typically sufficient. Vision/Gemini usage is billed separately by Google.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Build fails, "no start script" | Root Directory not set to `backend` (Step 2). |
| `⚠ GEMINI_API_KEY not set` in logs | Env var missing/misspelled (Step 3). |
| `Failed to load allowed pictogram IDs` | Supabase URL/key wrong, or the `pictogram_assets` table isn't reachable. |
| App shows "Backend URL not configured" | `EXPO_PUBLIC_BACKEND_URL` not set in the EAS build (Step 6). |
| Contributions return `Could not save contribution` | The `scan_contributions` table hasn't been created — run `backend/migrations/001_scan_contributions.sql` in the Supabase SQL editor. |
