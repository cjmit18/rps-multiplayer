import { type Move, type RoomState } from "./game";

export interface LeaderboardEntry {
  name: string;
  wins: number;
  losses: number;
  ties: number;
}

async function ensureLeaderboardTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      name TEXT PRIMARY KEY,
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
    "SELECT name, wins, losses, ties FROM leaderboard ORDER BY wins DESC, losses ASC, name ASC LIMIT 20"
  ).all<{ name: string; wins: number; losses: number; ties: number }>();

  return result.results.map((row) => ({
    name: row.name,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
  }));
}

export async function syncLeaderboardFromMatch(
  db: D1Database,
  params: {
    winnerName: string;
    loserName: string;
    winnerMove: Move;
    loserMove: Move;
  }
): Promise<LeaderboardEntry[]> {
  await ensureLeaderboardTable(db);
  const { winnerName, loserName, winnerMove, loserMove } = params;

  const winnerRow = await db.prepare("SELECT wins, losses, ties FROM leaderboard WHERE name = ?").bind(winnerName).first<{ wins: number; losses: number; ties: number }>();
  const loserRow = await db.prepare("SELECT wins, losses, ties FROM leaderboard WHERE name = ?").bind(loserName).first<{ wins: number; losses: number; ties: number }>();

  const winnerEntry: LeaderboardEntry = {
    name: winnerName,
    wins: winnerRow?.wins ?? 0,
    losses: winnerRow?.losses ?? 0,
    ties: winnerRow?.ties ?? 0,
  };
  const loserEntry: LeaderboardEntry = {
    name: loserName,
    wins: loserRow?.wins ?? 0,
    losses: loserRow?.losses ?? 0,
    ties: loserRow?.ties ?? 0,
  };

  winnerEntry.wins += 1;
  loserEntry.losses += 1;

  if (winnerMove === loserMove) {
    winnerEntry.ties += 1;
    loserEntry.ties += 1;
    winnerEntry.wins = Math.max(0, winnerEntry.wins - 1);
    loserEntry.losses = Math.max(0, loserEntry.losses - 1);
  }

  await db.batch([
    db.prepare(
      "INSERT INTO leaderboard (name, wins, losses, ties, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO UPDATE SET wins = excluded.wins, losses = excluded.losses, ties = excluded.ties, updated_at = CURRENT_TIMESTAMP"
    ).bind(winnerName, winnerEntry.wins, winnerEntry.losses, winnerEntry.ties),
    db.prepare(
      "INSERT INTO leaderboard (name, wins, losses, ties, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO UPDATE SET wins = excluded.wins, losses = excluded.losses, ties = excluded.ties, updated_at = CURRENT_TIMESTAMP"
    ).bind(loserName, loserEntry.wins, loserEntry.losses, loserEntry.ties),
  ]);

  return getLeaderboardFromDb(db);
}

export function recordMatchResult(
  params: {
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
      name: params.winnerName,
      wins: 0,
      losses: 0,
      ties: 0,
    };
    const loserEntry = fallback.get(params.loserName) ?? {
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
