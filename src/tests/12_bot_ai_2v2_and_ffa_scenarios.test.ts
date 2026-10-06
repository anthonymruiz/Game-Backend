import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { RoomService } from '../services/room.service.js';
import { Board } from '../game/engine/board.js';
import { Boost, Player, Wall } from '../game/engine/models.js';
import {
  BOOST_MAX_DELAY_MS,
  BOOST_MIN_DELAY_MS,
  GameInstance,
  getRandomBoostDelayMs
} from '../game/engine/game-instance.js';
import { container } from 'tsyringe';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

describe('12 - 2v2 & FFA Bot AI Scenarios & Rules Tests', () => {
  let roomService: RoomService;

  it('Setup test environment', async () => {
    await setupTestEnvironment();
    roomService = container.resolve(RoomService);
  });

  // 1. 2v2 Color, Team and Slot Rules
  it('2v2 Room should limit colors to 2 players per color and auto-assign teams', () => {
    const room = roomService.createRoom('h1', 'HostHuman', false, '2v2 Arena', '2v2');
    assert.equal(room.players[0].color, '#FF3B30'); // Red
    assert.equal(room.players[0].team, 1);

    // Player 2 joins -> auto assigned Blue (Team 2)
    roomService.joinRoom(room.id, 'p2', 'Player2', true);
    assert.equal(room.players[1].color, '#007AFF');
    assert.equal(room.players[1].team, 2);

    // Player 3 joins -> auto assigned Red (Team 1)
    roomService.joinRoom(room.id, 'p3', 'Player3', true);
    assert.equal(room.players[2].color, '#FF3B30');
    assert.equal(room.players[2].team, 1);

    // Player 4 joins -> auto assigned Blue (Team 2)
    roomService.joinRoom(room.id, 'p4', 'Player4', true);
    assert.equal(room.players[3].color, '#007AFF');
    assert.equal(room.players[3].team, 2);

    // Now Red has 2 players, Blue has 2 players.
    // Trying to assign Red to player 4 (who has Blue) should fail because Red already has 2 players
    assert.throws(() => {
      roomService.selectPlayerColor(room.id, 'p4', '#FF3B30');
    }, /Color is already taken/);
  });

  it('2v2 Room should allow unselecting color ("") to free up color slot', () => {
    const room = roomService.createRoom('h1_swap', 'Host1', false, 'Swap Room', '2v2');
    roomService.joinRoom(room.id, 'p2_swap', 'Player2', true);
    roomService.joinRoom(room.id, 'p3_swap', 'Player3', true);
    roomService.joinRoom(room.id, 'p4_swap', 'Player4', true);

    // Player 1 (Red) unselects color
    roomService.selectPlayerColor(room.id, 'h1_swap', '');
    assert.equal(room.players[0].color, '');
    assert.equal(room.players[0].team, undefined);

    // Now Red has only 1 player (p3_swap). Player 4 (Blue) can switch to Red!
    roomService.selectPlayerColor(room.id, 'p4_swap', '#FF3B30');
    assert.equal(room.players[3].color, '#FF3B30');
    assert.equal(room.players[3].team, 1);
  });

  // 2. 2v2 Bot AI: 1 Teammate, 2 Enemies
  it('Bot in 2v2 should recognize 1 teammate and 2 enemies, and NEVER block its teammate', () => {
    const board = new Board(9);

    // Team 1: Player 1 (Human, Red) & Bot 1 (Red)
    const p1 = new Player('human1', 'Human', false, 4, 8, 0, undefined, 5, 0, '#FF3B30', 1, 4, 8);
    const bot1 = new Player('bot_team1', 'BOT - RED', true, 4, 7, 0, undefined, 5, 0, '#FF3B30', 1, 4, 7);

    // Team 2: Enemy 1 (Blue) & Enemy 2 (Blue)
    const enemy1 = new Player('enemy1', 'Enemy 1', true, 4, 0, 8, undefined, 5, 0, '#007AFF', 2, 4, 0);
    const enemy2 = new Player('enemy2', 'Enemy 2', true, 3, 0, 8, undefined, 5, 0, '#007AFF', 2, 3, 0);

    board.addPlayer(p1);
    board.addPlayer(bot1);
    board.addPlayer(enemy1);
    board.addPlayer(enemy2);

    // Simulate bot turn for bot1
    const action = board.getBotAction('bot_team1', true);
    assert.notEqual(action, null);

    // If bot places a wall, verify that the wall does NOT increase the shortest path of human1 (its teammate)
    if (action?.type === 'wall') {
      const testWall = new Wall('test', 'bot_team1', action.x, action.y, action.isHorizontal);
      board.walls.push(testWall);
      const teammatePath = board.findShortestPath('human1');
      assert.notEqual(teammatePath.length, 0, 'Teammate must not be trapped');
      board.walls.pop();
    }
  });

  it('2v2 bots should prioritize moving over non-critical walls at the start', () => {
    const board = new Board(11);
    board.addPlayer(new Player('red_human', 'Red Human', false, 0, 10, 0, undefined, 6, 0, '#FF3B30', 1));
    board.addPlayer(new Player('red_bot', 'Red Bot', true, 10, 10, 0, undefined, 6, 0, '#FF3B30', 1));
    board.addPlayer(new Player('blue_human', 'Blue Human', false, 10, 0, 10, undefined, 6, 0, '#007AFF', 2));
    board.addPlayer(new Player('blue_bot', 'Blue Bot', true, 0, 0, 10, undefined, 6, 0, '#007AFF', 2));

    const action = board.getBotAction('blue_bot', true);
    assert.equal(action?.type, 'move', 'An early non-critical wall should not consume the bot team wall reserve');
  });

  it('4-FFA bots should not spend walls on the opening turn around the center', () => {
    const board = new Board(11);
    board.addPlayer(new Player('north_bot', 'North Bot', true, 5, 0, 5, 5, 5));
    board.addPlayer(new Player('south_bot', 'South Bot', true, 5, 10, 5, 5, 5));
    board.addPlayer(new Player('west_bot', 'West Bot', true, 0, 5, 5, 5, 5));
    board.addPlayer(new Player('east_bot', 'East Bot', true, 10, 5, 5, 5, 5));

    const action = board.getBotAction('north_bot');
    assert.equal(action?.type, 'move', 'Bots should advance toward the center before spending walls');
  });

  // 3. 4-FFA Bot AI: Multi-Enemy Target Priority
  it('Bot in 4-FFA should target the leading opponent instead of focusing only on player 0', () => {
    const board = new Board(9);

    // Player 0 (Human, Red) at start (y=8, targetY=0, dist=8)
    const p0 = new Player('p0_human', 'Human', false, 4, 8, 0, undefined, 5, 0, '#FF3B30', 0, 4, 8);
    // Bot 1 (Blue) at y=4 (targetY=8, dist=4)
    const bot1 = new Player('bot_blue', 'BOT - BLUE', true, 4, 4, 8, undefined, 5, 0, '#007AFF', 0, 4, 4);
    // Bot 2 (Yellow) at y=1 (targetY=8, VERY CLOSE TO WINNING! dist=1) -> LEADING ENEMY!
    const bot2Leader = new Player('bot_yellow_leader', 'BOT - YELLOW', true, 4, 7, 0, undefined, 5, 0, '#FFCC00', 0, 4, 7);
    // Bot 3 (Green) at start
    const bot3 = new Player('bot_green', 'BOT - GREEN', true, 8, 4, 0, undefined, 5, 0, '#34C759', 0, 8, 4);

    board.addPlayer(p0);
    board.addPlayer(bot1);
    board.addPlayer(bot2Leader);
    board.addPlayer(bot3);

    const action = board.getBotAction('bot_blue');
    assert.notEqual(action, null);

    // If bot1 places a wall, it should block bot2Leader (the threat closest to goal) or advance
    if (action?.type === 'wall') {
      const testWall = new Wall('t', 'bot_blue', action.x, action.y, action.isHorizontal);
      board.walls.push(testWall);
      const leaderPathAfter = board.findShortestPath('bot_yellow_leader');
      board.walls.pop();
      assert.ok(leaderPathAfter.length > 0, 'Leader path must remain valid');
    }
  });

  // 4. 6-FFA Bot AI: 6 Players, Multi-Enemy Target Priority
  it('Bot in 6-FFA should evaluate all 5 enemies and execute valid moves/walls', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: index === 0 ? 'host_6ffa' : `bot_6ffa_${index}`,
      username: index === 0 ? 'Host6' : `BOT ${index}`,
      isGuest: index > 0,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    const game = new GameInstance('six_ffa_bot_test', '6-FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    assert.equal(game.state, 'playing');
    assert.equal(game.board.size, 11);

    // Trigger turns for bots in 6-FFA
    for (const p of players.slice(1)) {
      if (p.id.startsWith('bot_')) {
        const action = game.board.getBotAction(p.id);
        assert.notEqual(action, null);
      }
    }

    game.destroy();
  });

  it('4-FFA and 6-FFA bots collect exchange boosts for favorable swaps', () => {
    for (const { mode, size, center } of [
      { mode: '4-FFA', size: 11, center: 5 },
      { mode: '6-FFA', size: 11, center: 5 }
    ] as const) {
      const board = new Board(size);
      const bot = new Player(`bot_exchange_${mode}`, 'Exchange Bot', true, center, size - 1, center, center, 7);
      const leader = new Player(`leader_${mode}`, 'Leading Rival', false, center, center + 1, center, center, 7);
      board.addPlayer(bot);
      board.addPlayer(leader);

      for (let index = 0; index < (mode === '4-FFA' ? 2 : 4); index++) {
        const x = index % 2 === 0 ? 0 : size - 1;
        const y = index < 2 ? 0 : size - 1;
        board.addPlayer(new Player(`rival_${mode}_${index}`, 'Rival', false, x, y, center, center, 7));
      }

      const boostId = `exchange_boost_${mode}`;
      board.boosts.push(new Boost(boostId, 'exchange_item', center, size - 2));
      board.grid[size - 2][center].hasBoost = boostId;

      assert.equal(board.getBestBotExchangeTarget(bot.id)?.target.id, leader.id, `${mode}: select the opponent whose lead can be reversed`);
      assert.deepEqual(
        board.getBotAction(bot.id),
        { type: 'move', x: center, y: size - 2 },
        `${mode}: collect the exchange item when it enables a strong favorable swap`
      );

      let exchangedTargetId: string | undefined;
      const gamePlayers = Array.from({ length: mode === '4-FFA' ? 4 : 6 }, (_, index) => ({
        id: index === 0 ? `bot_full_exchange_${mode}` : `ffa_exchange_rival_${mode}_${index}`,
        username: `Player ${index}`,
        isGuest: true,
        color: '#007AFF'
      }));
      const game = new GameInstance(`full_exchange_${mode}`, mode, gamePlayers, (event, data) => {
        if (event === 'playersExchanged') exchangedTargetId = data.targetId;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      for (const player of game.board.players.values()) {
        game.board.grid[player.y][player.x].hasPlayer = null;
      }
      gamePlayers.forEach((playerData, index) => {
        const player = game.board.players.get(playerData.id)!;
        const position = index === 0
          ? { x: center, y: size - 1 }
          : index === 1
            ? { x: center, y: center + 1 }
            : { x: index % 2 === 0 ? 0 : size - 1, y: index < 3 ? 0 : size - 1 };
        player.x = position.x;
        player.y = position.y;
        player.targetX = center;
        player.targetY = center;
        game.board.grid[position.y][position.x].hasPlayer = player.id;
      });
      game.currentTurnIndex = 0;
      game.board.players.get(gamePlayers[0].id)!.hasExchangeItem = true;
      assert.equal(game.beginBoostDecision(gamePlayers[0].id, 'exchange_item'), true);
      assert.equal(exchangedTargetId, gamePlayers[1].id, `${mode}: resolve the boost against the best rival`);
      game.destroy();
    }
  });

  it('Boost lifecycle delay is random and inclusive from 60 to 120 seconds', () => {
    assert.equal(getRandomBoostDelayMs(() => 0), BOOST_MIN_DELAY_MS);
    assert.equal(getRandomBoostDelayMs(() => 0.999999), BOOST_MAX_DELAY_MS);
    for (const randomValue of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const delay = getRandomBoostDelayMs(() => randomValue);
      assert.ok(delay >= 60_000 && delay <= 120_000);
    }
  });

  it('Timed boosts disappear and respawn after random cooldowns in every supported mode', (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'], now: 0 });
    const originalRandom = Math.random;
    Math.random = () => 0;
    const games: GameInstance[] = [];
    try {
      const scenarios = [
        { mode: '1v1', count: 2, hasKiller: false },
        { mode: 'vs_ai', count: 2, hasKiller: false },
        { mode: '2v2', count: 4, hasKiller: false },
        { mode: '4-FFA', count: 4, hasKiller: true },
        { mode: '6-FFA', count: 6, hasKiller: true }
      ] as const;

      for (const { mode, count, hasKiller } of scenarios) {
        const players = Array.from({ length: count }, (_, index) => ({
          id: `boost_cycle_${mode}_${index}`,
          username: `Player ${index}`,
          isGuest: true,
          color: '#007AFF'
        }));
        const game = new GameInstance(`boost_cycle_game_${mode}`, mode, players, () => {}, {
          turnTimeLimitSeconds: 60,
          maxStrikesBeforeKick: 100
        });
        games.push(game);
        game.start();

        const timedTypes = ['ghost', 'exchange_item', 'portal', ...(hasKiller ? ['killer_item'] : [])];
        for (const type of timedTypes) {
          assert.ok(game.board.boosts.some(boost => boost.type === type), `${mode}: ${type} spawns`);
        }
        assert.equal(
          game.board.boosts.some(boost => boost.type === 'killer_item'),
          hasKiller,
          `${mode}: killer item is restricted to FFA`
        );

        context.mock.timers.tick(60_000);
        for (const type of timedTypes) {
          assert.equal(game.board.boosts.some(boost => boost.type === type), false, `${mode}: ${type} expires`);
        }

        for (const playerId of game.playersList) game.recordPlayerActivity(playerId);
        context.mock.timers.tick(60_000);
        for (const type of timedTypes) {
          assert.ok(game.board.boosts.some(boost => boost.type === type), `${mode}: ${type} respawns after cooldown`);
        }
      }
    } finally {
      for (const game of games) game.destroy();
      Math.random = originalRandom;
      context.mock.timers.reset();
    }
  });

  it('Collecting a timed boost starts its respawn cooldown from the pickup', (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'], now: 0 });
    const originalRandom = Math.random;
    Math.random = () => 0;
    const game = new GameInstance('picked_boost_cooldown', '4-FFA', Array.from({ length: 4 }, (_, index) => ({
      id: `picked_boost_${index}`,
      username: `Player ${index}`,
      isGuest: true,
      color: '#007AFF'
    })), () => {}, {
      turnTimeLimitSeconds: 60,
      maxStrikesBeforeKick: 100
    });

    try {
      game.start();
      const playerId = game.getCurrentPlayer();
      const player = game.board.players.get(playerId)!;
      const ghost = game.board.boosts.find(boost => boost.type === 'ghost')!;
      const target = game.board.getValidMoves(playerId).find(move =>
        !game.board.boosts.some(boost => boost.x === move.x && boost.y === move.y)
      )!;
      game.board.grid[ghost.y][ghost.x].hasBoost = null;
      ghost.x = target.x;
      ghost.y = target.y;
      game.board.grid[target.y][target.x].hasBoost = ghost.id;

      assert.equal(game.executeMove(playerId, target.x, target.y), true);
      assert.equal(game.board.boosts.some(boost => boost.type === 'ghost'), false);
      context.mock.timers.tick(BOOST_MIN_DELAY_MS - 1);
      assert.equal(game.board.boosts.some(boost => boost.type === 'ghost'), false);
      context.mock.timers.tick(1);
      assert.equal(game.board.boosts.some(boost => boost.type === 'ghost'), true);
    } finally {
      game.destroy();
      Math.random = originalRandom;
      context.mock.timers.reset();
    }
  });

  it('4-FFA and 6-FFA matches can spawn a ghost boost alongside special items', () => {

    const originalRandom = Math.random;
    Math.random = () => 0.75;
    try {
      for (const mode of ['4-FFA', '6-FFA'] as const) {
        const players = Array.from({ length: mode === '4-FFA' ? 4 : 6 }, (_, index) => ({
          id: `ghost_spawn_${mode}_${index}`,
          username: `Player ${index}`,
          isGuest: true,
          color: '#007AFF'
        }));
        const game = new GameInstance(`ghost_spawn_game_${mode}`, mode, players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
        game.start();
        assert.ok(game.board.boosts.some(boost => boost.type === 'ghost'), `${mode}: ghost can be selected for spawning`);
        assert.ok(game.board.boosts.some(boost => boost.type === 'killer_item'));
        assert.ok(game.board.boosts.some(boost => boost.type === 'exchange_item'));
        assert.ok(game.board.boosts.some(boost => boost.type === 'portal'));
        assert.equal(game.board.boosts.filter(boost => boost.type === 'ghost').length, 1);
        assert.equal(game.board.boosts.filter(boost => boost.type === 'killer_item').length, 1);
        assert.equal(game.board.boosts.filter(boost => boost.type === 'exchange_item').length, 1);
        assert.equal(game.board.boosts.filter(boost => boost.type === 'portal').length, 2);
        for (const boost of game.board.boosts) {
          assert.equal(game.board.grid[boost.y][boost.x].hasPlayer, null, `${mode}: boost must not spawn under a player`);
          assert.ok(
            Array.from(game.board.players.values()).some(player =>
              game.board.findShortestPathToGoal(player.x, player.y, boost.y, boost.x).length > 0
            ),
            `${mode}: boost must spawn in a reachable square`
          );
        }
        game.destroy();
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  it('4-FFA and 6-FFA matches announce ghost activation to the whole game room', () => {
    for (const mode of ['4-FFA', '6-FFA'] as const) {
      let ghostAnnouncement: {
        playerId: string;
        username: string;
        turns: number;
        currentTurn: string;
        board: { players: Record<string, { ghostTurnsRemaining: number }> };
      } | undefined;
      const players = Array.from({ length: mode === '4-FFA' ? 4 : 6 }, (_, index) => ({
        id: `ghost_announcement_${mode}_${index}`,
        username: `Player ${index}`,
        isGuest: true,
        color: '#007AFF'
      }));
      const game = new GameInstance(`ghost_announcement_game_${mode}`, mode, players, (event, data) => {
        if (event === 'ghostModeActivated') ghostAnnouncement = data;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      const player = game.board.players.get(players[0].id)!;
      const ghost = game.board.boosts.find(boost => boost.type === 'ghost')!;
      const target = game.board.getValidMoves(player.id).find(move =>
        !game.board.boosts.some(boost => boost.x === move.x && boost.y === move.y)
      )!;
      game.board.grid[ghost.y][ghost.x].hasBoost = null;
      ghost.x = target.x;
      ghost.y = target.y;
      game.board.grid[target.y][target.x].hasBoost = ghost.id;
      game.currentTurnIndex = 0;

      assert.equal(game.executeMove(player.id, target.x, target.y), true);
      assert.equal(ghostAnnouncement?.playerId, player.id);
      assert.equal(ghostAnnouncement?.username, player.username);
      assert.equal(ghostAnnouncement?.turns, 3);
      assert.equal(ghostAnnouncement?.currentTurn, player.id);
      assert.equal(ghostAnnouncement?.board.players[player.id].ghostTurnsRemaining, 3);
      game.destroy();
    }
  });

  it('1v1, VS AI, and 2v2 games spawn and announce ghost activation', () => {
    const scenarios = [
      { mode: '1v1', count: 2 },
      { mode: 'vs_ai', count: 2 },
      { mode: '2v2', count: 4 }
    ] as const;

    for (const { mode, count } of scenarios) {
      let ghostAnnouncement: {
        playerId: string;
        username: string;
        turns: number;
        board: { players: Record<string, { ghostTurnsRemaining: number }> };
      } | undefined;
      const players = Array.from({ length: count }, (_, index) => ({
        id: `ghost_all_modes_${mode}_${index}`,
        username: `Player ${index}`,
        isGuest: true,
        color: ['#FF3B30', '#007AFF', '#34C759', '#FFCC00'][index],
        team: mode === '2v2' ? (index % 2) + 1 : undefined
      }));
      const game = new GameInstance(`ghost_all_modes_game_${mode}`, mode, players, (event, data) => {
        if (event === 'ghostModeActivated') ghostAnnouncement = data;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      assert.equal(game.board.boosts.filter(boost => boost.type === 'ghost').length, 1, `${mode}: spawn one ghost`);
      const player = game.board.players.get(players[0].id)!;
      const ghost = game.board.boosts.find(boost => boost.type === 'ghost')!;
      const target = game.board.getValidMoves(player.id).find(move =>
        !game.board.boosts.some(boost => boost.x === move.x && boost.y === move.y)
      )!;
      game.board.grid[ghost.y][ghost.x].hasBoost = null;
      ghost.x = target.x;
      ghost.y = target.y;
      game.board.grid[target.y][target.x].hasBoost = ghost.id;
      game.currentTurnIndex = 0;

      assert.equal(game.executeMove(player.id, target.x, target.y), true);
      assert.equal(player.ghostTurnsRemaining, 3);
      assert.equal(ghostAnnouncement?.playerId, player.id);
      assert.equal(ghostAnnouncement?.username, player.username);
      assert.equal(ghostAnnouncement?.turns, 3);
      assert.equal(ghostAnnouncement?.board.players[player.id].ghostTurnsRemaining, 3);
      game.destroy();
    }
  });

  it('Bots prioritize a ghost boost when its three wall-crossing moves shorten their route', () => {
    const board = new Board(11);
    const bot = new Player('bot_ghost_route', 'Ghost Bot', true, 5, 8, 0, undefined, 0);
    const rival = new Player('ghost_route_rival', 'Rival', false, 10, 10, 0, undefined, 0);
    board.addPlayer(bot);
    board.addPlayer(rival);
    for (const x of [0, 2, 4, 6, 8]) {
      board.walls.push(new Wall(`ghost_route_wall_${x}`, 'rival', x, 7, true));
    }
    const ghost = new Boost('bot_ghost_route_boost', 'ghost', 4, 8);
    board.boosts.push(ghost);
    board.grid[ghost.y][ghost.x].hasBoost = ghost.id;

    const ordinaryDistance = board.getBotStrategicDistance(bot.id, 4, 8);
    const ghostDistance = board.getBotStrategicDistance(bot.id, 4, 8, undefined, 3);
    assert.ok(ghostDistance < ordinaryDistance, 'Ghost should provide a shorter route through the wall barrier');
    assert.deepEqual(
      board.getBotAction(bot.id),
      { type: 'move', x: 4, y: 8 },
      'Bot should collect the boost when its limited duration materially shortens the route'
    );
  });

  it('FFA bots block a valuable boost when an opponent can collect it next and the wall preserves their own route', () => {
    const board = new Board(9);
    const bot = new Player('bot_item_guard', 'Guard Bot', true, 8, 4, undefined, 0, 5);
    const enemy = new Player('enemy_item_runner', 'Runner', false, 4, 4, 8, undefined, 5);
    const rival = new Player('other_rival', 'Rival', false, 0, 0, 8, undefined, 5);
    board.addPlayer(bot);
    board.addPlayer(enemy);
    board.addPlayer(rival);
    for (const x of [0, 2, 4]) board.walls.push(new Wall(`goal_barrier_${x}`, rival.id, x, 5, true));
    const ghost = new Boost('contested_ghost', 'ghost', 4, 5);
    board.boosts.push(ghost);
    board.grid[ghost.y][ghost.x].hasBoost = ghost.id;

    assert.ok(
      board.getBotStrategicDistance(enemy.id, ghost.x, ghost.y, undefined, 3) <
      board.getBotStrategicDistance(enemy.id, ghost.x, ghost.y),
      'The ghost item must give the runner a meaningful route advantage'
    );
    const action = board.getBotAction(bot.id);
    assert.equal(action?.type, 'wall', 'The bot should deny a valuable item available to an opponent next move');
    if (action?.type !== 'wall') return;

    const botDistanceBefore = board.getBotStrategicDistance(bot.id, bot.x, bot.y);
    board.walls.push(new Wall('selected_item_defense', bot.id, action.x, action.y, action.isHorizontal));
    assert.equal(
      board.getValidMoves(enemy.id).some(move => move.x === ghost.x && move.y === ghost.y),
      false,
      'The selected wall must stop the opponent from collecting the boost on its next move'
    );
    assert.equal(board.getBotStrategicDistance(bot.id, bot.x, bot.y), botDistanceBefore);
  });

  it('2v2 bots never block a teammate from collecting a useful boost', () => {
    const board = new Board(9);
    const bot = new Player('bot_team_boost_guard', 'Guard Bot', true, 8, 4, undefined, 0, 5, 0, '#FF3B30', 1);
    const teammate = new Player('teammate_boost_runner', 'Teammate', false, 4, 4, 8, undefined, 5, 0, '#FF3B30', 1);
    const enemyOne = new Player('enemy_team_one', 'Enemy One', false, 0, 0, 8, undefined, 5, 0, '#007AFF', 2);
    const enemyTwo = new Player('enemy_team_two', 'Enemy Two', false, 8, 0, 8, undefined, 5, 0, '#007AFF', 2);
    board.addPlayer(bot);
    board.addPlayer(teammate);
    board.addPlayer(enemyOne);
    board.addPlayer(enemyTwo);
    for (const x of [0, 2, 4]) board.walls.push(new Wall(`team_goal_barrier_${x}`, enemyOne.id, x, 5, true));
    const ghost = new Boost('teammate_ghost', 'ghost', 4, 5);
    board.boosts.push(ghost);
    board.grid[ghost.y][ghost.x].hasBoost = ghost.id;

    assert.ok(
      board.getBotStrategicDistance(teammate.id, ghost.x, ghost.y, undefined, 3) <
      board.getBotStrategicDistance(teammate.id, ghost.x, ghost.y),
      'The ghost boost must be useful to the teammate'
    );
    assert.deepEqual(
      board.getBotAction(bot.id, true),
      { type: 'move', x: 7, y: 4 },
      'The bot must advance instead of placing a wall that would deny its teammate the boost'
    );
  });

  it('4-FFA and 6-FFA bots eliminate the opponent closest to the shared goal', () => {
    for (const { mode, size, center, positions } of [
      {
        mode: '4-FFA',
        size: 11,
        center: 5,
        positions: [
          { x: 0, y: 10 },
          { x: 5, y: 4 },
          { x: 10, y: 0 },
          { x: 0, y: 0 }
        ]
      },
      {
        mode: '6-FFA',
        size: 11,
        center: 5,
        positions: [
          { x: 0, y: 10 },
          { x: 5, y: 4 },
          { x: 10, y: 0 },
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 9 }
        ]
      }
    ] as const) {
      let killedTargetId: string | undefined;
      const players = positions.map((_, index) => ({
        id: index === 0 ? `bot_hunter_${mode}` : `bot_rival_${mode}_${index}`,
        username: `Player ${index}`,
        isGuest: true,
        color: '#007AFF'
      }));
      const game = new GameInstance(`killer_target_${mode}`, mode, players, (event, data) => {
        if (event === 'playerKilled') killedTargetId = data.targetId;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      for (const player of game.board.players.values()) {
        game.board.grid[player.y][player.x].hasPlayer = null;
      }
      positions.forEach((position, index) => {
        const player = game.board.players.get(players[index].id)!;
        player.x = position.x;
        player.y = position.y;
        player.targetX = center;
        player.targetY = center;
        game.board.grid[position.y][position.x].hasPlayer = player.id;
      });

      game.currentTurnIndex = 0;
      game.board.players.get(players[0].id)!.hasKillerItem = true;
      assert.equal(game.beginBoostDecision(players[0].id, 'killer_item'), true);
      assert.equal(killedTargetId, players[1].id, `${mode}: kill the closest rival to the goal`);
      game.destroy();
    }
  });

  it('4-FFA and 6-FFA bots use portal routes to shorten their path to the shared goal', () => {
    for (const { mode, size, center } of [
      { mode: '4-FFA', size: 11, center: 5 },
      { mode: '6-FFA', size: 11, center: 5 }
    ] as const) {
      const board = new Board(size);
      const bot = new Player(`bot_portal_${mode}`, 'Portal Bot', true, center, size - 1, center, center, 0);
      board.addPlayer(bot);
      board.boosts.push(
        new Boost(`portal_entry_${mode}`, 'portal', center, size - 2, center, center + 1),
        new Boost(`portal_exit_${mode}`, 'portal', center, center + 1, center, size - 2)
      );

      assert.equal(board.getBotStrategicDistance(bot.id, bot.x, bot.y), 2, `${mode}: count the portal in the shortest route`);
      assert.deepEqual(
        board.getBotAction(bot.id),
        { type: 'move', x: center, y: size - 2 },
        `${mode}: step onto the portal when it shortens the route to the goal`
      );
      assert.equal(board.movePlayer(bot.id, center, size - 2), true);
      assert.deepEqual(
        { x: bot.x, y: bot.y },
        { x: center, y: center + 1 },
        `${mode}: execute the selected portal move at its real landing position`
      );
    }
  });

  it('4-FFA and 6-FFA bots avoid portals that make their route longer', () => {
    for (const { mode, size, center } of [
      { mode: '4-FFA', size: 11, center: 5 },
      { mode: '6-FFA', size: 11, center: 5 }
    ] as const) {
      const board = new Board(size);
      const bot = new Player(`bot_bad_portal_${mode}`, 'Portal Bot', true, center, size - 1, center, center, 0);
      board.addPlayer(bot);
      board.boosts.push(
        new Boost(`bad_portal_entry_${mode}`, 'portal', center - 1, size - 2, size - 1, size - 1),
        new Boost(`bad_portal_exit_${mode}`, 'portal', size - 1, size - 1, center - 1, size - 2)
      );

      const normalDistance = board.getShortestPathLength(bot.x, bot.y, bot.targetY, bot.targetX);
      assert.equal(board.getBotStrategicDistance(bot.id, bot.x, bot.y), normalDistance, `${mode}: ignore a portal detour`);
      assert.deepEqual(
        board.getBotAction(bot.id),
        { type: 'move', x: center, y: size - 2 },
        `${mode}: continue along the ordinary shortest route instead of entering the detour`
      );
    }
  });

  it('4-FFA and 6-FFA bots find routes that use more than one portal', () => {
    for (const { mode, size, center } of [
      { mode: '4-FFA', size: 11, center: 5 },
      { mode: '6-FFA', size: 11, center: 5 }
    ] as const) {
      const board = new Board(size);
      const bot = new Player(`bot_chained_portals_${mode}`, 'Portal Bot', true, 0, size - 1, center, center, 0);
      board.addPlayer(bot);
      board.boosts.push(
        new Boost(`portal_first_in_${mode}`, 'portal', 0, size - 2, center, size - 2),
        new Boost(`portal_first_out_${mode}`, 'portal', center, size - 2, 0, size - 2),
        new Boost(`portal_second_in_${mode}`, 'portal', center, size - 3, center, center),
        new Boost(`portal_second_out_${mode}`, 'portal', center, center, center, size - 3)
      );

      assert.equal(
        board.getBotStrategicDistance(bot.id, bot.x, bot.y),
        2,
        `${mode}: enter the first portal, then the second portal to reach the goal`
      );
      assert.deepEqual(
        board.getBotAction(bot.id),
        { type: 'move', x: 0, y: size - 2 },
        `${mode}: begin the shortest chained-portal route`
      );
    }
  });

  it('4-FFA and 6-FFA exchange decisions account for portal shortcuts', () => {
    for (const { mode, size, center } of [
      { mode: '4-FFA', size: 11, center: 5 },
      { mode: '6-FFA', size: 11, center: 5 }
    ] as const) {
      const board = new Board(size);
      const bot = new Player(`bot_portal_exchange_${mode}`, 'Exchange Bot', true, 0, size - 1, center, center, 0);
      const portalAdvantagedRival = new Player(
        `rival_portal_exchange_${mode}`,
        'Portal Rival',
        false,
        center,
        center + 3,
        center,
        center,
        0
      );
      const ordinaryRival = new Player(
        `rival_ordinary_exchange_${mode}`,
        'Ordinary Rival',
        false,
        center + 3,
        center,
        center,
        center,
        0
      );
      board.addPlayer(bot);
      board.addPlayer(portalAdvantagedRival);
      board.addPlayer(ordinaryRival);
      board.boosts.push(
        new Boost(`exchange_shortcut_in_${mode}`, 'portal', center, center + 2, center, center),
        new Boost(`exchange_shortcut_out_${mode}`, 'portal', center, center, center, center + 2)
      );

      assert.equal(
        board.getBotStrategicDistance(portalAdvantagedRival.id, portalAdvantagedRival.x, portalAdvantagedRival.y),
        1,
        `${mode}: include the rival's portal shortcut when evaluating an exchange`
      );
      assert.equal(
        board.getBestBotExchangeTarget(bot.id)?.target.id,
        portalAdvantagedRival.id,
        `${mode}: exchange with the rival whose portal advantage can be reversed`
      );
    }
  });

  it('4-FFA and 6-FFA bots place walls that increase the leading enemy route', () => {
    for (const { mode, size, center, positions } of [
      {
        mode: '4-FFA',
        size: 11,
        center: 5,
        positions: [
          { x: 0, y: 10 },
          { x: 5, y: 4 },
          { x: 0, y: 0 },
          { x: 10, y: 0 }
        ]
      },
      {
        mode: '6-FFA',
        size: 11,
        center: 5,
        positions: [
          { x: 0, y: 10 },
          { x: 5, y: 4 },
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 9 }
        ]
      }
    ] as const) {
      const board = new Board(size);
      const players = positions.map((position, index) => {
        const player = new Player(
          index === 0 ? `bot_wall_${mode}` : `wall_rival_${mode}_${index}`,
          `Player ${index}`,
          index === 0,
          position.x,
          position.y,
          center,
          center,
          7
        );
        board.addPlayer(player);
        return player;
      });

      const leadingEnemy = players[1];
      const shortestPathBefore = board.getShortestPathLength(
        leadingEnemy.x, leadingEnemy.y, leadingEnemy.targetY, leadingEnemy.targetX
      );
      assert.equal(shortestPathBefore, 1, `${mode}: the leading enemy starts one move from the goal`);

      const actions = Array.from({ length: 3 }, () => board.getBotAction(players[0].id));
      for (const action of actions) {
        assert.equal(action?.type, 'wall', `${mode}: consistently respond to a leading enemy with a wall`);
      }
      assert.deepEqual(actions[1], actions[0], `${mode}: wall priority must not depend on randomness`);
      const action = actions[0];
      if (action?.type === 'wall') {
        board.walls.push(new Wall(`leading_enemy_block_${mode}`, players[0].id, action.x, action.y, action.isHorizontal));
        const shortestPathAfter = board.getShortestPathLength(
          leadingEnemy.x, leadingEnemy.y, leadingEnemy.targetY, leadingEnemy.targetX
        );
        assert.ok(shortestPathAfter > shortestPathBefore, `${mode}: the selected wall must lengthen the leading enemy's route`);
      }
    }
  });

  it('4-FFA and 6-FFA bots block a portal that gives an opponent a shorter route to the goal', () => {
    for (const { mode, size, center } of [
      { mode: '4-FFA', size: 11, center: 5 },
      { mode: '6-FFA', size: 11, center: 5 }
    ] as const) {
      const board = new Board(size);
      const bot = new Player(`bot_defend_${mode}`, 'Defending Bot', true, center - 4, center + 3, center, center, 7);
      const enemy = new Player(`enemy_portal_${mode}`, 'Leading Enemy', false, center, center + 3, center, center, 7);
      board.addPlayer(bot);
      board.addPlayer(enemy);
      board.boosts.push(
        new Boost(`enemy_portal_entry_${mode}`, 'portal', center, center + 2, center, center - 1),
        new Boost(`enemy_portal_exit_${mode}`, 'portal', center, center - 1, center, center + 2)
      );

      const normalDistance = board.getShortestPathLength(enemy.x, enemy.y, enemy.targetY, enemy.targetX);
      const portalDistance = board.getBotStrategicDistance(enemy.id, enemy.x, enemy.y);
      assert.ok(portalDistance < normalDistance, `${mode}: portal must genuinely shorten the enemy's route`);

      const action = board.getBotAction(bot.id);
      assert.equal(action?.type, 'wall', `${mode}: defend against an enemy who can immediately use the portal`);
      if (action?.type === 'wall') {
        board.walls.push(new Wall(`defense_${mode}`, bot.id, action.x, action.y, action.isHorizontal));
        const pathToPortal = board.findShortestPathToGoal(enemy.x, enemy.y, center + 2, center);
        assert.ok(pathToPortal.length - 1 > 1, `${mode}: the chosen wall should delay enemy access to the portal`);
        assert.ok(
          board.getBotStrategicDistance(enemy.id, enemy.x, enemy.y) > portalDistance,
          `${mode}: the chosen wall must increase the enemy's best route after accounting for portals`
        );
      }
    }
  });

  it('Bot blocks a useful portal only when an enemy is one move away', () => {
    const board = new Board(9);
    const human = new Player('human', 'Human', false, 4, 6, 0, undefined, 5, 0, '#FF3B30', 1);
    const bot = new Player('bot_defender', 'Bot', true, 0, 8, 0, undefined, 5, 0, '#007AFF', 2);
    board.addPlayer(human);
    board.addPlayer(bot);
    board.boosts.push(
      new Boost('portal_a', 'portal', 4, 5, 4, 1),
      new Boost('portal_b', 'portal', 4, 1, 4, 5)
    );

    const normalDistance = board.getShortestPathLength(human.x, human.y, human.targetY, human.targetX, human.id);
    const portalDistance = 1 + board.getShortestPathLength(4, 1, human.targetY, human.targetX);
    assert.ok(portalDistance < normalDistance, 'Portal should provide a real shortcut');

    const action = board.getBotAction(bot.id);
    assert.equal(action?.type, 'wall');
    if (action?.type === 'wall') {
      board.walls.push(new Wall('test-portal-block', bot.id, action.x, action.y, action.isHorizontal));
      const pathToPortal = board.findShortestPathToGoal(human.x, human.y, 5, 4);
      assert.ok(pathToPortal.length - 1 > 1, 'Chosen wall should complicate immediate access to the portal');
    }
  });

  it('Bot routes through a portal when it shortens its path to the goal', () => {
    const board = new Board(9);
    const bot = new Player('bot_portal', 'Portal Bot', true, 4, 8, 0, undefined, 0);
    board.addPlayer(bot);
    board.boosts.push(
      new Boost('portal_entry', 'portal', 4, 7, 4, 1),
      new Boost('portal_exit', 'portal', 4, 1, 4, 7)
    );

    assert.equal(board.getBotStrategicDistance(bot.id, bot.x, bot.y), 2);
    assert.deepEqual(board.getBotAction(bot.id), { type: 'move', x: 4, y: 7 });
  });

  it('Bot collects a portal to deny a major shortcut to an opponent in FFA', () => {
    const board = new Board(9);
    const bot = new Player('bot_denial', 'Bot', true, 2, 6, undefined, 0, 0);
    const enemy = new Player('enemy_denial', 'Enemy', false, 4, 6, 0, undefined, 0);
    board.addPlayer(bot);
    board.addPlayer(enemy);
    board.boosts.push(
      new Boost('denial_entry', 'portal', 3, 6, 4, 0),
      new Boost('denial_exit', 'portal', 4, 0, 3, 6)
    );

    assert.equal(board.getBotStrategicDistance(enemy.id, enemy.x, enemy.y), 1);
    assert.deepEqual(board.getBotAction(bot.id), { type: 'move', x: 3, y: 6 });
  });

  it('Bot portal routing distinguishes team benefit from enemy benefit', () => {
    const board = new Board(9);
    const bot = new Player('bot_team_portal', 'Bot', true, 0, 0, 8, undefined, 0, 0, '#FF3B30', 1);
    const teammate = new Player('teammate_portal', 'Teammate', false, 4, 6, 0, undefined, 0, 0, '#FF3B30', 1);
    const enemy = new Player('enemy_portal', 'Enemy', false, 8, 6, 8, undefined, 0, 0, '#007AFF', 2);
    board.addPlayer(bot);
    board.addPlayer(teammate);
    board.addPlayer(enemy);
    board.boosts.push(
      new Boost('team_portal_entry', 'portal', 4, 5, 4, 1),
      new Boost('team_portal_exit', 'portal', 4, 1, 4, 5)
    );

    assert.ok(
      board.getBotStrategicDistance(teammate.id, teammate.x, teammate.y) <
      board.getShortestPathLength(teammate.x, teammate.y, teammate.targetY, teammate.targetX),
      'A portal shortcut should be reflected in a teammate route'
    );
    assert.equal(
      board.getBotStrategicDistance(enemy.id, enemy.x, enemy.y),
      board.getShortestPathLength(enemy.x, enemy.y, enemy.targetY, enemy.targetX),
      'A portal away from the enemy goal should not be counted as a shortcut'
    );
    assert.equal(board.getBotAction(bot.id, true)?.type, 'move');
  });

  it('2v2 bot never targets its teammate with the killer boost', () => {
    let killedTargetId: string | undefined;
    const game = new GameInstance('bot_killer_team', '2v2', [
      { id: 'bot_killer', username: 'BOT', isGuest: true, color: '#FF3B30', team: 1 },
      { id: 'bot_teammate', username: 'BOT TEAMMATE', isGuest: true, color: '#FF3B30', team: 1 },
      { id: 'enemy_one', username: 'Enemy One', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'enemy_two', username: 'Enemy Two', isGuest: false, color: '#007AFF', team: 2 }
    ], (event, data) => {
      if (event === 'playerKilled') killedTargetId = data.targetId;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    game.currentTurnIndex = 0;
    game.board.players.get('bot_killer')!.hasKillerItem = true;
    assert.equal(game.beginBoostDecision('bot_killer', 'killer_item'), true);
    assert.ok(killedTargetId === 'enemy_one' || killedTargetId === 'enemy_two');
    game.destroy();
  });

  it('2v2 bot exchanges with an enemy when it moves significantly closer to its goal', () => {
    let exchangedTargetId: string | undefined;
    const game = new GameInstance('bot_exchange_gain', '2v2', [
      { id: 'bot_exchange_gain', username: 'BOT', isGuest: true, color: '#FF3B30', team: 1 },
      { id: 'teammate_exchange', username: 'Teammate', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'enemy_near', username: 'Enemy Near', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'enemy_far', username: 'Enemy Far', isGuest: false, color: '#007AFF', team: 2 }
    ], (event, data) => {
      if (event === 'playersExchanged') exchangedTargetId = data.targetId;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    game.currentTurnIndex = 0;
    const positions = [
      { id: 'bot_exchange_gain', x: 4, y: 8 },
      { id: 'teammate_exchange', x: 10, y: 8 },
      { id: 'enemy_near', x: 4, y: 7 },
      { id: 'enemy_far', x: 0, y: 0 }
    ];
    for (const { id } of positions) {
      const player = game.board.players.get(id)!;
      game.board.grid[player.y][player.x].hasPlayer = null;
    }
    for (const position of positions) {
      const player = game.board.players.get(position.id)!;
      player.x = position.x;
      player.y = position.y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    }
    game.board.boosts = [];
    game.board.grid.forEach(row => row.forEach(cell => cell.hasBoost = null));
    game.board.players.get('bot_exchange_gain')!.hasExchangeItem = true;

    assert.equal(game.beginBoostDecision('bot_exchange_gain', 'exchange_item'), true);
    assert.equal(exchangedTargetId, 'enemy_far');
    game.destroy();
  });

  it('2v2 bot prioritizes an exchange boost when it can gain a strong advantage', () => {
    const board = new Board(11);
    const bot = new Player('exchange_bot', 'Bot', true, 4, 8, 0, undefined, 6, 0, '#FF3B30', 1);
    const teammate = new Player('exchange_teammate', 'Teammate', false, 10, 8, 0, undefined, 6, 0, '#FF3B30', 1);
    const enemyNearGoal = new Player('exchange_enemy_near', 'Enemy Near Goal', false, 4, 1, 10, undefined, 6, 0, '#007AFF', 2);
    const otherEnemy = new Player('exchange_enemy_other', 'Other Enemy', true, 10, 1, 10, undefined, 6, 0, '#007AFF', 2);
    board.addPlayer(bot);
    board.addPlayer(teammate);
    board.addPlayer(enemyNearGoal);
    board.addPlayer(otherEnemy);
    board.boosts.push(new Boost('exchange_opportunity', 'exchange_item', 5, 8));
    board.grid[8][5].hasBoost = 'exchange_opportunity';

    const action = board.getBotAction(bot.id, true);
    assert.deepEqual(action, { type: 'move', x: 5, y: 8 });
    assert.equal(board.getBestBotExchangeTarget(bot.id, true)?.target.id, enemyNearGoal.id);
  });

  it('2v2 player cannot exchange with a teammate and can still use the pending item on an enemy', () => {
    let exchangedTargetId: string | undefined;
    const game = new GameInstance('human_exchange_team', '2v2', [
      { id: 'human_exchange_team', username: 'Human', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'human_exchange_mate', username: 'Teammate', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'human_exchange_enemy', username: 'Enemy', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'bot_exchange_enemy', username: 'Bot Enemy', isGuest: true, color: '#007AFF', team: 2 }
    ], (event, data) => {
      if (event === 'playersExchanged') exchangedTargetId = data.targetId;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    game.currentTurnIndex = 0;
    const positions = [
      { id: 'human_exchange_team', x: 4, y: 8 },
      { id: 'human_exchange_mate', x: 10, y: 8 },
      { id: 'human_exchange_enemy', x: 4, y: 2 },
      { id: 'bot_exchange_enemy', x: 10, y: 2 }
    ];
    for (const { id } of positions) {
      const player = game.board.players.get(id)!;
      game.board.grid[player.y][player.x].hasPlayer = null;
    }
    for (const position of positions) {
      const player = game.board.players.get(position.id)!;
      player.x = position.x;
      player.y = position.y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    }
    game.board.players.get('human_exchange_team')!.hasExchangeItem = true;
    assert.equal(game.beginBoostDecision('human_exchange_team', 'exchange_item'), true);

    assert.equal(game.executeExchangeItem('human_exchange_team', 'human_exchange_mate'), false);
    assert.equal(game.getPendingBoostDecision()?.playerId, 'human_exchange_team');
    assert.equal(game.executeExchangeItem('human_exchange_team', 'human_exchange_enemy'), true);
    assert.equal(exchangedTargetId, 'human_exchange_enemy');
    assert.equal(game.getPendingBoostDecision(), null);
    assert.deepEqual(
      { x: game.board.players.get('human_exchange_team')!.x, y: game.board.players.get('human_exchange_team')!.y },
      { x: 4, y: 2 }
    );
    game.destroy();
  });

  it('Bot discards an exchange boost when swapping does not improve its position or race', () => {
    let exchanged = false;
    const game = new GameInstance('bot_exchange_no_gain', '1v1', [
      { id: 'bot_exchange', username: 'BOT', isGuest: true, color: '#FF3B30' },
      { id: 'human_exchange', username: 'Human', isGuest: false, color: '#007AFF' }
    ], event => {
      if (event === 'playersExchanged') exchanged = true;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    game.currentTurnIndex = 0;
    const bot = game.board.players.get('bot_exchange')!;
    const human = game.board.players.get('human_exchange')!;
    game.board.grid[bot.y][bot.x].hasPlayer = null;
    game.board.grid[human.y][human.x].hasPlayer = null;
    bot.x = 4;
    bot.y = 4;
    human.x = 3;
    human.y = 4;
    game.board.grid[bot.y][bot.x].hasPlayer = bot.id;
    game.board.grid[human.y][human.x].hasPlayer = human.id;
    game.board.boosts = [];
    game.board.grid.forEach(row => row.forEach(cell => cell.hasBoost = null));
    bot.hasExchangeItem = true;
    assert.equal(game.beginBoostDecision('bot_exchange', 'exchange_item'), true);
    assert.equal(exchanged, false);
    assert.equal(game.board.players.get('bot_exchange')!.hasExchangeItem, false);
    game.destroy();
  });

  it('Bot does not spend a wall to block a portal that does not benefit an enemy or a teammate', () => {
    const board = new Board(9);
    const human = new Player('human', 'Human', false, 4, 6, 0, undefined, 5, 0, '#FF3B30', 1);
    const bot = new Player('bot_defender', 'Bot', true, 0, 8, 0, undefined, 0, 0, '#007AFF', 2);
    board.addPlayer(human);
    board.addPlayer(bot);
    board.boosts.push(
      new Boost('portal_a', 'portal', 4, 5, 4, 7),
      new Boost('portal_b', 'portal', 4, 7, 4, 5)
    );

    const normalDistance = board.getShortestPathLength(human.x, human.y, human.targetY, human.targetX, human.id);
    const portalDistance = 1 + board.getShortestPathLength(4, 7, human.targetY, human.targetX);
    assert.ok(portalDistance >= normalDistance, 'Portal should not shorten the human route');
    assert.equal(board.getBotAction(bot.id)?.type, 'move');
  });

  it('2v2 bot does not treat its teammate as a portal threat', () => {
    const board = new Board(9);
    const teammate = new Player('teammate', 'Teammate', false, 4, 6, 0, undefined, 5, 0, '#FF3B30', 1);
    const bot = new Player('bot_teammate', 'Bot', true, 0, 6, 0, undefined, 5, 0, '#FF3B30', 1);
    const enemy = new Player('enemy', 'Enemy', false, 8, 0, 8, undefined, 5, 0, '#007AFF', 2);
    board.addPlayer(teammate);
    board.addPlayer(bot);
    board.addPlayer(enemy);
    board.boosts.push(
      new Boost('portal_a', 'portal', 4, 5, 4, 1),
      new Boost('portal_b', 'portal', 4, 1, 4, 5)
    );

    const action = board.getBotAction(bot.id, true);
    if (action?.type === 'wall') {
      board.walls.push(new Wall('test-teammate-portal', bot.id, action.x, action.y, action.isHorizontal));
      const pathToPortal = board.findShortestPathToGoal(teammate.x, teammate.y, 5, 4);
      assert.equal(pathToPortal.length - 1, 1, 'Bot must not block its teammate from using the portal');
    }
  });

  it('Teardown test environment', async () => {
    await teardownTestEnvironment();
  });
});
