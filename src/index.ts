import { DurableObject } from "cloudflare:workers";

import {
  getPlayer,
  isMove,
  isDifficulty,
  normalizeRoomForClient,
  resolveRpsRound,
  getBotMove,
  type Move,
  type PlayerState,
  type RoomState,
} from "./game";
import { getLeaderboardFromDb, recordMatchResult } from "./leaderboard";
import {
  clearSessionCookie,
  createGuestUser,
  createSessionCookie,
  getSessionUser,
  jsonWithCookie,
  registerUser,
  validateCredentials,
  verifyUser,
  type AuthUser,
} from "./auth";

export type AppEnv = Env & {
  RPS_ROOMS: DurableObjectNamespace;
  DB?: D1Database;
  AUTH_SECRET?: string;
};

// Fixed synthetic user ID for the bot player in a room; bots are never real accounts.
const BOT_USER_ID = "bot";

export * from "./game";
export * from "./leaderboard";
export * from "./room";
export * from "./auth";

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json()) as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function requireUser(request: Request, env: AppEnv): Promise<AuthUser | Response> {
  if (!env.DB || !env.AUTH_SECRET) {
    return Response.json({ error: "Authentication is not configured" }, { status: 503 });
  }
  const user = await getSessionUser(env.DB, request, env.AUTH_SECRET);
  // Returning a Response (instead of throwing) lets callers early-return it directly as the handler result.
  return user ?? Response.json({ error: "Authentication required" }, { status: 401 });
}

export class RpsRoom extends DurableObject<AppEnv> {
  // One RpsRoom instance per room ID; state lives in Durable Object storage, not this class's memory.
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const room = (await this.ctx.storage.get<RoomState>("room")) ?? {
      id: crypto.randomUUID(),
      players: [],
      status: "waiting",
    };

