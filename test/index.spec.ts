import { describe, expect, it } from "vitest";
import {
	createRoom,
	joinRoom,
	normalizeRoomForClient,
	resetRoom,
	resolveRpsRound,
	submitMove,
	recordMatchResult,
} from "../src";

describe("RPS game logic", () => {
	it("resolves a rock vs scissors round in favor of rock", () => {
		expect(resolveRpsRound("rock", "scissors")).toMatchObject({
			winner: "player-one",
		});
		expect(resolveRpsRound("scissors", "rock")).toMatchObject({
			winner: "player-two",
		});
	});

	it("handles a draw when both players pick the same move", () => {
		expect(resolveRpsRound("paper", "paper")).toMatchObject({
			winner: "draw",
		});
	});
});

describe("RPS room flow", () => {
	it("plays a best-of-three match and resolves after one player wins twice", () => {
		const room = createRoom("alice");
		const joined = joinRoom(room.id, "bob");
		expect(joined.players).toHaveLength(2);

		submitMove(room.id, "alice", "rock");
		const firstRound = submitMove(room.id, "bob", "scissors");
		expect(firstRound.status).toBe("waiting");
		expect(firstRound.scores).toEqual({ playerOne: 1, playerTwo: 0 });

		submitMove(room.id, "alice", "paper");
		const finalRoom = submitMove(room.id, "bob", "rock");

		expect(finalRoom.status).toBe("finished");
		expect(finalRoom.winner).toBe("alice");
		expect(finalRoom.scores).toEqual({ playerOne: 2, playerTwo: 0 });
		expect(finalRoom.lastResult).toMatchObject({
			winner: "player-one",
		});
	});
});

describe("room API normalization", () => {
	it("keeps the client room id aligned with the durable object lookup key", () => {
		const room = normalizeRoomForClient(
			{
				id: "durable-object-room-id",
				players: [{ userId: "alice-id", name: "alice" }, { userId: "bob-id", name: "bob" }],
				status: "waiting",
			},
			"lookup-room-id"
		);

		expect(room.id).toBe("lookup-room-id");
		expect(room.players).toHaveLength(2);
	});

	it("hides the other player's move from a waiting player", () => {
		const room = normalizeRoomForClient(
			{
				id: "room-id",
				players: [{ userId: "alice-id", name: "alice", move: "rock" }, { userId: "bob-id", name: "bob", move: "scissors" }],
				status: "waiting",
			},
			"room-id",
			"alice"
		);

		expect(room.players).toEqual([{ name: "alice", move: "rock" }, { name: "bob" }]);
	});

	it("keeps the other player's move hidden after the round finishes", () => {
		const room = normalizeRoomForClient(
			{
				id: "room-id",
				players: [{ userId: "alice-id", name: "alice", move: "rock" }, { userId: "bob-id", name: "bob", move: "scissors" }],
				status: "finished",
				lastResult: { winner: "player-one", playerOneMove: "rock", playerTwoMove: "scissors" },
			},
			"room-id",
			"alice"
		);

		expect(room.players).toEqual([{ name: "alice", move: "rock" }, { name: "bob" }]);
		expect(room.lastResult).toEqual({ winner: "player-one" });
	});
});

describe("room reset flow", () => {
	it("clears moves and lets players play another round in the same room", () => {
		const room = createRoom("alice");
		joinRoom(room.id, "bob");
		submitMove(room.id, "alice", "rock");
		submitMove(room.id, "bob", "scissors");

		const reset = resetRoom(room.id);

		expect(reset.status).toBe("waiting");
		expect(reset.lastResult).toBeUndefined();
		expect(reset.winner).toBeUndefined();
		expect(reset.scores).toEqual({ playerOne: 0, playerTwo: 0 });
		expect(reset.players).toHaveLength(2);
		expect(reset.players.every((player) => !player.move)).toBe(true);
	});
});

describe("leaderboard updates", () => {
	it("increments win and loss counters after a completed match", () => {
		const leaderboard = recordMatchResult({
			winnerUserId: "alice-id",
			loserUserId: "bob-id",
			winnerName: "alice",
			loserName: "bob",
			winnerMove: "rock",
			loserMove: "scissors",
		});

		expect(leaderboard).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "alice", wins: 1, losses: 0, ties: 0 }),
				expect.objectContaining({ name: "bob", wins: 0, losses: 1, ties: 0 }),
			])
		);
	});
});
