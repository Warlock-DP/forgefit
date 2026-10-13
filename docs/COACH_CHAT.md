# Workout planning chat

The Netlify/Neon deployment supports an account-scoped planning conversation using
the existing encrypted, owner-configured, free-only OpenRouter adapter. The
single-process/CLI deployment retains its existing plan/review interface.

## User flow

1. Open Plan → Coach chat. A disconnected instance still exposes the setup screen;
   it does not generate fake AI responses.
2. Accept the Coach disclosure, set equipment/goals in the editable profile, and
   enter available weights per dumbbell in kilograms (for example `4, 6, 10`).
3. The owner configures/enables OpenRouter in Admin. Existing encrypted key storage,
   verified zero-price requests and no-paid-fallback rules are unchanged.
4. Agree to save/share recent chat, then send a planning message. The existing
   asynchronous background worker, authentication, consent and quota gates apply.
5. Replies may ask questions or offer a complete plan preview. No routines,
   workouts, equipment profile or schedule change until explicitly approved.
   Approval uses the existing plan import flow, which adds routines; it does not
   delete existing routines. A failed revision retains the previous preview.

## Constraints and privacy

- Home planning uses a small audited set of floor, dumbbell and pull-up-bar
  movements, with explicit requirements. Unknown/custom requirements are excluded.
  This intentionally favours correctness over catalogue breadth. Bench/machine
  movements cannot be substituted just because their primary label is dumbbell.
- `full gym` is an explicit opt-in to the whole catalogue, not the default.
  Equipment such as bands/benches needs audited entries before home support expands.
- Equipment validation runs on generated proposals and again on client approval.
  Available dumbbell loads are checked for generated plans and at approval.
- The server keeps at most 20 successful conversation messages per account in the
  existing private coach record. Recent messages and saved profile context are
  sent to OpenRouter on follow-up requests. Failed replies are not invented or
  recorded as successful conversation. Forget/revocation removes cloud chat.
- The current hard quota remains five jobs per profile/day, twenty instance jobs
  and forty provider requests/day. Each chat message consumes a job; repairs may
  consume an additional request. Model unavailability is surfaced without paid fallback.
- The shown model is the configured OpenRouter model/router, not a claim about
  which underlying model `openrouter/free` ultimately routes to.

## Verification

Tests simulate provider responses: follow-ups, private persistence across workers,
preview-only output, incompatible revisions, unavailable dumbbell weights,
no-key failures and existing consent/quota behaviour. Real-provider end-to-end
verification requires an owner-entered OpenRouter key; never commit one.
