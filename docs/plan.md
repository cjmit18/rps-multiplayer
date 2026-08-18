# Improvement plan

Internal tracking doc for the quality/functionality review. Update statuses as items land.

## P0 — Foundation (done)

- [x] Add `package.json`, `tsconfig.json`, `vitest.config.ts`, `test/tsconfig.json` for a reproducible install and typecheck.
- [x] Untrack `node_modules/` and `.wrangler/` from git; add both to `.gitignore`.
- [x] Switch to Wrangler-generated runtime types (`wrangler types` via `postinstall`) instead of `@cloudflare/workers-types`.
- [x] Fix real bugs the new tooling surfaced: `room.scores` possibly-`undefined` type hole; two stale tests that never actually exercised the viewer-vs-opponent branch.
- [x] Tests now run against the real Workers runtime via `@cloudflare/vitest-pool-workers` (previously never executed at all).

Not done: CI workflow (typecheck/test/deploy dry-run on PRs).

## P1 — Security & data hygiene (done)

- [x] Rate limit `/api/auth/register`, `/api/auth/login`, `/api/auth/guest` (native `ratelimits` binding, 20 req/60s per IP+route).
- [x] Durable Object idle-expiry: `RpsRoom.saveRoom()` resets a 30-minute alarm; `alarm()` clears storage for abandoned rooms.
- [x] Exclude guest accounts (`guest_*`) and bot matches from leaderboard writes and reads.
- [x] Daily cron (`0 3 * * *`) purges guest accounts and their leaderboard rows after 7 days (`deleteStaleGuestAccounts`).

## P2 — Gameplay & functionality (not started)

- [ ] Replace 2s polling with real-time updates via the Durable Object's WebSocket support (`ctx.acceptWebSocket`).
- [ ] Rematch / "play again vs same opponent" flow.
- [ ] Spectator / read-only room view.
- [ ] Per-user stats (win streaks, win rate vs. bot difficulty) and a simple ranking beyond raw win/loss/tie counts.
- [ ] Public "quick match" queue (auto-pair two waiting humans) vs. private code-only rooms.

## P3 — Web design / UX polish (not started)

- [ ] Lightweight animation/transition for move reveal and round result (currently text-only).
- [ ] Light/dark theme toggle (currently dark-only); loading skeleton for the leaderboard.
- [ ] Optional sound/haptic feedback for move submission and round result.
- [ ] Consolidate the repeated "call DO stub \u2192 parse JSON \u2192 check `.ok` \u2192 normalize" pattern in `src/index.ts` into a small `callRoom()` helper.

## Deferred / needs a decision

- CI workflow (GitHub Actions: install \u2192 typecheck \u2192 test \u2192 `wrangler deploy --dry-run`).
- Whether to add a `RATE_LIMITER`-backed quick-match queue or keep rooms code-only.