    switch (url.pathname) {
      case "/":
        return Response.json(room);
      case "/create": {
        const body = await parseJsonBody(request);
        const userId = typeof body.userId === "string" ? body.userId : "";
        const playerName = typeof body.username === "string" ? body.username.trim() : "";
        if (!userId || !playerName) {
          return Response.json({ error: "Authenticated user is required" }, { status: 400 });
        }

        if (room.players.length === 0) {
          room.players = [{ userId, name: playerName }];
          room.id = room.id || crypto.randomUUID();
          room.status = "waiting";
          room.scores = { playerOne: 0, playerTwo: 0 };
          await this.ctx.storage.put("room", room);
        }

        return Response.json(room, { status: 201 });
      }
      case "/create-bot": {
        const body = await parseJsonBody(request);
        const userId = typeof body.userId === "string" ? body.userId : "";
        const playerName = typeof body.username === "string" ? body.username.trim() : "";
        const difficulty = isDifficulty(body.difficulty) ? body.difficulty : "easy";
        if (!userId || !playerName) {
          return Response.json({ error: "Authenticated user is required" }, { status: 400 });
        }

        room.players = [
          { userId, name: playerName },
          { userId: BOT_USER_ID, name: `Bot (${difficulty})`, isBot: true },
        ];
        room.id = room.id || crypto.randomUUID();
        room.status = "waiting";
        room.scores = { playerOne: 0, playerTwo: 0 };
        room.difficulty = difficulty;
        room.moveHistory = [];
        await this.ctx.storage.put("room", room);
        return Response.json(room, { status: 201 });
      }
      case "/join": {
        const body = await parseJsonBody(request);
        const userId = typeof body.userId === "string" ? body.userId : "";
        const playerName = typeof body.username === "string" ? body.username.trim() : "";
        if (!userId || !playerName) {
          return Response.json({ error: "Authenticated user is required" }, { status: 400 });
        }
        if (room.players.length >= 2) {
          return Response.json({ error: "Room is full" }, { status: 400 });
        }
        if (getPlayer(room, userId)) {
          return Response.json({ error: "Player already in room" }, { status: 400 });
        }

        room.players.push({ userId, name: playerName });
        await this.ctx.storage.put("room", room);
        return Response.json(room);
      }
      case "/move": {
        const body = await parseJsonBody(request);
        const userId = typeof body.userId === "string" ? body.userId : "";
        const move = typeof body.move === "string" ? body.move : "";
        if (!userId || !isMove(move)) {
          return Response.json({ error: "Authenticated user and a valid move are required" }, { status: 400 });
        }

        const player = getPlayer(room, userId);
        if (!player) {
          return Response.json({ error: "User is not in this room" }, { status: 400 });
        }
        if (room.status === "finished") {
          return Response.json({ error: "Room already finished" }, { status: 400 });
        }

        player.move = move;

        const bot = room.players.find((candidate: PlayerState) => candidate.isBot);
        if (bot && !bot.move) {
          // Bot decides using history collected so far, then the human's move is recorded for next time.
          bot.move = getBotMove(room.difficulty ?? "easy", room.moveHistory ?? []);
          room.moveHistory = [...(room.moveHistory ?? []), move].slice(-10);
        }

        if (room.players.length === 2 && room.players.every((candidate: PlayerState) => !!candidate.move)) {
          const [playerOne, playerTwo] = room.players;
          const result = resolveRpsRound(playerOne.move!, playerTwo.move!);
          room.lastResult = result;
          if (result.winner === "player-one") {
            room.scores = room.scores ?? { playerOne: 0, playerTwo: 0 };
            room.scores.playerOne += 1;
          } else if (result.winner === "player-two") {
            room.scores = room.scores ?? { playerOne: 0, playerTwo: 0 };
            room.scores.playerTwo += 1;
          }

          delete playerOne.move;
          delete playerTwo.move;
          if ((room.scores?.playerOne ?? 0) >= 2 || (room.scores?.playerTwo ?? 0) >= 2) {
            room.status = "finished";
            room.winner = room.scores.playerOne >= 2 ? playerOne.name : playerTwo.name;
          } else {
            room.status = "waiting";
            room.winner = undefined;
          }
        }

        await this.ctx.storage.put("room", room);
        return Response.json(room);
      }
      case "/reset": {
        const body = await parseJsonBody(request);
        const userId = typeof body.userId === "string" ? body.userId : "";
        if (!getPlayer(room, userId)) {
          return Response.json({ error: "User is not in this room" }, { status: 403 });
        }
        for (const player of room.players) {
          delete player.move;
        }
        room.status = "waiting";
        room.lastResult = undefined;
        room.winner = undefined;
        room.scores = { playerOne: 0, playerTwo: 0 };
        await this.ctx.storage.put("room", room);
        return Response.json(room);
      }
      default:
        return Response.json({ error: "Not found" }, { status: 404 });
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const appEnv = env as AppEnv;
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "rps-multiplayer" });
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      if (!appEnv.DB || !appEnv.AUTH_SECRET) {
        return Response.json({ error: "Authentication is not configured" }, { status: 503 });
      }
      const body = await parseJsonBody(request);
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const validationError = validateCredentials(username, password);
      if (validationError) return Response.json({ error: validationError }, { status: 400 });
      try {
        const user = await registerUser(appEnv.DB, username, password);
        return jsonWithCookie({ user }, await createSessionCookie(user.id, appEnv.AUTH_SECRET), { status: 201 });
      } catch (error) {
        if (String(error).toLowerCase().includes("unique")) {
          return Response.json({ error: "Username is already taken" }, { status: 409 });
        }
        throw error;
      }
    }

    if (url.pathname === "/api/auth/guest" && request.method === "POST") {
      if (!appEnv.DB || !appEnv.AUTH_SECRET) {
        return Response.json({ error: "Authentication is not configured" }, { status: 503 });
      }
      const user = await createGuestUser(appEnv.DB);
      return jsonWithCookie({ user }, await createSessionCookie(user.id, appEnv.AUTH_SECRET), { status: 201 });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!appEnv.DB || !appEnv.AUTH_SECRET) {
        return Response.json({ error: "Authentication is not configured" }, { status: 503 });
      }
      const body = await parseJsonBody(request);
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const user = await verifyUser(appEnv.DB, username, password);
      if (!user) return Response.json({ error: "Invalid username or password" }, { status: 401 });
      return jsonWithCookie({ user }, await createSessionCookie(user.id, appEnv.AUTH_SECRET));
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      if (!appEnv.DB || !appEnv.AUTH_SECRET) return Response.json({ user: null });
      const user = await getSessionUser(appEnv.DB, request, appEnv.AUTH_SECRET);
      return Response.json({ user: user ?? null });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return jsonWithCookie({ ok: true }, clearSessionCookie());
    }

    if (url.pathname === "/api/leaderboard") {
      if (!appEnv.DB) {
        return Response.json([]);
      }
      return Response.json(await getLeaderboardFromDb(appEnv.DB));
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const userResult = await requireUser(request, appEnv);
      if (userResult instanceof Response) return userResult;
      const user = userResult;
      const body = await parseJsonBody(request);

      const roomId = crypto.randomUUID();
      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      // The URL host is a placeholder; only the DO's internal routing on the pathname below matters.
      const roomResponse = await stub.fetch(
        new Request("https://example.com/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id, username: user.username }),
        })
      );

      const room = normalizeRoomForClient((await roomResponse.json()) as RoomState, roomId, user.id);
      return Response.json(room, { status: 201 });
    }

    if (url.pathname === "/api/rooms/bot" && request.method === "POST") {
      const userResult = await requireUser(request, appEnv);
      if (userResult instanceof Response) return userResult;
      const user = userResult;
      const body = await parseJsonBody(request);
      const difficulty = isDifficulty(body.difficulty) ? body.difficulty : "easy";

      const roomId = crypto.randomUUID();
      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(
        new Request("https://example.com/create-bot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id, username: user.username, difficulty }),
        })
      );

      const room = normalizeRoomForClient((await roomResponse.json()) as RoomState, roomId, user.id);
      return Response.json(room, { status: 201 });
    }

    if (url.pathname === "/api/rooms/join" && request.method === "POST") {
      const userResult = await requireUser(request, appEnv);
      if (userResult instanceof Response) return userResult;
      const user = userResult;
      const body = await parseJsonBody(request);
      const roomId = typeof body.roomId === "string" ? body.roomId : "";
      if (!roomId) {
        return Response.json({ error: "roomId is required" }, { status: 400 });
      }

      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(
        new Request("https://example.com/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id, username: user.username }),
        })
      );
      const payload = await roomResponse.json();

      if (!roomResponse.ok) {
        return Response.json(payload, { status: roomResponse.status });
      }

      if (!getPlayer(payload as RoomState, user.id)) {
        return Response.json({ error: "You are not a member of this room" }, { status: 403 });
      }

      return Response.json(normalizeRoomForClient(payload as RoomState, roomId, user.id));
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
    if (roomMatch && request.method === "GET") {
      const roomId = roomMatch[1];
      const userResult = await requireUser(request, appEnv);
      if (userResult instanceof Response) return userResult;
      const user = userResult;
      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(new Request("https://example.com/"));
      const payload = await roomResponse.json();

      if (!roomResponse.ok) {
        return Response.json(payload, { status: roomResponse.status });
      }

      return Response.json(normalizeRoomForClient(payload as RoomState, roomId, user.id));
    }

    const moveMatch = /^\/api\/rooms\/([^/]+)\/move$/.exec(url.pathname);
    if (moveMatch && request.method === "POST") {
      const roomId = moveMatch[1];
      const userResult = await requireUser(request, appEnv);
      if (userResult instanceof Response) return userResult;
      const user = userResult;
      const body = await parseJsonBody(request);
      const move = typeof body.move === "string" ? body.move : "";
      if (!isMove(move)) {
        return Response.json({ error: "A valid move is required" }, { status: 400 });
      }

      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(
        new Request("https://example.com/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id, move }),
        })
      );

      const roomPayload = (await roomResponse.json()) as RoomState;
      if (!roomResponse.ok) {
        return Response.json(roomPayload, { status: roomResponse.status });
      }
      // Only persist a leaderboard update once the match has actually concluded, not after every round.
      // Bot matches are excluded so the leaderboard only reflects human-vs-human results.
      if (roomPayload.status === "finished" && roomPayload.lastResult && !roomPayload.players.some((candidate) => candidate.isBot)) {
        const [playerOne, playerTwo] = roomPayload.players;
        if (roomPayload.lastResult.winner === "player-one") {
          await recordMatchResult(
            {
              winnerName: playerOne.name,
              loserName: playerTwo.name,
              winnerUserId: playerOne.userId,
              loserUserId: playerTwo.userId,
              winnerMove: roomPayload.lastResult.playerOneMove ?? "rock",
              loserMove: roomPayload.lastResult.playerTwoMove ?? "rock",
            },
            appEnv.DB,
          );
        } else if (roomPayload.lastResult.winner === "player-two") {
          await recordMatchResult(
            {
              winnerName: playerTwo.name,
              loserName: playerOne.name,
              winnerUserId: playerTwo.userId,
              loserUserId: playerOne.userId,
              winnerMove: roomPayload.lastResult.playerTwoMove ?? "rock",
              loserMove: roomPayload.lastResult.playerOneMove ?? "rock",
            },
            appEnv.DB,
          );
        }
      }

      return Response.json(normalizeRoomForClient(roomPayload, roomId, user.id));
    }

    const resetMatch = /^\/api\/rooms\/([^/]+)\/reset$/.exec(url.pathname);
    if (resetMatch && request.method === "POST") {
      const roomId = resetMatch[1];
      const userResult = await requireUser(request, appEnv);
      if (userResult instanceof Response) return userResult;
      const user = userResult;
      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(new Request("https://example.com/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      }));
      const payload = await roomResponse.json();

      if (!roomResponse.ok) {
        return Response.json(payload, { status: roomResponse.status });
      }

      return Response.json(normalizeRoomForClient(payload as RoomState, roomId, user.id));
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
