import { DurableObject } from "cloudflare:workers";

import {
  getPlayer,
  isMove,
  normalizeRoomForClient,
  resolveRpsRound,
  type Move,
  type PlayerState,
  type RoomState,
} from "./game";
import { getLeaderboardFromDb, recordMatchResult } from "./leaderboard";

export type AppEnv = Env & {
  RPS_ROOMS: DurableObjectNamespace;
  DB?: D1Database;
};

export * from "./game";
export * from "./leaderboard";
export * from "./room";

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json()) as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class RpsRoom extends DurableObject<AppEnv> {
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
        const playerName = typeof body.playerName === "string" ? body.playerName.trim() : "";
        if (!playerName) {
          return Response.json({ error: "Player name is required" }, { status: 400 });
        }

        if (room.players.length === 0) {
          room.players = [{ name: playerName }];
          room.id = room.id || crypto.randomUUID();
          room.status = "waiting";
          await this.ctx.storage.put("room", room);
        }

        return Response.json(room, { status: 201 });
      }
      case "/join": {
        const body = await parseJsonBody(request);
        const playerName = typeof body.playerName === "string" ? body.playerName.trim() : "";
        if (!playerName) {
          return Response.json({ error: "Player name is required" }, { status: 400 });
        }
        if (room.players.length >= 2) {
          return Response.json({ error: "Room is full" }, { status: 400 });
        }
        if (getPlayer(room, playerName)) {
          return Response.json({ error: "Player already in room" }, { status: 400 });
        }

        room.players.push({ name: playerName });
        await this.ctx.storage.put("room", room);
        return Response.json(room);
      }
      case "/move": {
        const body = await parseJsonBody(request);
        const playerName = typeof body.playerName === "string" ? body.playerName.trim() : "";
        const move = typeof body.move === "string" ? body.move : "";
        if (!playerName || !isMove(move)) {
          return Response.json({ error: "playerName and a valid move are required" }, { status: 400 });
        }

        const player = getPlayer(room, playerName);
        if (!player) {
          return Response.json({ error: `Player ${playerName} not in room` }, { status: 400 });
        }
        if (room.status === "finished") {
          return Response.json({ error: "Room already finished" }, { status: 400 });
        }

        player.move = move;
        if (room.players.length === 2 && room.players.every((candidate: PlayerState) => !!candidate.move)) {
          const [playerOne, playerTwo] = room.players;
          const result = resolveRpsRound(playerOne.move!, playerTwo.move!);
          room.lastResult = result;
          room.status = "finished";
          if (result.winner === "player-one") {
            room.winner = playerOne.name;
          } else if (result.winner === "player-two") {
            room.winner = playerTwo.name;
          } else {
            room.winner = undefined;
          }
        }

        await this.ctx.storage.put("room", room);
        return Response.json(room);
      }
      case "/reset": {
        for (const player of room.players) {
          delete player.move;
        }
        room.status = "waiting";
        room.lastResult = undefined;
        room.winner = undefined;
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

    if (url.pathname === "/api/leaderboard") {
      if (!appEnv.DB) {
        return Response.json([]);
      }
      return Response.json(await getLeaderboardFromDb(appEnv.DB));
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await parseJsonBody(request);
      const name = typeof body.playerName === "string" ? body.playerName.trim() : "";
      if (!name) {
        return Response.json({ error: "Player name is required" }, { status: 400 });
      }

      const roomId = crypto.randomUUID();
      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(
        new Request("https://example.com/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerName: name }),
        })
      );

      const room = normalizeRoomForClient((await roomResponse.json()) as RoomState, roomId, name);
      return Response.json(room, { status: 201 });
    }

    if (url.pathname === "/api/rooms/join" && request.method === "POST") {
      const body = await parseJsonBody(request);
      const roomId = typeof body.roomId === "string" ? body.roomId : "";
      const name = typeof body.playerName === "string" ? body.playerName.trim() : "";
      if (!roomId || !name) {
        return Response.json({ error: "roomId and playerName are required" }, { status: 400 });
      }

      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(
        new Request("https://example.com/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerName: name }),
        })
      );
      const payload = await roomResponse.json();

      if (!roomResponse.ok) {
        return Response.json(payload, { status: roomResponse.status });
      }

      return Response.json(normalizeRoomForClient(payload as RoomState, roomId, name));
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
    if (roomMatch && request.method === "GET") {
      const roomId = roomMatch[1];
      const viewerName = new URL(request.url).searchParams.get("playerName") ?? undefined;
      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(new Request("https://example.com/"));
      const payload = await roomResponse.json();

      if (!roomResponse.ok) {
        return Response.json(payload, { status: roomResponse.status });
      }

      return Response.json(normalizeRoomForClient(payload as RoomState, roomId, viewerName));
    }

    const moveMatch = /^\/api\/rooms\/([^/]+)\/move$/.exec(url.pathname);
    if (moveMatch && request.method === "POST") {
      const roomId = moveMatch[1];
      const body = await parseJsonBody(request);
      const playerName = typeof body.playerName === "string" ? body.playerName.trim() : "";
      const move = typeof body.move === "string" ? body.move : "";
      if (!playerName || !isMove(move)) {
        return Response.json({ error: "playerName and a valid move are required" }, { status: 400 });
      }

      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(
        new Request("https://example.com/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerName, move }),
        })
      );

      const roomPayload = (await roomResponse.json()) as RoomState;
      if (roomPayload.status === "finished" && roomPayload.lastResult) {
        const [playerOne, playerTwo] = roomPayload.players;
        if (roomPayload.lastResult.winner === "player-one") {
          await recordMatchResult(
            {
              winnerName: playerOne.name,
              loserName: playerTwo.name,
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
              winnerMove: roomPayload.lastResult.playerTwoMove ?? "rock",
              loserMove: roomPayload.lastResult.playerOneMove ?? "rock",
            },
            appEnv.DB,
          );
        }
      }

      return Response.json(normalizeRoomForClient(roomPayload, roomId, playerName));
    }

    const resetMatch = /^\/api\/rooms\/([^/]+)\/reset$/.exec(url.pathname);
    if (resetMatch && request.method === "POST") {
      const roomId = resetMatch[1];
      const viewerName = new URL(request.url).searchParams.get("playerName") ?? undefined;
      const stub = appEnv.RPS_ROOMS.get(appEnv.RPS_ROOMS.idFromName(roomId));
      const roomResponse = await stub.fetch(new Request("https://example.com/reset", { method: "POST" }));
      const payload = await roomResponse.json();

      if (!roomResponse.ok) {
        return Response.json(payload, { status: roomResponse.status });
      }

      return Response.json(normalizeRoomForClient(payload as RoomState, roomId, viewerName));
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
