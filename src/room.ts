import { type Move, type RoomState, getPlayer, resolveRpsRound } from "./game";

export const rooms = new Map<string, RoomState>();

export function createRoom(playerName: string): RoomState {
  const room: RoomState = {
    id: crypto.randomUUID(),
    players: [{ name: playerName }],
    status: "waiting",
  };

  rooms.set(room.id, room);
  return room;
}

export function joinRoom(roomId: string, playerName: string): RoomState {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} not found`);
  }

  if (room.players.length >= 2) {
    throw new Error("Room is full");
  }

  if (getPlayer(room, playerName)) {
    throw new Error("Player already in room");
  }

  room.players.push({ name: playerName });
  return room;
}

export function submitMove(roomId: string, playerName: string, move: Move): RoomState {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} not found`);
  }

  const player = getPlayer(room, playerName);
  if (!player) {
    throw new Error(`Player ${playerName} not in room`);
  }

  if (room.status === "finished") {
    throw new Error("Room already finished");
  }

  player.move = move;

  if (room.players.length < 2 || room.players.some((candidate) => !candidate.move)) {
    return room;
  }

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

  return room;
}

export function resetRoom(roomId: string): RoomState {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} not found`);
  }

  for (const player of room.players) {
    delete player.move;
  }
  room.status = "waiting";
  room.lastResult = undefined;
  room.winner = undefined;
  return room;
}

export { getPlayer } from "./game";
