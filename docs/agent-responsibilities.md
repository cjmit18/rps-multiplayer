# Agent responsibilities

This project is better managed when each area has a clear ownership boundary.

## Game engine agent
- Resolves Rock Paper Scissors outcomes
- Maintains move validation rules
- Handles round reset and winner assignment
- Keeps rules and edge cases covered by tests

## Room service agent
- Creates and joins multiplayer rooms
- Validates room state transitions
- Maintains Durable Object behavior
- Handles request/response contracts for room APIs

## Leaderboard agent
- Maintains D1 schema and leaderboard query logic
- Records match results after each round
- Keeps leaderboards sorted and consistent
- Handles fallback behavior when database bindings are missing

## UI/experience agent
- Owns layout, styling, and interactions
- Keeps responsive behavior polished
- Improves user feedback and status messaging
- Implements front-end performance and UX refinements

## Shared rules for all agents
- Keep logic isolated from UI concerns
- Add tests for any behavior change
- Prefer small, reviewable modules over large files
- Document interfaces before broad refactors
