# RPS Multiplayer

A lightweight Cloudflare Worker game where players join a room, choose a move, and resolve a Rock Paper Scissors round — against another player or a practice bot.

## Features

- Multiplayer rooms with shareable codes, or a solo match against an easy/medium/hard bot
- Accounts: register, sign in, or play instantly as a generated guest
- All-time leaderboard (registered human accounts only; bot and guest matches are excluded)
- Rate-limited auth endpoints and automatic idle-room expiry
- Daily scheduled cleanup of stale guest accounts

## Current architecture

- Front-end: static HTML, CSS, and JavaScript in `public/`
- Application logic: TypeScript Worker in `src/index.ts`
- Persistence: Durable Objects for room state (with idle-expiry alarms) and D1 for users/leaderboard
- Authentication: D1 users plus signed HttpOnly session cookies
- Bot opponent: pure move-prediction logic in `src/game.ts` (`getBotMove`)
- Tests: Vitest (`@cloudflare/vitest-pool-workers`) coverage in `test/`, running against the real Workers runtime

## Recommended team split

To make the project easier to evolve, split work into a few clear responsibilities:

### 1. Game engine
Responsible for:
- move resolution rules
- round reset behavior
- room state transitions
- winner detection

### 2. Room service
Responsible for:
- room creation and join flow
- validation and error handling
- Durable Object lifecycle
- API requests to the room state

### 3. Leaderboard service
Responsible for:
- D1 schema management
- match result recording
- leaderboard sorting and update logic
- fallback behavior when no DB binding is configured

### 4. UI / experience
Responsible for:
- layout and interaction
- player status states
- move buttons and room controls
- responsiveness and polish

## Near-term roadmap

See [docs/plan.md](docs/plan.md) for the full improvement plan, including what's shipped and what's next.

## Local development

```bash
npm install
npm run db:migrate:local
npm run dev
```

`npm install` automatically runs `wrangler types` (via `postinstall`) to generate `worker-configuration.d.ts`. `wrangler dev` reads `AUTH_SECRET` from the untracked `.dev.vars` file. A development value is included locally; replace it with a unique value before sharing the environment. Then open the local Worker URL reported by Wrangler.

Before deploying, apply the auth migration to the remote database and configure a strong secret:

```bash
npm run db:migrate:remote
npx wrangler secret put AUTH_SECRET
npm run deploy
```

The browser can create an account, sign in, play as a guest, or start a bot match. Authentication uses `/api/auth/register`, `/api/auth/login`, `/api/auth/guest`, `/api/auth/me`, and `/api/auth/logout`. Room and move endpoints require the signed session cookie; they no longer accept a caller-provided player name or user ID.

## Test suite

```bash
npm run typecheck
npm test
```
