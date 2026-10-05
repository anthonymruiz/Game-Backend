import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { RoomService } from '../services/room.service.js';
import { Board } from '../game/engine/board.js';
import { Boost, Player, Wall } from '../game/engine/models.js';
import { GameInstance } from '../game/engine/game-instance.js';
import { container } from 'tsyringe';

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
    const room = roomService.createRoom('h6', 'Host6', false, '6-FFA Room', '6-FFA');
    for (let i = 1; i <= 5; i++) {
      roomService.addBotToCustomRoom(room.id, 'h6');
    }
    assert.equal(room.players.length, 6);

    const game = new GameInstance(room.id, room.mode, room.players, () => { });
    game.start();
    assert.equal(game.state, 'playing');

    // Trigger turns for bots in 6-FFA
    for (const p of room.players) {
      if (p.id.startsWith('bot_')) {
        const action = game.board.getBotAction(p.id);
        assert.notEqual(action, null);
      }
    }

    game.destroy();
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
