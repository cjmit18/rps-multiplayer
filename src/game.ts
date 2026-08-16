export type Move = "rock" | "paper" | "scissors";
export type RoomStatus = "waiting" | "finished";

export interface PlayerState {
  userId: string;
  name: string;
  move?: Move;
}

export interface RoomState {
  id: string;
  players: PlayerState[];
  status: RoomStatus;
  scores?: {
    playerOne: number;
    playerTwo: number;
  };
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

export function getPlayer(room: RoomState, userId: string): PlayerState | undefined {
  return room.players.find((player) => player.userId === userId);
}

export function normalizeRoomForClient(room: RoomState, roomId: string, viewerUserId?: string): RoomState {
  return {
    ...room,
    id: roomId,
    players: room.players.map((player) => {
      const isViewer = viewerUserId && player.userId === viewerUserId;
      return isViewer
        ? { ...player }
        : { userId: player.userId, name: player.name };
    }),
    lastResult: room.lastResult
      ? { winner: room.lastResult.winner }
      : undefined,
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
