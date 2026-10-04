# ForgeFit on Netlify + Neon

The selected cloud setup uses **Netlify for the frontend and backend functions**, **Neon for
durable Postgres data**, and **OpenRouter free models for optional AI**. No Railway, Render
server, virtual machine, persistent disk, local AI model, or GPU is required.

The public frontend is [forgefit-rutvik.netlify.app](https://forgefit-rutvik.netlify.app/).
Loading the login page does not prove that cloud saving, authentication, or AI is configured.

## Private Netlify configuration

Use Project configuration → Environment variables. Never commit credentials or use frontend
`VITE_*` variables for secrets. Mark database URLs and the signing secret as secret values.

| Variable | Value/purpose |
| --- | --- |
| `DATABASE_URL` | Neon's pooled URL for runtime queries |
| `DATABASE_URL_UNPOOLED` | Neon's direct URL for checked-in Drizzle migrations |
| `SESSION_SECRET` | A random, stable secret of at least 32 characters |
| `OWNER_SETUP_CODE` | A private, random 32-character uppercase code for the first administrator |
| `ORIGIN` | `https://forgefit-rutvik.netlify.app` |
| `RP_ID` | `forgefit-rutvik.netlify.app` |
| `RP_NAME` | `ForgeFit` |
| `INVITE_ONLY` | `true` (also the serverless implementation's default) |
| `COACH_DISABLED` | `false` to allow admin setup; the Coach still starts off |
| `SCHEDULED_NOTIFICATIONS_ENABLED` | `true` for 15-minute reminder/weekly-review checks; otherwise `false` |

Free Netlify accounts may not support separate variable scopes; do not upgrade for this.
Use deploy-context values instead: production credentials only in production, isolated
Neon branch credentials for previews, and empty unrelated/untrusted contexts. Preserve the
approval requirement for untrusted deploys.

Keep `SESSION_SECRET` unchanged. It signs cookies, pseudonymizes AI payloads and encrypts the
OpenRouter key. After the first profile is created, a stored fingerprint detects accidental
changes and fails closed.

Enter `OWNER_SETUP_CODE` in the first **Create new profile → Invite code** field, then finish
the passkey prompt on your own device. The code cannot create a second administrator after an
owner exists. The admin can issue ordinary single-use invitation codes. Do not publish the
bootstrap code or passkeys.

## Deployment and verification

1. Test the checked-in Drizzle migrations on a child branch of the existing production
   database before production. Do not reset or overwrite production from a test branch.
   The two existing tables are preserved; no destructive schema change is needed.
2. Provide direct and pooled URLs for the appropriate environment. The Netlify build installs
   backend dependencies, runs Drizzle migrations and builds the frontend. Without a database,
   the frontend can build, but the API returns 503.
3. Deploy from your repository. Three functions are deployed:
   - `forgefit-api`: handles `/api/*`, passkeys, saved workouts, settings and admin routes.
   - `forgefit-worker-background`: runs short-lived, server-signed AI jobs/rest alerts.
   - `forgefit-scheduled`: checks reminders and automatic weekly reviews every 15 minutes.
4. Verify `/api/health` returns HTTP 200 and `hosting: "netlify-functions"`, `storage: "neon"`
   and `runtimeStorage: "neon"`. A 503 is not a completed backend deployment.
5. Create the owner on the final HTTPS hostname. Verify passkey sign-out/sign-in, save/reload
   a sample workout and check it from another signed-in device before importing real history.
6. On your phone, open the HTTPS site and choose **Install app / Add to Home Screen**.

The superseded Edge proxy is archived in `api/legacy/netlify-api-proxy.js`; it is no longer
deployed and `FORGEFIT_API_ORIGIN` is no longer needed. Docker and optional Render/Railway
manifests remain for self-hosters, but are not used in this selected setup.

## What lives where

Functions read and write Neon directly, without account/state caches or durable local files.
Cross-instance transaction locks protect invitation redemption, credential counters, settings,
and AI quotas. Passkey challenges expire after five minutes and are atomically consumed once.
Browser mutations require same-origin JSON requests.

Neon stores profiles, passkeys, workouts, plans, weigh-ins, notification subscriptions,
stable push keys, encrypted AI credentials, proposals/jobs and short-lived presence records.
Authenticated user/admin route checks govern access. Proposals are separate from synced client
state so a normal device sync cannot erase them.

The PWA still keeps a local/offline copy and the current in-progress workout on the device.
**Continue without account is device-only, not cloud backup.** Exercise media is loaded from
the configured CDN. No huge media folder or AI model is installed on the phone.

## OpenRouter: optional and free-only

In **Settings → Admin dashboard → AI Coach**, enable the Coach and add an OpenRouter API key
through the private key form, never chat or GitHub. Save-and-test sends a synthetic JSON prompt,
not workout history. Each user must separately consent before personal data is sent.

`openrouter/free` is a router, not a single fixed AI. An explicit reviewed model ID ending in
`:free` can be pinned instead. The Netlify backend only supports OpenRouter; the original
Docker backend's subscription/CLI integrations are not deployed in functions.

Paid model IDs, paid fallback models and plugins are blocked. Before inference, pricing must
be verifiably zero. Requests also set zero-price ceilings and disable provider fallback.
Unavailable models, exhausted quotas or unverifiable pricing stop the request; nothing buys
credits or upgrades automatically.

[OpenRouter's free plan](https://openrouter.ai/pricing) currently allows 50 requests/day across
the account. ForgeFit enforces 5 jobs/profile/day, 20 jobs/instance/day and 40 AI requests/day,
including tests and one permitted JSON repair. Transactional counters survive forgetting the
Coach. Usage in other apps can still exhaust the shared quota. Free availability is not promised.

Payloads exclude login credentials, account identifiers and other users' data. Workout logs,
weigh-ins, intake limitations and free text can still be personal information; pseudonyms do
not make them anonymous. Review [provider privacy policies](https://openrouter.ai/docs/guides/privacy/provider-logging)
before using real history. Retention/training policies vary: verify a privacy-compatible free
endpoint before sending sensitive data and avoid medical notes in prompts.

Workers claim a job once, so duplicate background delivery cannot duplicate inference. At most
one JSON repair is made. A lost mid-execution job times out instead of silently re-running.
The user reviews/applies proposals. Withdrawing consent clears the job/proposal and prevents
later execution/completion. A server-side withdrawal timestamp also blocks stale offline
snapshots from re-enabling sharing; a new explicit acceptance is required. Data already
sent cannot be unsent.

## Notifications and free-tier limits

Stable VAPID keys and subscriptions live in Neon. Background rest alerts support up to
14 minutes, below Netlify's 15-minute execution limit; cancelling/extending invalidates the
old worker. On-screen timers work independently. Push delivery depends on the browser/OS.
Sleeping workers consume compute credits, so leave cloud alerts off if not needed.

Day reminders and weekly reviews are checked every 15 minutes in the user's timezone.
They may arrive after the selected time, and outages/paused services can prevent delivery.
A one-minute scan would keep Neon awake all month and undermine its free compute allowance.
Workout-count AI reviews are event-driven on sync. The UI discloses timing and hides scheduled
controls when the host disables them.

[Netlify Free](https://www.netlify.com/pricing/) currently has a 300-credit monthly limit;
Neon has separate compute/storage limits. Use Free plans, do not add a card, and do not enable
paid upgrades or automatic top-ups. Services can pause at their limits. Free is not unlimited.

## Local verification and mobile packaging

From `api`: `npm test` and `npm run test:netlify`. The latter uses Netlify's real bundler
without deployment or an AI call. From `frontend`: `npm test` and `npm run build`.
Cold-start, invitation/session isolation, concurrent mutations, consent, quotas and duplicate
worker tests use an isolated fake store/provider. Real Neon, passkey, sync, push and AI smoke
tests are separate deployment checks, not conclusions inferred from unit tests.

An APK can be packaged later from the Capacitor project. Its current native-only build is
not the cloud-synced PWA; the PWA is the initial lightweight mobile release.
