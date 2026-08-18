export type Move = "rock" | "paper" | "scissors";
export type RoomStatus = "waiting" | "finished";
export type Difficulty = "easy" | "medium" | "hard";

export interface PlayerState {
  userId: string;
  name: string;
  move?: Move;
  isBot?: boolean;
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
  difficulty?: Difficulty;
  // Human player's move history against the bot, used by medium/hard to predict the next move.
  moveHistory?: Move[];
}

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

// Maps each move to the move it beats (rock beats scissors, etc.).
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
    // Never expose the human's move history to the client; it's only used server-side for bot prediction.
    moveHistory: undefined,
    // Only the viewer's own pending move is revealed; the opponent's move is hidden until both have moved.
    players: room.players.map((player) => {
      const isViewer = viewerUserId && player.userId === viewerUserId;
      return isViewer
        ? { ...player }
        : { userId: player.userId, name: player.name, isBot: player.isBot };
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

const MOVES: Move[] = ["rock", "paper", "scissors"];

function randomMove(): Move {
  return MOVES[crypto.getRandomValues(new Uint32Array(1))[0] % MOVES.length];
}

// Finds the move that beats `move` (the inverse of WIN_MAP).
function counterMove(move: Move): Move {
  return MOVES.find((candidate) => WIN_MAP[candidate] === move) ?? randomMove();
}

function mostFrequentMove(history: Move[]): Move | undefined {
  if (history.length === 0) return undefined;
  const counts: Record<Move, number> = { rock: 0, paper: 0, scissors: 0 };
  for (const move of history) counts[move] += 1;
  return MOVES.reduce((best, candidate) => (counts[candidate] > counts[best] ? candidate : best), MOVES[0]);
}

// Predicts the human's next move as whatever they most often played right after their last move.
function predictNextMove(history: Move[]): Move | undefined {
  if (history.length < 2) return undefined;
  const lastMove = history[history.length - 1];
  const followUps: Move[] = [];
  for (let index = 0; index < history.length - 1; index += 1) {
    if (history[index] === lastMove) followUps.push(history[index + 1]);
  }
  return mostFrequentMove(followUps);
}

export function getBotMove(difficulty: Difficulty, history: Move[] = []): Move {
  if (difficulty === "easy") return randomMove();

  if (difficulty === "medium") {
    const frequent = mostFrequentMove(history);
    // Sometimes counters the player's favorite move; otherwise stays random and beatable.
    return frequent && Math.random() < 0.4 ? counterMove(frequent) : randomMove();
  }

  const predicted = predictNextMove(history) ?? mostFrequentMove(history);
  return predicted ? counterMove(predicted) : randomMove();
}
