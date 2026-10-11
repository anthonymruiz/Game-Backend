import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameInstance } from '../game/engine/game-instance.js';
import { Board } from '../game/engine/board.js';
import { Player, Wall } from '../game/engine/models.js';
import { FfaRules } from '../game/engine/game-modes.js';
import { IRoomPlayer } from '../services/room.service.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

function createTestFfaPlayers(count: number, humanCount: number = count): IRoomPlayer[] {
  const colors = ['#FF3B30', '#007AFF', '#34C759', '#FFCC00', '#AF52DE', '#F97316'];
  return Array.from({ length: count }, (_, index) => ({
    id: index < humanCount ? `user_ffa_${index}` : `bot_ffa_${index}`,
    username: index < humanCount ? `Human ${index + 1}` : `BOT ${index + 1}`,
    isGuest: index >= humanCount,
    color: colors[index % colors.length]
  }));
}

function clearBoardBoosts(board: Board): void {
  board.boosts = [];
  board.grid.forEach(row => row.forEach(cell => {
    cell.hasBoost = null;
  }));
}

describe('15 - FFA Mode Comprehensive Rules, Combinations (4, 5, 6 Players) & Gameplay Tests', () => {

  // =========================================================================
  // 1. BOARD INITIALIZATION & SPAWN CONFIGURATIONS (4, 5, 6 PLAYERS)
  // =========================================================================
  describe('1.1 FFA Initialization & Spawns (4, 5, 6 Players)', () => {
    const ffaRules = new FfaRules();

    it('FfaRules defines 11x11 board, 6 max players, 7 walls per player, and center goal (5,5)', () => {
      assert.equal(ffaRules.mode, 'FFA');
      assert.equal(ffaRules.boardSize, 11);
      assert.equal(ffaRules.maxPlayers, 6);
      assert.equal(ffaRules.wallsPerPlayer, 7);
      assert.equal(ffaRules.isTeamMode, false);
    });

    it('3-Player FFA spawns on 3 distinct cardinal perimeter borders with goal at center (5,5)', () => {
      const players = createTestFfaPlayers(3);
      const game = new GameInstance('ffa_init_3', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.board.size, 11);
        assert.equal(game.board.players.size, 3);

        const p0 = game.board.players.get('user_ffa_0')!;
        const p1 = game.board.players.get('user_ffa_1')!;
        const p2 = game.board.players.get('user_ffa_2')!;

        assert.deepEqual({ x: p0.x, y: p0.y }, { x: 5, y: 10 }, 'Player 0 at Bottom');
        assert.deepEqual({ x: p1.x, y: p1.y }, { x: 5, y: 0 }, 'Player 1 at Top');
        assert.deepEqual({ x: p2.x, y: p2.y }, { x: 0, y: 5 }, 'Player 2 at Left');
      } finally {
        game.destroy();
      }
    });

    it('4-Player FFA spawns on 4 cardinal perimeter borders with goal at center (5,5)', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_init_4', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.board.size, 11);
        assert.equal(game.board.players.size, 4);

        const p0 = game.board.players.get('user_ffa_0')!;
        const p1 = game.board.players.get('user_ffa_1')!;
        const p2 = game.board.players.get('user_ffa_2')!;
        const p3 = game.board.players.get('user_ffa_3')!;

        // Cardinal spawns
        assert.deepEqual({ x: p0.x, y: p0.y }, { x: 5, y: 10 }, 'Player 0 at Bottom');
        assert.deepEqual({ x: p1.x, y: p1.y }, { x: 5, y: 0 }, 'Player 1 at Top');
        assert.deepEqual({ x: p2.x, y: p2.y }, { x: 0, y: 5 }, 'Player 2 at Left');
        assert.deepEqual({ x: p3.x, y: p3.y }, { x: 10, y: 5 }, 'Player 3 at Right');

        // All target center (5,5)
        for (const p of [p0, p1, p2, p3]) {
          assert.equal(p.targetX, 5);
          assert.equal(p.targetY, 5);
          assert.equal(p.wallsLeft, 7, 'Each player starts with exactly 7 walls');
          assert.equal(p.isDead, false);
          assert.equal(p.hasReachedGoal, false);
        }
      } finally {
        game.destroy();
      }
    });

    it('5-Player FFA spawns 5 unique border positions with goal at center (5,5)', () => {
      const players = createTestFfaPlayers(5);
      const game = new GameInstance('ffa_init_5', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.board.players.size, 5);
        const positions = new Set<string>();

        for (const p of game.board.players.values()) {
          const key = `${p.x},${p.y}`;
          assert.ok(!positions.has(key), `Position ${key} must be unique`);
          positions.add(key);

          // Must be on perimeter (x is 0/10 or y is 0/10)
          assert.ok(p.x === 0 || p.x === 10 || p.y === 0 || p.y === 10, `Player must spawn on perimeter: ${key}`);
          assert.equal(p.targetX, 5);
          assert.equal(p.targetY, 5);
          assert.equal(p.wallsLeft, 7);
        }
      } finally {
        game.destroy();
      }
    });

    it('6-Player FFA spawns 6 unique border positions with goal at center (5,5)', () => {
      const players = createTestFfaPlayers(6);
      const game = new GameInstance('ffa_init_6', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.board.players.size, 6);
        const positions = new Set<string>();

        for (const p of game.board.players.values()) {
          const key = `${p.x},${p.y}`;
          assert.ok(!positions.has(key), `Position ${key} must be unique`);
          positions.add(key);

          assert.ok(p.x === 0 || p.x === 10 || p.y === 0 || p.y === 10, `Player must spawn on perimeter: ${key}`);
          assert.equal(p.targetX, 5);
          assert.equal(p.targetY, 5);
          assert.equal(p.wallsLeft, 7);
        }
      } finally {
        game.destroy();
      }
    });
  });

  // =========================================================================
  // 2. TURN SEQUENCING & TURN ADVANCEMENT (4, 5, 6 PLAYERS)
  // =========================================================================
  describe('1.2 FFA Turn Sequencing & Skipping Dead Players', () => {

    it('4-Player FFA rotates turns cyclically across all 4 players', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_turns_4', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.getCurrentPlayer(), 'user_ffa_0');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_1');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_2');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_3');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_0', 'Rotates back to player 0');
      } finally {
        game.destroy();
      }
    });

    it('5-Player FFA rotates turns cyclically across all 5 players', () => {
      const players = createTestFfaPlayers(5);
      const game = new GameInstance('ffa_turns_5', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.getCurrentPlayer(), 'user_ffa_0');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_1');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_2');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_3');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_4');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_0');
      } finally {
        game.destroy();
      }
    });

    it('6-Player FFA skips eliminated / dead players during turn transitions', () => {
      const players = createTestFfaPlayers(6);
      const game = new GameInstance('ffa_turns_6', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        // Mark players 1 and 3 as dead
        game.board.players.get('user_ffa_1')!.isDead = true;
        game.board.players.get('user_ffa_3')!.isDead = true;

        assert.equal(game.getCurrentPlayer(), 'user_ffa_0');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_2', 'Skips dead player 1');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_4', 'Skips dead player 3');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_5');
        game.nextTurn();
        assert.equal(game.getCurrentPlayer(), 'user_ffa_0');
      } finally {
        game.destroy();
      }
    });
  });

  // =========================================================================
  // 3. WINNING BY REACHING CENTER GOAL (4, 5, 6 PLAYERS)
  // =========================================================================
  describe('1.3 FFA Win Conditions - Reaching Goal Cell (5,5)', () => {

    it('4-Player FFA: Player wins immediately upon stepping into center cell (5,5)', () => {
      const players = createTestFfaPlayers(4);
      let finishedData: any = null;
      const game = new GameInstance('ffa_win_4', 'FFA', players, (event, data) => {
        if (event === 'gameFinished') finishedData = data;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const p0 = game.board.players.get('user_ffa_0')!;
        game.board.grid[p0.y][p0.x].hasPlayer = null;
        p0.x = 5;
        p0.y = 6; // 1 step south of center
        game.board.grid[6][5].hasPlayer = p0.id;

        // Player 0 moves into (5,5)
        const moved = game.executeMove('user_ffa_0', 5, 5);
        assert.equal(moved, true);
        assert.equal(p0.hasReachedGoal, true);
        assert.equal(game.state, 'finished');
        assert.equal(game.winner, 'user_ffa_0');
        assert.equal(finishedData?.winner, 'user_ffa_0');
        assert.equal(finishedData?.abandoned, false);
      } finally {
        game.destroy();
      }
    });

    it('5-Player FFA: Player 3 wins immediately upon reaching (5,5)', () => {
      const players = createTestFfaPlayers(5);
      let finishWinner: string | null = null;
      const game = new GameInstance('ffa_win_5', 'FFA', players, (event, data) => {
        if (event === 'gameFinished') finishWinner = data.winner;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        game.currentTurnIndex = 3;
        const p3 = game.board.players.get('user_ffa_3')!;
        game.board.grid[p3.y][p3.x].hasPlayer = null;
        p3.x = 6;
        p3.y = 5; // 1 step east of center
        game.board.grid[5][6].hasPlayer = p3.id;

        const moved = game.executeMove('user_ffa_3', 5, 5);
        assert.equal(moved, true);
        assert.equal(p3.hasReachedGoal, true);
        assert.equal(game.state, 'finished');
        assert.equal(game.winner, 'user_ffa_3');
        assert.equal(finishWinner, 'user_ffa_3');
      } finally {
        game.destroy();
      }
    });

    it('6-Player FFA: Player 5 wins immediately upon reaching (5,5)', () => {
      const players = createTestFfaPlayers(6);
      let finishWinner: string | null = null;
      const game = new GameInstance('ffa_win_6', 'FFA', players, (event, data) => {
        if (event === 'gameFinished') finishWinner = data.winner;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        game.currentTurnIndex = 5;
        const p5 = game.board.players.get('user_ffa_5')!;
        game.board.grid[p5.y][p5.x].hasPlayer = null;
        p5.x = 5;
        p5.y = 4; // 1 step north of center
        game.board.grid[4][5].hasPlayer = p5.id;

        const moved = game.executeMove('user_ffa_5', 5, 5);
        assert.equal(moved, true);
        assert.equal(p5.hasReachedGoal, true);
        assert.equal(game.state, 'finished');
        assert.equal(game.winner, 'user_ffa_5');
        assert.equal(finishWinner, 'user_ffa_5');
      } finally {
        game.destroy();
      }
    });
  });

  // =========================================================================
  // 4. SURRENDER & ELIMINATION COMBINATIONS (4, 5, 6 PLAYERS)
  // =========================================================================
  describe('1.4 FFA Surrenders, Eliminations & Last Survivor Wins', () => {

    it('4-Player FFA: Surrender marks player dead and advances turn if active', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_surrender_turn_advance', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        const p0 = game.board.players.get('user_ffa_0')!;

        // Player 0 surrenders on their turn
        assert.equal(game.surrender('user_ffa_0'), true);
        assert.equal(p0.isDead, true);
        assert.equal(game.state, 'playing', 'Match continues with 3 alive players');
        assert.equal(game.getCurrentPlayer(), 'user_ffa_1', 'Turn automatically shifted to next alive player');
      } finally {
        game.destroy();
      }
    });

    it('5-Player FFA: Sequential surrenders until last survivor triggers victory', () => {
      const players = createTestFfaPlayers(5);
      let finishWinner: string | null = null;
      const game = new GameInstance('ffa_surrender_5_last_man', 'FFA', players, (event, data) => {
        if (event === 'gameFinished') finishWinner = data.winner;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.surrender('user_ffa_0'), true);
        assert.equal(game.state, 'playing');

        assert.equal(game.surrender('user_ffa_1'), true);
        assert.equal(game.state, 'playing');

        assert.equal(game.surrender('user_ffa_2'), true);
        assert.equal(game.state, 'playing');

        // 4th surrender leaves user_ffa_4 as the sole survivor
        assert.equal(game.surrender('user_ffa_3'), true);
        assert.equal(game.state, 'finished');
        assert.equal(game.winner, 'user_ffa_4');
        assert.equal(finishWinner, 'user_ffa_4');
      } finally {
        game.destroy();
      }
    });

    it('6-Player FFA: 5 surrenders declare the 6th player winner', () => {
      const players = createTestFfaPlayers(6);
      let finishWinner: string | null = null;
      const game = new GameInstance('ffa_surrender_6_last_man', 'FFA', players, (event, data) => {
        if (event === 'gameFinished') finishWinner = data.winner;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        for (let i = 0; i < 5; i++) {
          assert.equal(game.surrender(`user_ffa_${i}`), true);
          if (i < 4) {
            assert.equal(game.state, 'playing');
          }
        }

        assert.equal(game.state, 'finished');
        assert.equal(game.winner, 'user_ffa_5');
        assert.equal(finishWinner, 'user_ffa_5');
      } finally {
        game.destroy();
      }
    });

    it('FFA with 1 Human and 3 Bots: Human surrender abandons game', () => {
      const players = createTestFfaPlayers(4, 1); // 1 human, 3 bots
      let finishData: any = null;
      const game = new GameInstance('ffa_human_bot_abandon', 'FFA', players, (event, data) => {
        if (event === 'gameFinished') finishData = data;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.surrender('user_ffa_0'), true);
        assert.equal(game.state, 'finished');
        assert.equal(finishData?.abandoned, true);
        assert.equal(finishData?.winner, null);
      } finally {
        game.destroy();
      }
    });

    it('FFA with 2 Humans and 3 Bots: 1 Human surrender keeps game running for remaining human', () => {
      const players = createTestFfaPlayers(5, 2); // 2 humans, 3 bots
      const game = new GameInstance('ffa_2humans_3bots', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        assert.equal(game.surrender('user_ffa_0'), true);
        assert.equal(game.state, 'playing', 'Game continues because user_ffa_1 is still alive');

        // Human 2 surrenders -> only bots left -> abandoned
        assert.equal(game.surrender('user_ffa_1'), true);
        assert.equal(game.state, 'finished');
        assert.equal(game.winner, null);
      } finally {
        game.destroy();
      }
    });
  });

  // =========================================================================
  // 5. JUMPING OVER OPPONENTS & DIAGONAL JUMPS (FFA)
  // =========================================================================
  describe('1.5 FFA Pawn Jumping Mechanics', () => {

    it('FFA pawn jumps straight over an adjacent opponent', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_jump_straight', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const board = game.board;
        const p0 = board.players.get('user_ffa_0')!;
        const p1 = board.players.get('user_ffa_1')!;

        // Place p0 at (5, 7) and p1 at (5, 6)
        board.grid[p0.y][p0.x].hasPlayer = null;
        board.grid[p1.y][p1.x].hasPlayer = null;
        p0.x = 5; p0.y = 7; board.grid[7][5].hasPlayer = p0.id;
        p1.x = 5; p1.y = 6; board.grid[6][5].hasPlayer = p1.id;

        const validMoves = board.getValidMoves('user_ffa_0');
        // p0 should be able to jump over p1 to (5, 5)
        assert.ok(validMoves.some(m => m.x === 5 && m.y === 5), 'Straight jump over opponent to (5,5) must be valid');
        assert.equal(game.executeMove('user_ffa_0', 5, 5), true);
        assert.deepEqual({ x: p0.x, y: p0.y }, { x: 5, y: 5 });
      } finally {
        game.destroy();
      }
    });

    it('FFA pawn performs diagonal jump when cell behind opponent is blocked by a horizontal wall', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_jump_diagonal', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const board = game.board;
        const p0 = board.players.get('user_ffa_0')!;
        const p1 = board.players.get('user_ffa_1')!;

        board.grid[p0.y][p0.x].hasPlayer = null;
        board.grid[p1.y][p1.x].hasPlayer = null;
        p0.x = 5; p0.y = 6; board.grid[6][5].hasPlayer = p0.id;
        p1.x = 5; p1.y = 5; board.grid[5][5].hasPlayer = p1.id;

        // Place wall above p1 blocking (5,4)
        board.placeWall(new Wall('w_block_jump', 'user_ffa_2', 5, 4, true));

        const validMoves = board.getValidMoves('user_ffa_0');
        // Straight jump to (5,4) is blocked; diagonal jumps to (4,5) and (6,5) must be valid
        assert.ok(!validMoves.some(m => m.x === 5 && m.y === 4), 'Straight jump blocked');
        assert.ok(validMoves.some(m => m.x === 4 && m.y === 5), 'Diagonal jump left (4,5)');
        assert.ok(validMoves.some(m => m.x === 6 && m.y === 5), 'Diagonal jump right (6,5)');

        assert.equal(game.executeMove('user_ffa_0', 4, 5), true);
        assert.deepEqual({ x: p0.x, y: p0.y }, { x: 4, y: 5 });
      } finally {
        game.destroy();
      }
    });
  });

  // =========================================================================
  // 6. SPECIAL BOOST INTERACTIONS (KILLER, EXCHANGE, EXTRA WALL, GHOST)
  // =========================================================================
  describe('1.6 FFA Special Item Boosts & Lifecycle', () => {

    it('Extra Wall boost increments player walls in FFA up to max limit', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_extra_wall', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const p0 = game.board.players.get('user_ffa_0')!;
        p0.wallsLeft = 5;

        // Spawn extra wall boost at (5, 9)
        game.board.grid[9][5].hasBoost = 'boost_extra_wall';
        game.board.boosts.push({ id: 'boost_extra_wall', type: 'extra_wall', x: 5, y: 9 });

        assert.equal(game.executeMove('user_ffa_0', 5, 9), true);
        assert.equal(p0.wallsLeft, 6, 'Walls incremented by 1');
      } finally {
        game.destroy();
      }
    });

    it('Killer Item in 6-Player FFA eliminates targeted player, skips turn, and continues match', () => {
      const players = createTestFfaPlayers(6);
      const game = new GameInstance('ffa_killer_6p', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const p0 = game.board.players.get('user_ffa_0')!;
        const target = game.board.players.get('user_ffa_3')!;
        const validMoves = game.board.getValidMoves('user_ffa_0');
        const targetMove = validMoves[0];

        // Spawn killer boost at adjacent cell
        const killerBoost = { id: 'killer_boost_6p', type: 'killer_item' as const, x: targetMove.x, y: targetMove.y };
        game.board.boosts.push(killerBoost);
        game.board.grid[targetMove.y][targetMove.x].hasBoost = killerBoost.id;

        assert.equal(game.executeMove('user_ffa_0', targetMove.x, targetMove.y), true);
        assert.equal(p0.hasKillerItem, true);

        // Execute killer selection targeting player 3
        assert.equal(game.executeKillerItem('user_ffa_0', target.id), true);
        assert.equal(target.isDead, true, 'Target player is eliminated');
        assert.equal(game.board.grid[target.y][target.x].hasPlayer, null, 'Target cell cleared');
        assert.equal(game.state, 'playing', '5 alive players remain');
        assert.equal(game.getCurrentPlayer(), 'user_ffa_1', 'Turn passed to player 1');
      } finally {
        game.destroy();
      }
    });

    it('Killer Item in 4-Player FFA with 2 survivors declares last player winner immediately', () => {
      const players = createTestFfaPlayers(4);
      let finishWinner: string | null = null;
      const game = new GameInstance('ffa_killer_final_win', 'FFA', players, (event, data) => {
        if (event === 'gameFinished') finishWinner = data.winner;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const p0 = game.board.players.get('user_ffa_0')!;
        const p3 = game.board.players.get('user_ffa_3')!;

        // Kill players 1 and 2 beforehand
        game.board.players.get('user_ffa_1')!.isDead = true;
        game.board.players.get('user_ffa_2')!.isDead = true;

        // Player 0 steps on killer boost at (5, 9)
        const killerBoost = { id: 'killer_boost_win', type: 'killer_item' as const, x: 5, y: 9 };
        game.board.boosts.push(killerBoost);
        game.board.grid[9][5].hasBoost = killerBoost.id;

        assert.equal(game.executeMove('user_ffa_0', 5, 9), true);
        assert.equal(p0.hasKillerItem, true);

        assert.equal(game.executeKillerItem('user_ffa_0', p3.id), true);
        assert.equal(p3.isDead, true);
        assert.equal(game.state, 'finished');
        assert.equal(game.winner, 'user_ffa_0');
        assert.equal(finishWinner, 'user_ffa_0');
      } finally {
        game.destroy();
      }
    });

    it('Exchange Item in 5-Player FFA swaps coordinates with chosen opponent', () => {
      const players = createTestFfaPlayers(5);
      const game = new GameInstance('ffa_exchange_5p', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const p0 = game.board.players.get('user_ffa_0')!;
        const p4 = game.board.players.get('user_ffa_4')!;
        const p4OriginalPos = { x: p4.x, y: p4.y };
        const validMoves = game.board.getValidMoves('user_ffa_0');
        const targetMove = validMoves[0];

        const exchangeBoost = { id: 'exchange_boost_5p', type: 'exchange_item' as const, x: targetMove.x, y: targetMove.y };
        game.board.boosts.push(exchangeBoost);
        game.board.grid[targetMove.y][targetMove.x].hasBoost = exchangeBoost.id;

        assert.equal(game.executeMove('user_ffa_0', targetMove.x, targetMove.y), true);
        assert.equal(p0.hasExchangeItem, true);

        // Swap with player 4
        assert.equal(game.executeExchangeItem('user_ffa_0', p4.id), true);

        assert.deepEqual({ x: p0.x, y: p0.y }, p4OriginalPos, 'Player 0 is at Player 4 original position');
        assert.deepEqual({ x: p4.x, y: p4.y }, { x: targetMove.x, y: targetMove.y }, 'Player 4 is at Player 0 position');
        assert.equal(game.board.grid[p4OriginalPos.y][p4OriginalPos.x].hasPlayer, p0.id);
        assert.equal(game.board.grid[targetMove.y][targetMove.x].hasPlayer, p4.id);
      } finally {
        game.destroy();
      }
    });

    it('Ghost Boost allows stepping through walls for 3 turns in FFA', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_ghost_mode', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        clearBoardBoosts(game.board);
        const board = game.board;
        const p0 = board.players.get('user_ffa_0')!;

        // Place wall right in front of p0
        board.placeWall(new Wall('w_ghost_test', 'user_ffa_1', 5, 9, true));

        // Normal move into (5,9) is blocked
        assert.ok(!board.getValidMoves('user_ffa_0').some(m => m.x === 5 && m.y === 9));

        // Activate ghost boost
        p0.ghostTurnsRemaining = 3;

        // With ghost, move into (5,9) is allowed
        assert.ok(board.getValidMoves('user_ffa_0').some(m => m.x === 5 && m.y === 9));
        assert.equal(game.executeMove('user_ffa_0', 5, 9), true);
        assert.equal(p0.ghostTurnsRemaining, 2, 'Ghost turn consumed');
      } finally {
        game.destroy();
      }
    });
  });

  // =========================================================================
  // 7. WALL VALIDATION & PATH BLOCKING (4, 5, 6 PLAYERS)
  // =========================================================================
  describe('1.7 FFA Wall Limits & Total Path Blocking Prevention', () => {

    it('Player cannot place more than 7 walls in FFA', () => {
      const players = createTestFfaPlayers(4);
      const game = new GameInstance('ffa_wall_limit', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      try {
        const p0 = game.board.players.get('user_ffa_0')!;
        p0.wallsLeft = 0;

        assert.equal(game.executeWall('user_ffa_0', 'w_over_limit', 1, 1, true), false);
        assert.equal(game.board.walls.length, 0);
      } finally {
        game.destroy();
      }
    });

    it('Wall placement is rejected if it completely seals the center goal for ANY player in 4, 5, 6 FFA', () => {
      for (const count of [4, 5, 6] as const) {
        const players = createTestFfaPlayers(count);
        const game = new GameInstance(`ffa_block_check_${count}`, 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
        game.start();

        try {
          const board = game.board;

          // Build a box around center (5,5)
          board.placeWall(new Wall('box_top_1', 'user_ffa_1', 4, 4, true));
          board.placeWall(new Wall('box_top_2', 'user_ffa_1', 5, 4, true));
          board.placeWall(new Wall('box_bot_1', 'user_ffa_1', 4, 5, true));
          board.placeWall(new Wall('box_bot_2', 'user_ffa_1', 5, 5, true));
          board.placeWall(new Wall('box_left_1', 'user_ffa_1', 4, 4, false));
          board.placeWall(new Wall('box_left_2', 'user_ffa_1', 4, 5, false));
          board.placeWall(new Wall('box_right_1', 'user_ffa_1', 5, 4, false));

          // Placing the final wall closing the box must be rejected by executeWall
          const allowed = game.executeWall('user_ffa_0', 'box_seal', 5, 5, false);
          assert.equal(allowed, false, `${count}-Player FFA: Sealing the goal must be illegal`);
        } finally {
          game.destroy();
        }
      }
    });
  });
});
