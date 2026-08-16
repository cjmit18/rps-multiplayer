import { type Move } from "./game";

export interface LeaderboardEntry {
  userId: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
}

async function ensureLeaderboardTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      name TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      ties INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
    ON leaderboard (wins DESC, losses ASC, name ASC)
  `).run();
}

export async function getLeaderboardFromDb(db: D1Database): Promise<LeaderboardEntry[]> {
  await ensureLeaderboardTable(db);
  const result = await db.prepare(
    "SELECT user_id, name, wins, losses, ties FROM leaderboard ORDER BY wins DESC, losses ASC, name ASC LIMIT 20"
  ).all<{ user_id: string | null; name: string; wins: number; losses: number; ties: number }>();

  return result.results.map((row) => ({
    name: row.name,
    userId: row.user_id ?? `legacy:${row.name}`,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
  }));
}

export async function syncLeaderboardFromMatch(
  db: D1Database,
  params: {
    winnerUserId: string;
    loserUserId: string;
    winnerName: string;
    loserName: string;
    winnerMove: Move;
    loserMove: Move;
  }
): Promise<LeaderboardEntry[]> {
  await ensureLeaderboardTable(db);
  const { winnerUserId, loserUserId, winnerName, loserName, winnerMove, loserMove } = params;

  const updateEntry = (userId: string, name: string, field: "wins" | "losses" | "ties") => db.prepare(
    `INSERT INTO leaderboard (user_id, name, ${field}, updated_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP) ON CONFLICT(user_id) WHERE user_id IS NOT NULL DO UPDATE SET name = excluded.name, ${field} = ${field} + 1, updated_at = CURRENT_TIMESTAMP`,
  ).bind(userId, name);

  await db.batch(winnerMove === loserMove
    ? [updateEntry(winnerUserId, winnerName, "ties"), updateEntry(loserUserId, loserName, "ties")]
    : [updateEntry(winnerUserId, winnerName, "wins"), updateEntry(loserUserId, loserName, "losses")]);

  return getLeaderboardFromDb(db);
}

export function recordMatchResult(
  params: {
    winnerUserId: string;
    loserUserId: string;
    winnerName: string;
    loserName: string;
    winnerMove: Move;
    loserMove: Move;
  },
  db?: D1Database,
): Promise<LeaderboardEntry[]> | LeaderboardEntry[] {
  if (!db) {
    const fallback = new Map<string, LeaderboardEntry>();
    const winnerEntry = fallback.get(params.winnerName) ?? {
      userId: params.winnerUserId,
      name: params.winnerName,
      wins: 0,
      losses: 0,
      ties: 0,
    };
    const loserEntry = fallback.get(params.loserName) ?? {
      userId: params.loserUserId,
      name: params.loserName,
      wins: 0,
      losses: 0,
      ties: 0,
    };

    winnerEntry.wins += 1;
    loserEntry.losses += 1;
    if (params.winnerMove === params.loserMove) {
      winnerEntry.ties += 1;
      loserEntry.ties += 1;
      winnerEntry.wins = Math.max(0, winnerEntry.wins - 1);
      loserEntry.losses = Math.max(0, loserEntry.losses - 1);
    }

    fallback.set(params.winnerName, winnerEntry);
    fallback.set(params.loserName, loserEntry);
    return [...fallback.values()].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.losses !== a.losses) return a.losses - b.losses;
      return a.name.localeCompare(b.name);
    });
  }

  return syncLeaderboardFromMatch(db, params);
}
