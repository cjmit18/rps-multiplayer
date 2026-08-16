import { type Move, type RoomState, getPlayer, resolveRpsRound } from "./game";

export const rooms = new Map<string, RoomState>();

export function createRoom(playerName: string): RoomState {
  const room: RoomState = {
    id: crypto.randomUUID(),
    players: [{ userId: crypto.randomUUID(), name: playerName }],
    status: "waiting",
    scores: { playerOne: 0, playerTwo: 0 },
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

  if (room.players.some((player) => player.name.toLowerCase() === playerName.toLowerCase())) {
    throw new Error("Player already in room");
  }

  room.players.push({ userId: crypto.randomUUID(), name: playerName });
  return room;
}

export function submitMove(roomId: string, playerName: string, move: Move): RoomState {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error(`Room ${roomId} not found`);
  }

  const player = getPlayer(room, playerName) ?? room.players.find((candidate) => candidate.name.toLowerCase() === playerName.toLowerCase());
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

  if (result.winner === "player-one") {
    room.scores = room.scores ?? { playerOne: 0, playerTwo: 0 };
    room.scores.playerOne += 1;
  } else if (result.winner === "player-two") {
    room.scores = room.scores ?? { playerOne: 0, playerTwo: 0 };
    room.scores.playerTwo += 1;
  }

  delete playerOne.move;
  delete playerTwo.move;
  const scores = room.scores ?? { playerOne: 0, playerTwo: 0 };
  room.scores = scores;
  if (scores.playerOne >= 2 || scores.playerTwo >= 2) {
    room.status = "finished";
    room.winner = scores.playerOne >= 2 ? playerOne.name : playerTwo.name;
  } else {
    room.status = "waiting";
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
  room.scores = { playerOne: 0, playerTwo: 0 };
  return room;
}

export { getPlayer } from "./game";
