export type Move = "rock" | "paper" | "scissors";
export type RoomStatus = "waiting" | "finished";

export interface PlayerState {
  name: string;
  move?: Move;
}

export interface RoomState {
  id: string;
  players: PlayerState[];
  status: RoomStatus;
  winner?: string;
  lastResult?: {
    winner: "player-one" | "player-two" | "draw";
    playerOneMove?: Move;
    playerTwoMove?: Move;
  };
}

export const WIN_MAP: Record<Move, Move> = {
  rock: "scissors",
  paper: "rock",
  scissors: "paper",
};

export function isMove(value: unknown): value is Move {
  return value === "rock" || value === "paper" || value === "scissors";
}

export function getPlayer(room: RoomState, playerName: string): PlayerState | undefined {
  return room.players.find((player) => player.name.toLowerCase() === playerName.toLowerCase());
}

export function normalizeRoomForClient(room: RoomState, roomId: string): RoomState {
  return {
    ...room,
    id: roomId,
  };
}

export function resolveRpsRound(playerOneMove: Move, playerTwoMove: Move): {
  winner: "player-one" | "player-two" | "draw";
  playerOneMove?: Move;
  playerTwoMove?: Move;
} {
  if (playerOneMove === playerTwoMove) {
    return {
      winner: "draw",
      playerOneMove,
      playerTwoMove,
    };
  }

  if (WIN_MAP[playerOneMove] === playerTwoMove) {
    return {
      winner: "player-one",
      playerOneMove,
      playerTwoMove,
    };
  }

  return {
    winner: "player-two",
    playerOneMove,
    playerTwoMove,
  };
}
