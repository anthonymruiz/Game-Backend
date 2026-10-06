import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { container } from 'tsyringe';
import { RoomService } from '../services/room.service.js';
import { GameInstance } from '../game/engine/game-instance.js';
import { MazeBoard } from '../game/engine/maze-board.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

describe('04 - Multiplayer Modes (4-FFA, 2v2) & Core Game Mechanics Tests', () => {
  let roomService: RoomService;

  before(async () => {
    await setupTestEnvironment();
    roomService = container.resolve(RoomService);
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('Should correctly initialize a 4-FFA (Free-For-All) room with 4 players on 4 borders', () => {
    const room = roomService.createRoom('p1', 'Player1', false, 'FFA Room', '4-FFA');
    roomService.joinRoom(room.id, 'p2', 'Player2', false);
    roomService.joinRoom(room.id, 'p3', 'Player3', true);
    roomService.joinRoom(room.id, 'p4', 'Player4', true);
    Object.assign(room.players[0], {
      pawnColor: '#92400E',
      pawnColorItemId: 'wood-color',
      skinItemId: 'non-tintable-skin',
      skinAllowsColor: false
    });

    assert.equal(room.players.length, 4);
    assert.equal(room.maxPlayers, 4);

    const game = new GameInstance(room.id, room.mode, room.players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    assert.equal(game.board.players.size, 4);
    // Player 1 at top (5, 0), Player 2 at bottom (5, 10), Player 3 at left (0, 5), Player 4 at right (10, 5)
    const p1 = game.board.players.get('p1');
    const p2 = game.board.players.get('p2');
    const p3 = game.board.players.get('p3');
    const p4 = game.board.players.get('p4');

    assert.deepEqual({ x: p1?.x, y: p1?.y }, { x: 5, y: 10 });
    assert.deepEqual({ x: p2?.x, y: p2?.y }, { x: 5, y: 0 });
    assert.deepEqual({ x: p3?.x, y: p3?.y }, { x: 0, y: 5 });
    assert.deepEqual({ x: p4?.x, y: p4?.y }, { x: 10, y: 5 });

    // Each player in 4-FFA starts with 7 walls
    assert.equal(p1?.wallsLeft, 7);
    assert.equal(p2?.wallsLeft, 7);
    assert.equal(p1?.pawnColor, '#92400E');
    assert.equal(game.board.toDTO('p1').players.p1.pawnColor, '#92400E');

    game.destroy();
  });

  it('Should give each player 7 walls in 6-FFA', () => {
    const room = roomService.createRoom('six_ffa_1', 'Player1', false, '6-FFA Room', '6-FFA');
    for (let i = 2; i <= 6; i++) {
      roomService.joinRoom(room.id, `six_ffa_${i}`, `Player${i}`, true);
    }

    const game = new GameInstance(room.id, room.mode, room.players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    assert.equal(game.board.players.size, 6);
    assert.equal(game.board.size, 11);
    const startingPositions = new Set<string>();
    for (const player of game.board.players.values()) {
      assert.equal(player.wallsLeft, 7);
      assert.equal(player.targetX, 5);
      assert.equal(player.targetY, 5);
      assert.ok(
        player.x === 0 || player.y === 0 || player.x === 10 || player.y === 10,
        'Each 6-FFA player should start on the 11x11 board perimeter'
      );
      startingPositions.add(`${player.x},${player.y}`);
    }
    assert.equal(startingPositions.size, 6, 'All six players should have unique starting cells');

    game.destroy();
  });

  it('Should create a six-slot Labyrinth room that can be filled with bots', () => {
    const room = roomService.createRoom('maze_host', 'MazeHost', false, 'Maze room', 'labyrinth');
    assert.equal(room.maxPlayers, 6);
    for (let index = 0; index < 5; index++) {
      roomService.addBotToCustomRoom(room.id, 'maze_host');
    }
    assert.equal(room.players.length, 6);
    assert.equal(room.players.filter(player => player.id.startsWith('bot_')).length, 5);
  });

  it('Should start Labyrinth players centrally, keep roles private, and leave filler bots inactive', async () => {
    const players = [
      { id: 'bot_maze_1', username: 'BOT - Green', isGuest: true, color: '#34C759' },
      { id: 'maze_human_1', username: 'Human1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_human_2', username: 'Human2', isGuest: false, color: '#007AFF' },
      { id: 'maze_human_3', username: 'Human3', isGuest: false, color: '#FFCC00' },
      { id: 'bot_maze_2', username: 'BOT - Purple', isGuest: true, color: '#AF52DE' },
      { id: 'bot_maze_3', username: 'BOT - Orange', isGuest: true, color: '#FF9500' }
    ];
    const game = new GameInstance('maze_start_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    assert.ok(game.board instanceof MazeBoard);
    const mazeBoard = game.board as MazeBoard;
    const positions = [...game.board.players.values()].map(player => `${player.x},${player.y}`);
    assert.equal(new Set(positions).size, 6);
    for (const player of game.board.players.values()) {
      assert.ok(Math.abs(player.x - 5) <= 1);
      assert.ok(Math.abs(player.y - 5) <= 1);
      assert.equal(player.wallsLeft, 0);
    }
    assert.ok(game.board.walls.length > 0);
    assert.equal(game.board.boosts.length, 0);
    assert.equal(mazeBoard.keys.length, 3);
    assert.ok(mazeBoard.isCellCapturable(mazeBoard.keys[0].x, mazeBoard.keys[0].y));
    assert.equal(game.initialSabotageActions, 2);
    assert.equal(game.getMazeGameTimeLimitSeconds(), 300);

    const humanRoles = players
      .filter(player => !player.id.startsWith('bot_'))
      .map(player => game.getPrivateMazeRole(player.id));
    assert.equal(humanRoles.filter(role => role?.role === 'impostor').length, 1);
    assert.equal(humanRoles.filter(role => role?.role === 'good').length, 2);
    assert.ok(humanRoles.every(role =>
      role !== null && role.sabotageActionsRemaining === (role.role === 'impostor' ? 2 : 0)
    ));
    assert.equal(game.getPrivateMazeRole('bot_maze_1'), null);
    assert.equal(JSON.stringify(game.board.toDTO('maze_human_1')).includes('impostor'), false);
    const botPosition = { x: game.board.players.get('bot_maze_1')?.x, y: game.board.players.get('bot_maze_1')?.y };
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepEqual(
      { x: game.board.players.get('bot_maze_1')?.x, y: game.board.players.get('bot_maze_1')?.y },
      botPosition
    );
    assert.equal(game.getCurrentPlayer(), '', 'Labyrinth has no active turn owner');
    game.destroy();
  });

  it('Should allow real-time Labyrinth movement without turn ownership', () => {
    const players = [
      { id: 'maze_realtime_1', username: 'Maze1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_realtime_2', username: 'Maze2', isGuest: false, color: '#007AFF' }
    ];
    let startEvent: any;
    const game = new GameInstance('maze_realtime_test', 'labyrinth', players, (event, data) => {
      if (event === 'gameStarted') startEvent = data;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);

    assert.equal(startEvent.currentTurn, '');
    assert.equal(startEvent.gameTimeLimitSeconds, 300);
    const mazeBoard = game.board as MazeBoard;
    const firstMove = mazeBoard.getMazeValidMoves('maze_realtime_1')[0];
    assert.ok(firstMove);
    assert.equal(game.executeMove('maze_realtime_1', firstMove.x, firstMove.y), true);
    const secondMove = mazeBoard.getMazeValidMoves('maze_realtime_2')[0];
    assert.ok(secondMove);
    assert.equal(game.executeMove('maze_realtime_2', secondMove.x, secondMove.y), true);
    const nextMove = mazeBoard.getMazeValidMoves('maze_realtime_1')[0];
    if (nextMove) {
      assert.equal(game.executeMove('maze_realtime_1', nextMove.x, nextMove.y), false, 'movement is rate-limited per player');
    }
    game.destroy();
  });

  it('Should give the impostor the win when the five-minute Labyrinth timer expires', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    let finishedWinner: string | null = null;
    const game = new GameInstance('maze_timer_test', 'labyrinth', [
      { id: 'maze_timer_1', username: 'Timer1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_timer_2', username: 'Timer2', isGuest: false, color: '#007AFF' }
    ], (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    try {
      game.start();
      for (let minute = 0; minute < 5; minute++) {
        mock.timers.tick(59_000);
        game.recordPlayerActivity('maze_timer_1');
        game.recordPlayerActivity('maze_timer_2');
      }
      mock.timers.tick(4_999);
      assert.equal(game.state, 'playing');
      mock.timers.tick(1);
      assert.equal(game.state, 'finished');
      assert.equal(finishedWinner, game.impostorId);
    } finally {
      game.destroy();
      mock.timers.reset();
    }
  });

  it('Should end the game when the good players cage the impostor', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `maze_cage_${index}`,
      username: `Maze${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    let finishedWinner: string | null = null;
    const game = new GameInstance('maze_cage_impostor_test', 'labyrinth', players, (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    impostor.x = 5;
    impostor.y = 5;
    game.board.grid[5][5].hasPlayer = impostor.id;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const safePositions = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 5, y: 0 }];
    goodPlayers.forEach((player, index) => {
      player.x = safePositions[index].x;
      player.y = safePositions[index].y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });

    const cageWalls = [
      { x: 4, y: 4, horizontal: true },
      { x: 5, y: 5, horizontal: true },
      { x: 4, y: 5, horizontal: false },
      { x: 5, y: 4, horizontal: false }
    ];
    cageWalls.forEach((wall, index) => {
      assert.equal(
        game.placeMazeWall(goodPlayers[index].id, wall.x, wall.y, wall.horizontal, `good_cage_${index}`),
        true
      );
    });
    assert.equal(finishedWinner, 'good');
    assert.equal(impostor.isInPrison, true);
    assert.ok(game.board.walls.filter(wall => wall.isPrisonBlock).length >= 4);
    game.destroy();
  });

  it('Should give the impostor the win when the good team cages a good player by mistake', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `maze_wrong_cage_${index}`,
      username: `Wrong${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    let finishedWinner: string | null = null;
    const game = new GameInstance('maze_wrong_cage_test', 'labyrinth', players, (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = 5;
    target.y = 5;
    game.board.grid[5][5].hasPlayer = target.id;
    goodPlayers.slice(1).forEach((player, index) => {
      const position = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }][index];
      player.x = position.x;
      player.y = position.y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });
    impostor.x = 0;
    impostor.y = 5;
    game.board.grid[5][0].hasPlayer = impostor.id;

    const cageWalls = [
      { x: 4, y: 4, horizontal: true },
      { x: 5, y: 5, horizontal: true },
      { x: 4, y: 5, horizontal: false },
      { x: 5, y: 4, horizontal: false }
    ];
    cageWalls.forEach((wall, index) => {
      assert.equal(
        game.placeMazeWall(goodPlayers[index + 1].id, wall.x, wall.y, wall.horizontal, `wrong_cage_${index}`),
        true
      );
    });
    assert.equal(target.isInPrison, true);
    assert.equal(finishedWinner, impostor.id);
    game.destroy();
  });

  it('Should let each good player break one wall and rescue one captive', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `maze_rescue_${index}`,
      username: `Rescue${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    const game = new GameInstance('maze_rescue_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = 5;
    target.y = 5;
    game.board.grid[5][5].hasPlayer = target.id;
    goodPlayers.slice(1).forEach((player, index) => {
      const position = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }][index];
      player.x = position.x;
      player.y = position.y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });
    impostor.x = 5;
    impostor.y = 0;
    game.board.grid[0][5].hasPlayer = impostor.id;

    const cageWalls = [
      { x: 4, y: 4, horizontal: true },
      { x: 5, y: 5, horizontal: true },
      { x: 4, y: 5, horizontal: false },
      { x: 5, y: 4, horizontal: false }
    ];
    cageWalls.forEach((wall, index) => {
      assert.equal(game.placeMazeWall(impostor.id, wall.x, wall.y, wall.horizontal, `impostor_cage_${index}`), true);
    });
    assert.equal(target.isInPrison, true);
    assert.ok(game.getMazeRescueStatus().availableRescuers >= 3);
    assert.equal(game.rescueMazePlayer(goodPlayers[1].id, target.id), true);
    assert.equal(target.isInPrison, false);
    assert.equal(game.rescueMazePlayer(goodPlayers[1].id, target.id), false, 'a rescuer can rescue only once');
    assert.equal(game.breakMazeBlock(goodPlayers[2].id, game.board.walls[0].id), true);
    assert.equal(game.breakMazeBlock(goodPlayers[2].id, game.board.walls[1]?.id || 'missing'), false, 'a player can break only one block');
    game.destroy();
  });

  it('Should correctly set up a 2v2 Team mode with 2 balanced teams', () => {
    const room = roomService.createRoom('t1', 'User_T1', false, '2v2 Arena', '2v2');
    roomService.joinRoom(room.id, 't2', 'Guest_T2', true);
    roomService.joinRoom(room.id, 't3', 'User_T3', false);
    roomService.joinRoom(room.id, 't4', 'Guest_T4', true);

    assert.equal(room.players.length, 4);
    assert.equal(room.players[0].team, 1);
    assert.equal(room.players[1].team, 2);
    assert.equal(room.players[2].team, 1);
    assert.equal(room.players[3].team, 2);

    const game = new GameInstance(room.id, room.mode, room.players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    assert.equal(game.state, 'playing');
    for (const player of game.board.players.values()) {
      assert.equal(player.wallsLeft, 7);
    }
    game.destroy();
  });

  it('Should terminate a bot match when its human player abandons it', () => {
    const players = [
      { id: 'human', username: 'Human', isGuest: false, color: '#FF3B30' },
      { id: 'bot_1', username: 'BOT 1', isGuest: true, color: '#007AFF' },
      { id: 'bot_2', username: 'BOT 2', isGuest: true, color: '#34C759' },
      { id: 'bot_3', username: 'BOT 3', isGuest: true, color: '#FFCC00' }
    ];
    let finishedEvent: { winner: string | null; abandoned: boolean } | null = null;
    const game = new GameInstance('bot_match_abandon', '4-FFA', players, (event, data) => {
      if (event === 'gameFinished') finishedEvent = data;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.equal(game.hasBots(), true);
    game.abandon();

    assert.equal(game.state, 'finished');
    assert.deepEqual(finishedEvent, { winner: null, durationSeconds: 1, abandoned: true });
    game.destroy();
  });

  it('Should execute valid wall placement and prevent overlapping walls', () => {
    const room = roomService.createRoom('p1', 'Player1', true, 'Wall Room', '1v1');
    roomService.joinRoom(room.id, 'p2', 'Player2', true);

    const game = new GameInstance(room.id, room.mode, room.players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    assert.equal(game.hasSpawnedExchangeItem, true);
    assert.equal(game.board.boosts.some(boost => boost.type === 'exchange_item'), true);

    // Player 1 places a horizontal wall at (2, 2)
    const wall1Success = game.executeWall('p1', 'wall1', 2, 2, true);
    assert.equal(wall1Success, true);

    // Player 2 attempts to place an overlapping wall at (2, 2)
    const wall2Overlap = game.executeWall('p2', 'wall2', 2, 2, true);
    assert.equal(wall2Overlap, false);

    game.destroy();
  });

  it('Should automatically exchange positions after collecting the boost in 1v1 and VS AI', () => {
    for (const mode of ['1v1', 'vs_ai'] as const) {
      const opponentId = mode === 'vs_ai' ? 'bot_opponent' : `opponent_${mode}`;
      const room = roomService.createRoom(`human_${mode}`, 'Human', false, `Exchange ${mode}`, mode);
      roomService.joinRoom(room.id, opponentId, mode === 'vs_ai' ? 'BOT' : 'Opponent', mode === 'vs_ai');

      const emittedEvents: string[] = [];
      let exchangedEvent: any;
      const game = new GameInstance(room.id, room.mode, room.players, (event, data) => {
        emittedEvents.push(event);
        if (event === 'playersExchanged') exchangedEvent = data;
      }, GAME_INSTANCE_TEST_OPTIONS);
      game.start();

      assert.equal(game.hasSpawnedExchangeItem, true);
      const exchangeBoost = game.board.boosts.find(boost => boost.type === 'exchange_item');
      assert.ok(exchangeBoost);

      const human = game.board.players.get(`human_${mode}`)!;
      const opponent = game.board.players.get(opponentId)!;
      const opponentPosition = { x: opponent.x, y: opponent.y };
      const moveToBoost = game.board.getValidMoves(human.id)[0]!;
      game.board.grid[exchangeBoost.y][exchangeBoost.x].hasBoost = null;
      exchangeBoost.x = moveToBoost.x;
      exchangeBoost.y = moveToBoost.y;
      game.board.grid[moveToBoost.y][moveToBoost.x].hasBoost = exchangeBoost.id;

      assert.equal(game.executeMove(human.id, moveToBoost.x, moveToBoost.y), true);
      assert.deepEqual({ x: human.x, y: human.y }, opponentPosition);
      assert.deepEqual({ x: opponent.x, y: opponent.y }, { x: moveToBoost.x, y: moveToBoost.y });
      assert.equal(human.hasExchangeItem, false);
      assert.equal(game.getPendingBoostDecision(), null);
      assert.equal(exchangedEvent.exchangerId, human.id);
      assert.equal(exchangedEvent.targetId, opponent.id);
      assert.ok(emittedEvents.includes('playersExchanged'));
      assert.equal(emittedEvents.includes('boostDecisionStarted'), false);
      assert.equal(emittedEvents.includes('boostDecisionResolved'), false);
      game.destroy();
    }
  });

  it('Should allow spawning random extra wall boosts on the board', () => {
    const room = roomService.createRoom('p1', 'Player1', true, 'Boost Room', '1v1');
    roomService.joinRoom(room.id, 'p2', 'Player2', true);

    const game = new GameInstance(room.id, room.mode, room.players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    game.board.spawnRandomBoost();
    assert.ok(game.board.boosts.length >= 1);

    game.destroy();
  });

  it('Should spawn Killer Item in FFA, eliminate targeted player, skip turn, and declare last survivor winner', () => {
    const room = roomService.createRoom('p1', 'Player1', false, 'Killer FFA', '4-FFA');
    roomService.joinRoom(room.id, 'p2', 'Player2', false);
    roomService.joinRoom(room.id, 'p3', 'Player3', true);
    roomService.joinRoom(room.id, 'p4', 'Player4', true);

    let killEvent: any;
    const game = new GameInstance(room.id, room.mode, room.players, (event, data) => {
      if (event === 'playerKilled') killEvent = data;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    assert.equal(game.hasSpawnedKillerItem, true);
    const killerBoost = game.board.boosts.find(b => b.type === 'killer_item');
    assert.ok(killerBoost);

    // Player 1 obtains killer item and eliminates Player 2
    const p1 = game.board.players.get('p1')!;
    const p2 = game.board.players.get('p2')!;
    p1.hasKillerItem = true;

    assert.equal(game.beginBoostDecision('p1', 'killer_item'), true);
    const killSuccess = game.executeKillerItem('p1', 'p2');
    assert.equal(killSuccess, true);
    assert.equal(p2.isDead, true);
    assert.equal(p1.hasKillerItem, false);
    assert.equal(killEvent.killerId, 'p1');
    assert.equal(killEvent.killerUsername, 'Player1');
    assert.equal(killEvent.targetId, 'p2');
    assert.equal(killEvent.targetUsername, 'Player2');

    // Player 2 cannot take turn or execute moves/walls
    assert.equal(game.executeMove('p2', 5, 1), false);
    assert.equal(game.executeWall('p2', 'w1', 1, 1, true), false);

    // Eliminate p3 and p4
    game.currentTurnIndex = game.playersList.indexOf('p1');
    p1.hasKillerItem = true;
    assert.equal(game.beginBoostDecision('p1', 'killer_item'), true);
    game.executeKillerItem('p1', 'p3');
    game.currentTurnIndex = game.playersList.indexOf('p1');
    p1.hasKillerItem = true;
    assert.equal(game.beginBoostDecision('p1', 'killer_item'), true);
    game.executeKillerItem('p1', 'p4');

    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'p1');

    game.destroy();
  });

  it('Should spawn one exchange item in multiplayer modes and freeze the turn until the selected swap resolves', () => {
    const room = roomService.createRoom('swap1', 'Player1', false, 'Swap 4-FFA', '4-FFA');
    roomService.joinRoom(room.id, 'swap2', 'Player2', false);
    roomService.joinRoom(room.id, 'swap3', 'Player3', false);
    roomService.joinRoom(room.id, 'swap4', 'Player4', false);
    room.players[0].pawnColor = '#92400E';
    room.players[0].pawnColorItemId = 'wood-color';
    room.players[2].id = 'bot_yellow';
    room.players[2].username = 'BOT - Amarillo';
    room.players[2].color = '#FFCC00';

    const emittedEvents: string[] = [];
    let exchangedEvent: any;
    const game = new GameInstance(room.id, room.mode, room.players, (event, data) => {
      emittedEvents.push(event);
      if (event === 'playersExchanged') exchangedEvent = data;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    assert.equal(game.hasSpawnedExchangeItem, true);
    assert.equal(game.board.boosts.filter(boost => boost.type === 'exchange_item').length, 1);
    assert.equal(game.board.boosts.filter(boost => boost.type === 'exchange_item')[0]?.x === 5 &&
      game.board.boosts.filter(boost => boost.type === 'exchange_item')[0]?.y === 5, false);

    const exchanger = game.board.players.get('swap1')!;
    const target = game.board.players.get('bot_yellow')!;
    const exchangeBoost = game.board.boosts.find(boost => boost.type === 'exchange_item')!;
    const exchangeBoostCell = game.board.grid[exchangeBoost.y][exchangeBoost.x];
    exchangeBoostCell.hasBoost = null;
    const moveToBoost = game.board.getValidMoves(exchanger.id)[0]!;
    exchangeBoost.x = moveToBoost.x;
    exchangeBoost.y = moveToBoost.y;
    game.board.grid[moveToBoost.y][moveToBoost.x].hasBoost = exchangeBoost.id;
    const exchangerPosition = { x: moveToBoost.x, y: moveToBoost.y };
    const targetPosition = { x: target.x, y: target.y };

    assert.equal(game.executeMove('swap1', moveToBoost.x, moveToBoost.y), true);
    assert.equal(exchanger.hasExchangeItem, true);
    assert.equal(game.getCurrentPlayer(), 'swap1');
    assert.equal(game.executeMove('swap2', target.x, target.y + 1), false);
    assert.equal(game.executeWall('swap2', 'blocked-wall', 1, 1, true), false);
    assert.equal(game.executeMove('swap1', exchanger.x, exchanger.y + 1), false);
    assert.equal(game.executeWall('swap1', 'blocked-active-wall', 1, 1, true), false);
    assert.equal(game.executeExchangeItem('swap1', 'missing-player'), false);
    assert.equal(exchanger.hasExchangeItem, true);

    assert.equal(game.executeExchangeItem('swap1', 'bot_yellow'), true);
    assert.deepEqual({ x: exchanger.x, y: exchanger.y }, targetPosition);
    assert.deepEqual({ x: target.x, y: target.y }, exchangerPosition);
    assert.equal(game.board.grid[targetPosition.y][targetPosition.x].hasPlayer, exchanger.id);
    assert.equal(game.board.grid[exchangerPosition.y][exchangerPosition.x].hasPlayer, target.id);
    assert.equal(exchanger.isDead, false);
    assert.equal(target.isDead, false);
    assert.equal(game.state, 'playing');
    assert.equal(exchanger.pawnColor, '#92400E');
    assert.equal(exchangedEvent.exchangerId, 'swap1');
    assert.equal(exchangedEvent.exchangerUsername, 'Player1');
    assert.equal(exchangedEvent.targetId, 'bot_yellow');
    assert.equal(exchangedEvent.targetUsername, 'BOT - Amarillo');
    assert.equal(exchangedEvent.board.players.swap1.pawnColor, '#92400E');
    assert.equal(exchangedEvent.board.players.swap1.color, exchanger.color);
    assert.equal(exchangedEvent.board.players.swap1.x, targetPosition.x);
    assert.equal(exchangedEvent.board.players.swap1.y, targetPosition.y);
    assert.equal(exchangedEvent.board.players.bot_yellow.color, '#FFCC00');
    assert.equal(exchangedEvent.board.players.bot_yellow.pawnColor, undefined);
    assert.equal(exchanger.hasExchangeItem, false);
    assert.notEqual(game.getCurrentPlayer(), 'swap1');
    assert.ok(emittedEvents.includes('boostDecisionStarted'));
    assert.ok(emittedEvents.includes('playersExchanged'));
    assert.equal(emittedEvents.includes('playerKilled'), false);
    game.destroy();
  });

  it('Should discard a boost and continue the match when the 10-second selection expires', async () => {
    const room = roomService.createRoom('timeout1', 'Player1', false, 'Swap timeout', '2v2');
    roomService.joinRoom(room.id, 'timeout2', 'Player2', false);
    roomService.joinRoom(room.id, 'timeout3', 'Player3', false);
    roomService.joinRoom(room.id, 'timeout4', 'Player4', false);

    const expiredTypes: string[] = [];
    const game = new GameInstance(room.id, room.mode, room.players, (event, data) => {
      if (event === 'boostDecisionExpired') expiredTypes.push(data.type);
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const player = game.board.players.get('timeout1')!;
    player.hasExchangeItem = true;
    assert.equal(game.beginBoostDecision('timeout1', 'exchange_item'), true);

    await new Promise(resolve => setTimeout(resolve, 10_100));

    assert.deepEqual(expiredTypes, ['exchange_item']);
    assert.equal(player.hasExchangeItem, false);
    assert.equal(game.getCurrentPlayer(), 'timeout2');

    game.currentTurnIndex = game.playersList.indexOf('timeout1');
    player.hasKillerItem = true;
    assert.equal(game.beginBoostDecision('timeout1', 'killer_item'), true);
    await new Promise(resolve => setTimeout(resolve, 10_100));
    assert.deepEqual(expiredTypes, ['exchange_item', 'killer_item']);
    assert.equal(player.hasKillerItem, false);
    assert.notEqual(game.getCurrentPlayer(), 'timeout1');
    game.destroy();
  });
});
