# ForgeFit cloud release

ForgeFit is now set up as a lightweight installable web app (PWA) with one same-origin Node
service. The browser downloads only the app shell; accounts, passkeys, workout history, plans,
body-weight logs, and notification subscriptions can live in Neon Postgres.

## Recommended first deployment

Use Netlify for the installable frontend, Railway for the persistent Node service and AI jobs,
and Neon for Postgres. Netlify's Edge Function proxies `/api/*` to Railway, so the browser still
sees one HTTPS hostname. That keeps WebAuthn/passkeys and host-only session cookies on the same
origin without forcing the long-running API into a serverless runtime.

1. Push this ForgeFit source to a GitHub repository you control.
2. Create a Netlify site from that repository. Netlify reads the root `netlify.toml`; the first
   deploy can finish before the API is configured. Copy the resulting site URL and hostname.
3. Create a Neon project and copy both connection strings:
   - pooled connection → `DATABASE_URL`
   - direct connection → `DATABASE_URL_UNPOOLED`
4. Create a Railway service from the same repository. Railway detects `railway.toml` and builds the
   root `Dockerfile`.
5. Add a Railway volume mounted at `/data`.
6. Generate the Railway service domain, then set these Railway variables:
   - `ORIGIN=https://your-site.netlify.app`
   - `RP_ID=your-site.netlify.app` (hostname only; no `https://`)
   - `RP_NAME=ForgeFit`
   - `SESSION_SECRET` to a long, random, stable value
   - the two Neon database variables above
7. In Netlify, add `FORGEFIT_API_ORIGIN=https://your-railway-domain` with **Functions** scope and
   trigger a new production deploy. The bundled Edge Function will proxy API traffic to Railway.
8. Visit `https://your-site.netlify.app/api/health`; it should report a healthy API before creating
   the first profile.
9. Register the first profile. To make it the administrator, copy its id from the
   `forgefit_app_meta` row with key `core`, set `ADMIN_UIDS` to that id, and redeploy.
10. On the phone, open the Netlify HTTPS URL and choose **Add to Home Screen**. It installs like an app
   without shipping the exercise library or database inside the APK.

The startup command applies the checked-in Drizzle migrations. Runtime connections use Neon's
pooled URL; migrations prefer the direct URL.

### Simpler single-service alternative

Railway can also serve both the frontend and API directly from the root Dockerfile. That uses one
service instead of Netlify plus Railway; set `ORIGIN` and `RP_ID` to the Railway or custom domain.

## AI choices

The Coach is off until an administrator enables it in **Settings → Admin dashboard → AI Coach**.
Each user also has to consent before workout data is sent to the selected model.

- **Google Gemini**: paste a Gemini API key in the admin screen. The default is
  `gemini-3.7-flash`, and the model name can be changed in the same screen. A consumer Gemini
  subscription/login does not authorize server API calls, so API billing is separate.
- **OpenAI Codex**: use the built-in device-code flow to sign in with an eligible ChatGPT
  subscription. The private refreshable login cache stays in `/data/codex`. This is the current
  project's existing CLI integration, not an OpenAI API key integration.
- **Claude Code**: paste a Claude Code setup token.
- **Fixture**: an offline test provider that makes no paid AI call.

For a first private deployment, Gemini is the easiest API integration. Set a low per-user daily
limit before inviting anyone else.

## What remains local to the service

Neon stores account metadata and workout state. The `/data` volume stores generated push keys,
the session-secret copy, AI configuration, encrypted provider credentials, and short-lived Coach
job results. Back up Neon and the Railway volume; neither belongs in the mobile install.

## Mobile packaging later

The same frontend remains Capacitor-ready under `frontend/capacitor.config.json` with application
id `com.forgefit.app`. A Play Store or App Store wrapper can be added later, but the PWA is the
smallest and fastest first mobile release and already supports home-screen installation.
