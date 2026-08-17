# RPS Multiplayer

A lightweight Cloudflare Worker game where two players join a room, choose a move, and resolve a Rock Paper Scissors round.

## Current architecture

- Front-end: static HTML, CSS, and JavaScript in `public/`
- Application logic: TypeScript Worker in `src/index.ts`
- Persistence: Durable Objects for room state and D1 for leaderboard records
- Authentication: D1 users plus signed HttpOnly session cookies
- Tests: Vitest coverage in `test/`

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

1. Split the UI from the HTML into dedicated CSS and JavaScript files.
2. Keep the room lifecycle logic centralized and consistent.
3. Replace client polling with a real-time event model.
4. Add richer UX states and mobile polish.
5. Expand tests for API and game edge cases.

## Local development

```bash
npm install
npx wrangler d1 migrations apply rps-multiplayer-db --local
npm run dev
```

`wrangler dev` reads `AUTH_SECRET` from the untracked `.dev.vars` file. A development value is included locally; replace it with a unique value before sharing the environment. Then open the local Worker URL reported by Wrangler.

Before deploying, apply the auth migration to the remote database and configure a strong secret:

```bash
npx wrangler d1 migrations apply rps-multiplayer-db --remote
npx wrangler secret put AUTH_SECRET
```

The browser can create an account, sign in, or play as a generated guest. Authentication uses `/api/auth/register`, `/api/auth/login`, `/api/auth/guest`, `/api/auth/me`, and `/api/auth/logout`. Room and move endpoints require the signed session cookie; they no longer accept a caller-provided player name or user ID.

## Test suite

```bash
npm test -- --run
```
