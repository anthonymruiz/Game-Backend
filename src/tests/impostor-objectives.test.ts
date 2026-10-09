import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  GameInstance,
  IMPOSTOR_EMERGENCY_MEETING_ANNOUNCEMENT_MS,
  IMPOSTOR_EMERGENCY_MEETING_COOLDOWN_MS,
  IMPOSTOR_EMERGENCY_MEETING_RESULTS_MS,
  IMPOSTOR_GENERATOR_SABOTAGE_COOLDOWN_MS,
  IMPOSTOR_GENERATOR_REPAIR_DURATION_MS,
  IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE,
  IMPOSTOR_TRAP_COOLDOWN_MS
} from '../game/engine/game-instance.js';
import { ImpostorBoard } from '../game/engine/impostor-board.js';
import { ImpostorRules } from '../game/engine/game-modes.js';
import { Player, Wall } from '../game/engine/models.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

describe('Impostor personal keys, tools, and generators', () => {
  const games: GameInstance[] = [];

  afterEach(() => {
    for (const game of games.splice(0)) game.destroy();
    mock.timers.reset();
  });

  it('pauses the game for emergency voting and only reveals ballots after everyone votes', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
    const players = [
      { id: 'meeting_good', username: 'MeetingGood', isGuest: false, color: '#FF3B30' },
      { id: 'meeting_impostor', username: 'MeetingImpostor', isGuest: false, color: '#007AFF' }
    ];
    const events: string[] = [];
    const game = new GameInstance('impostor_emergency_meeting_test', 'impostor', players, (event) => {
      events.push(event);
    }, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.start();

    const board = game.board as ImpostorBoard;
    const goodId = players.find(player => player.id !== game.impostorId)!.id;
    const impostorId = game.impostorId!;
    const good = board.players.get(goodId)!;
    const impostor = board.players.get(impostorId)!;
    const safeZone = board.size / 2;
    good.x = safeZone;
    good.y = safeZone;
    impostor.x = safeZone - 1;
    impostor.y = safeZone;

    assert.equal(game.getImpostorEmergencyMeetingSecondsRemaining(), 180);
    assert.equal(game.callImpostorEmergencyMeeting(goodId), false);
    assert.equal(board.isSafeZoneCell(good.x, good.y), true);

    for (let elapsed = 0; elapsed < IMPOSTOR_EMERGENCY_MEETING_COOLDOWN_MS; elapsed += 30_000) {
      mock.timers.tick(30_000);
      game.recordPlayerActivity(goodId);
      game.recordPlayerActivity(impostorId);
    }
    assert.equal(game.callImpostorEmergencyMeeting(impostorId), false);
    assert.equal(game.callImpostorEmergencyMeeting(goodId), true);
    assert.equal(game.getImpostorRemainingSeconds(), 300);
    assert.equal(game.callImpostorEmergencyMeeting(impostorId), false);

    mock.timers.tick(IMPOSTOR_EMERGENCY_MEETING_ANNOUNCEMENT_MS);
    assert.equal(game.getImpostorEmergencyMeetingState()?.phase, 'voting');
    assert.equal(game.getImpostorEmergencyMeetingState()?.results, undefined);
    assert.equal(game.voteImpostorEmergencyMeeting(impostorId, goodId), true);
    assert.equal(game.getImpostorEmergencyMeetingState()?.results, undefined);
    assert.equal(game.voteImpostorEmergencyMeeting(goodId, impostorId), true);
    assert.equal(game.getImpostorEmergencyMeetingState()?.phase, 'results');
    assert.equal(game.getImpostorEmergencyMeetingState()?.results?.goodTeamWon, true);

    mock.timers.tick(IMPOSTOR_EMERGENCY_MEETING_RESULTS_MS);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'good');
    assert.ok(events.includes('gameFinished'));
  });

  it('reveals and collects only the owner key with a radar in a powered sector', () => {
    const board = new ImpostorBoard(20);
    const owner = new Player('key_owner', 'Owner', false, 5, 5);
    const other = new Player('key_other', 'Other', false, 5, 6);
    const impostor = new Player('key_impostor', 'Impostor', false, 12, 12);
    board.addPlayer(owner);
    board.addPlayer(other);
    board.addPlayer(impostor);
    board.spawnGenerators();
    board.keys = [
      { id: 'owner_key', ownerId: owner.id, x: 8, y: 8 },
      { id: 'impostor_decoy_key', ownerId: impostor.id, x: 12, y: 12 }
    ];

    assert.deepEqual(board.toDTO(owner.id).keys, []);
    owner.impostorTool = 'radar';
    assert.deepEqual(board.toDTO(owner.id).keys.map(key => key.id), ['owner_key']);
    assert.deepEqual(board.toDTO(other.id).keys, []);
    assert.deepEqual(
      board.toDTO(impostor.id, true).keys.map(key => key.id),
      ['owner_key', 'impostor_decoy_key']
    );
    assert.deepEqual(
      board.toDTO(impostor.id, true).keys.map(key => key.id),
      ['owner_key', 'impostor_decoy_key'],
      'the impostor continues seeing all keys in damaged sectors'
    );

    board.damageGenerator('generator_northwest');
    assert.deepEqual(board.toDTO(owner.id).keys, []);
    assert.equal(board.collectKey(owner.id, 8, 8), null);
    board.damageGenerator('generator_southeast');
    assert.deepEqual(
      board.toDTO(impostor.id, true).keys.map(key => key.id),
      ['owner_key', 'impostor_decoy_key']
    );
    assert.equal(board.collectKey(impostor.id, 12, 12), null);
    assert.equal(board.collectKey(impostor.id, 12, 12, true)?.id, 'impostor_decoy_key');

    board.repairGenerator('generator_northwest');
    owner.x = 8;
    owner.y = 8;
    assert.equal(board.collectKey(owner.id, 8, 8)?.id, 'owner_key');
    assert.equal(board.collectKey(other.id, 8, 8), null);
  });

  it('plays the boost pickup event privately when the impostor collects their own key', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
    const players = [
      { id: 'key_sound_good', username: 'KeySoundGood', isGuest: false, color: '#FF3B30' },
      { id: 'key_sound_impostor', username: 'KeySoundImpostor', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_key_sound_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    const privateEvents: Array<{ playerId: string; event: string; data: unknown }> = [];
    game.onPrivateStateChange = (playerId, event, data) => privateEvents.push({ playerId, event, data });
    game.start();

    const board = game.board as ImpostorBoard;
    const impostorId = game.impostorId!;
    const impostor = board.players.get(impostorId)!;
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    board.walls = [];
    impostor.x = 5;
    impostor.y = 5;
    board.grid[5][5].hasPlayer = impostorId;
    board.keys = [{ id: 'impostor_own_key', ownerId: impostorId, x: 6, y: 5 }];

    assert.equal(game.executeMove(impostorId, 6, 5), true);
    assert.deepEqual(
      privateEvents.filter(({ event }) => event === 'boostCollected'),
      [{ playerId: impostorId, event: 'boostCollected', data: { playerId: impostorId, type: 'key' } }]
    );
  });

  it('returns a replaced tool to its fixed table slot and only drops tools in the safe zone', () => {
    const board = new ImpostorBoard(20);
    const player = new Player('tool_player', 'ToolPlayer', false, 8, 9);
    board.addPlayer(player);
    board.spawnTools();

    const radar = board.tools.find(tool => tool.type === 'radar')!;
    const secondRadar = board.tools.find(tool => tool.type === 'radar' && tool.id !== radar.id)!;
    const hammer = board.tools.find(tool => tool.type === 'hammer')!;
    player.x = radar.x;
    player.y = radar.y - 1;
    assert.equal(board.takeTool(player.id, radar.id), true);
    assert.equal(player.impostorTool, 'radar');
    assert.equal(board.takeTool(player.id, secondRadar.id), false);

    player.x = hammer.x - 1;
    player.y = hammer.y - 1;
    assert.equal(board.takeTool(player.id, hammer.id), true);
    assert.equal(player.impostorTool, 'hammer');
    assert.equal(radar.carriedBy, undefined);
    assert.deepEqual({ x: radar.x, y: radar.y }, { x: 9, y: 9 });

    player.x = 0;
    player.y = 0;
    assert.equal(board.dropTool(player.id), false);
    player.x = 8;
    player.y = 11;
    assert.equal(board.dropTool(player.id), true);
    assert.equal(player.impostorTool, null);
    assert.equal(hammer.carriedBy, undefined);
    assert.deepEqual({ x: hammer.x, y: hammer.y }, { x: 9, y: 11 });
  });

  it('lets nearby players request and transfer tools only after the holder accepts', () => {
    const players = [
      { id: 'tool_requester', username: 'Requester', isGuest: false, color: '#FF3B30' },
      { id: 'tool_holder', username: 'Holder', isGuest: false, color: '#007AFF' }
    ];
    const privateEvents: Array<{ playerId: string; event: string; data: any }> = [];
    const game = new GameInstance('impostor_tool_request_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.onPrivateStateChange = (playerId, event, data) => privateEvents.push({ playerId, event, data });
    game.start();

    const board = game.board as ImpostorBoard;
    const requester = board.players.get('tool_requester')!;
    const holder = board.players.get('tool_holder')!;
    requester.x = 10;
    requester.y = 10;
    holder.x = 11;
    holder.y = 10;
    const hammer = board.tools.find(tool => tool.type === 'hammer')!;
    hammer.carriedBy = holder.id;
    holder.impostorTool = 'hammer';

    assert.equal(game.requestImpostorTool(requester.id, holder.id), true);
    const firstRequest = privateEvents.find(event => event.event === 'impostorToolRequestReceived')!.data;
    assert.deepEqual(
      { playerId: privateEvents.find(event => event.event === 'impostorToolRequestReceived')!.playerId, toolType: firstRequest.toolType },
      { playerId: holder.id, toolType: 'hammer' }
    );
    assert.equal(game.respondToImpostorToolRequest(holder.id, firstRequest.requestId, false), true);
    assert.equal(holder.impostorTool, 'hammer');
    assert.equal(requester.impostorTool, null);
    assert.equal(privateEvents.at(-1)?.event, 'impostorToolRequestResult');
    assert.equal(privateEvents.at(-1)?.data.status, 'denied');

    assert.equal(game.requestImpostorTool(requester.id, holder.id), true);
    const secondRequest = privateEvents.filter(event => event.event === 'impostorToolRequestReceived').at(-1)!.data;
    assert.equal(game.respondToImpostorToolRequest(holder.id, secondRequest.requestId, true), true);
    assert.equal(holder.impostorTool, null);
    assert.equal(requester.impostorTool, 'hammer');
    assert.equal(hammer.carriedBy, requester.id);

    const radar = board.tools.find(tool => tool.type === 'radar')!;
    radar.carriedBy = holder.id;
    holder.impostorTool = 'radar';
    assert.equal(game.requestImpostorTool(requester.id, holder.id), true);
    const swapRequest = privateEvents.filter(event => event.event === 'impostorToolRequestReceived').at(-1)!.data;
    assert.equal(game.respondToImpostorToolRequest(holder.id, swapRequest.requestId, true), true);
    assert.equal(requester.impostorTool, 'radar');
    assert.equal(holder.impostorTool, 'hammer');
    assert.equal(radar.carriedBy, requester.id);
    assert.equal(hammer.carriedBy, holder.id);

    holder.x = requester.x + 1;
    assert.equal(game.requestImpostorTool(requester.id, holder.id), true);
    const expiredByDistance = privateEvents.filter(event =>
      event.event === 'impostorToolRequestReceived'
    ).at(-1)!.data;
    holder.x += 3;
    assert.equal(game.respondToImpostorToolRequest(holder.id, expiredByDistance.requestId, true), true);
    assert.equal(requester.impostorTool, 'radar');
    assert.equal(holder.impostorTool, 'hammer');
    assert.equal(privateEvents.at(-1)?.data.status, 'unavailable');

    requester.x = 5;
    assert.equal(game.requestImpostorTool(requester.id, holder.id), false);
  });

  it('lets players reach tools from the middle of the safe-zone table after dropping one', () => {
    const board = new ImpostorBoard(20);
    const middle = Math.floor(board.size / 2);
    const player = new Player('table_player', 'TablePlayer', false, middle - 2, middle - 1);
    board.addPlayer(player);
    board.spawnTools();
    const radar = board.tools.find(tool => tool.type === 'radar')!;
    const hammer = board.tools.find(tool => tool.type === 'hammer')!;

    assert.equal(board.takeTool(player.id, radar.id), true);
    assert.equal(board.dropTool(player.id), true);
    player.x = middle - 2;
    player.y = middle + 1;
    assert.equal(board.takeTool(player.id, hammer.id), true);
    assert.equal(player.impostorTool, 'hammer');
  });

  it('keeps players out of the tool table while allowing movement around it', () => {
    const board = new ImpostorBoard(20);
    const middle = Math.floor(board.size / 2);
    const player = new Player('table_collision_player', 'TableCollision', false, middle - 2, middle);
    board.addPlayer(player);
    board.spawnTools();
    board.walls = [];

    assert.equal(board.isToolTableCell(middle, middle), true);
    assert.equal(board.moveImpostorPlayer(player.id, middle - 1, middle), false);
    assert.ok(board.getImpostorValidMoves(player.id).every(({ x, y }) =>
      !board.isToolTableCell(x, y)
    ));
    assert.equal(board.moveImpostorPlayer(player.id, middle - 2, middle - 1), true);
  });

  it('spawns every Impostor participant outside the tool table', () => {
    const board = new ImpostorBoard(40);
    board.spawnTools();
    const rules = new ImpostorRules();

    for (let index = 0; index < rules.maxPlayers; index++) {
      const spawn = rules.getPlayerStartConfig(index, rules.maxPlayers, board.size);
      assert.equal(board.isToolTableCell(spawn.startX, spawn.startY), false);
    }
  });

  it('spawns two protected entrances on every two-by-two generator through layout changes', () => {
    const board = new ImpostorBoard(20);
    board.spawnGenerators();
    assert.deepEqual(board.generators.map(({ sector, x, y }) => ({ sector, x, y })), [
      { sector: 'northwest', x: 0, y: 0 },
      { sector: 'northeast', x: 18, y: 0 },
      { sector: 'southwest', x: 0, y: 18 },
      { sector: 'southeast', x: 18, y: 18 }
    ]);

    const doorPassages: Array<Array<[number, number, number, number]>> = [
      [[2, 0, 3, 0], [2, 1, 3, 1], [0, 2, 0, 3], [1, 2, 1, 3],
        [3, 0, 4, 0], [3, 1, 4, 1], [0, 3, 0, 4], [1, 3, 1, 4]],
      [[16, 0, 17, 0], [16, 1, 17, 1], [18, 2, 18, 3], [19, 2, 19, 3],
        [18, 3, 18, 4], [19, 3, 19, 4]],
      [[2, 18, 3, 18], [2, 19, 3, 19], [0, 16, 0, 17], [1, 16, 1, 17],
        [3, 18, 4, 18], [3, 19, 4, 19]],
      [[17, 18, 16, 18], [17, 19, 16, 19], [18, 16, 18, 17], [19, 16, 19, 17]]
    ];
    const assertDoorsRemainOpen = (): void => {
      for (const [outsideX, outsideY, insideX, insideY] of doorPassages.flat()) {
        assert.equal(
          board.isSeparatedByWall(outsideX, outsideY, insideX, insideY),
          false,
          `generator access ${outsideX},${outsideY} -> ${insideX},${insideY} should stay open`
        );
      }
    };

    board.generateRandomImpostorWalls(undefined, () => 0.37);
    assertDoorsRemainOpen();
    assert.deepEqual(board.generators.map(generator => board.isGeneratorCell(generator.x, generator.y)), [
      true, true, true, true
    ]);
    assert.equal(board.isGeneratorCell(2, 2), false);
    assert.equal(board.canPlaceWall(new Wall('generator_access_block', 'test', 2, 3, true)), false);
    for (const generator of board.generators) {
      for (const wall of board.walls) {
        const passages = wall.isHorizontal
          ? [
              [wall.x, wall.y, wall.x, wall.y + 1],
              [wall.x + 1, wall.y, wall.x + 1, wall.y + 1]
            ]
          : [
              [wall.x, wall.y, wall.x + 1, wall.y],
              [wall.x, wall.y + 1, wall.x + 1, wall.y + 1]
            ];
        assert.equal(passages.some(([x1, y1, x2, y2]) =>
          board.isGeneratorCell(x1, y1) || board.isGeneratorCell(x2, y2)
        ), false, `wall ${wall.id} must not cover ${generator.id}`);
      }
    }
    const assertWallCoverage = (): void => {
      for (let regionY = 0; regionY < board.size - 1; regionY += 4) {
        for (let regionX = 0; regionX < board.size - 1; regionX += 4) {
          if ((regionX === 8 && regionY === 8) ||
              (regionX === 0 && regionY === 0) ||
              (regionX === board.size - 4 && regionY === 0) ||
              (regionX === 0 && regionY === board.size - 4) ||
              (regionX === board.size - 4 && regionY === board.size - 4)) continue;
          assert.ok(board.walls.filter(wall =>
            wall.x >= regionX && wall.x < regionX + 4 &&
            wall.y >= regionY && wall.y < regionY + 4
          ).length >= 3, `expected three walls in region ${regionX},${regionY}`);
        }
      }
    };
    assertWallCoverage();
    board.reshuffleImpostor(() => 0.37, false, true);
    assertDoorsRemainOpen();
    assertWallCoverage();
  });

  it('keeps generator footprints and repair approaches clear across varied generated layouts', () => {
    const ungeneratedBoard = new ImpostorBoard(20);
    ungeneratedBoard.spawnGenerators();
    assert.equal(ungeneratedBoard.canPlaceWall(new Wall('wall_inside_generator', 'impostor', 0, 0, true)), false);
    assert.equal(ungeneratedBoard.canPlaceWall(new Wall('wall_over_generator_edge', 'impostor', 2, 0, false)), false);

    for (const size of [20, 40]) {
      for (let seed = 1; seed <= 6; seed++) {
        let value = seed;
        const random = (): number => {
          value = (value * 16807) % 2147483647;
          return (value - 1) / 2147483646;
        };
        const board = new ImpostorBoard(size);
        board.spawnGenerators();
        board.generateRandomImpostorWalls(undefined, random);

        const assertGeneratorAccess = (): void => {
          for (const generator of board.generators) {
            const approachCells = [
              { x: generator.x - 1, y: generator.y },
              { x: generator.x - 1, y: generator.y + 1 },
              { x: generator.x + 2, y: generator.y },
              { x: generator.x + 2, y: generator.y + 1 },
              { x: generator.x, y: generator.y - 1 },
              { x: generator.x + 1, y: generator.y - 1 },
              { x: generator.x, y: generator.y + 2 },
              { x: generator.x + 1, y: generator.y + 2 }
            ];
            assert.ok(approachCells.some(({ x, y }) =>
              x >= 0 && x < board.size && y >= 0 && y < board.size &&
              !board.isSeparatedByWall(x, y,
                x < generator.x ? x + 1 : x > generator.x + 1 ? x - 1 : x,
                y < generator.y ? y + 1 : y > generator.y + 1 ? y - 1 : y)
            ), `${generator.id} should remain reachable in size ${size}, seed ${seed}`);
          }
        };
        assertGeneratorAccess();

        board.reshuffleImpostor(random, false, true);
        assertGeneratorAccess();
        for (const generator of board.generators) {
          assert.equal(board.walls.some(wall => {
            const passages = wall.isHorizontal
              ? [
                  [wall.x, wall.y, wall.x, wall.y + 1],
                  [wall.x + 1, wall.y, wall.x + 1, wall.y + 1]
                ]
              : [
                  [wall.x, wall.y, wall.x + 1, wall.y],
                  [wall.x, wall.y + 1, wall.x + 1, wall.y + 1]
                ];
            return passages.some(([x1, y1, x2, y2]) =>
              board.isGeneratorCell(x1, y1) || board.isGeneratorCell(x2, y2)
            );
          }), false, `${generator.id} must stay clear after reshuffle in size ${size}, seed ${seed}`);
        }
      }
    }
  });

  it('keeps generator cells inaccessible to movement, including jumps', () => {
    const board = new ImpostorBoard(20);
    board.spawnGenerators();
    const player = new Player('generator_access_player', 'GeneratorAccess', false, 2, 0);
    board.addPlayer(player);
    board.walls = [];

    assert.equal(board.isAdjacentToGenerator(board.generators[0], player.x, player.y), true);
    assert.equal(board.moveImpostorPlayer(player.id, 1, 0), false);
    assert.equal(board.getImpostorValidMoves(player.id).some(({ x, y }) => board.isGeneratorCell(x, y)), false);
    assert.equal(board.isAdjacentToGenerator(board.generators[0], 0, 0), false);
  });

  it('assigns four non-overlapping powered sectors to the four generators', () => {
    const board = new ImpostorBoard(20);
    board.spawnGenerators();
    const sectorCounts = new Map<string, number>();
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const sector = board.getGeneratorSector(x, y);
        sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
      }
    }

    assert.deepEqual([...sectorCounts.values()], [100, 100, 100, 100]);
    assert.equal(board.generators.length, 4);
    assert.ok(board.generators.every(generator => !generator.isDamaged));
    assert.equal(board.damageGenerator('generator_northeast')?.sector, 'northeast');
    assert.equal(board.isCellPowered(19, 0), false);
    assert.equal(board.isCellPowered(0, 19), true);
  });

  it('preserves objectives and traps while removing player walls during a reshuffle', () => {
    const board = new ImpostorBoard(20);
    board.spawnGenerators();
    board.spawnTools();
    board.keys = [{ id: 'fixed_key', ownerId: 'good', x: 2, y: 2 }];
    board.traps = [{ id: 'fixed_trap', type: 'ice', x: 3, y: 3 }];
    board.walls.push(new Wall('manual_block', 'impostor', 1, 1, true));
    const keyPosition = { x: board.keys[0].x, y: board.keys[0].y };
    const generatorPositions = board.generators.map(({ x, y }) => ({ x, y }));
    const toolPositions = board.tools.map(({ x, y }) => ({ x, y }));

    board.reshuffleImpostor(() => 0.37, false, true);

    assert.equal(board.walls.some(wall => wall.id === 'manual_block'), false);
    assert.deepEqual({ x: board.keys[0].x, y: board.keys[0].y }, keyPosition);
    assert.deepEqual(board.traps.map(({ id }) => id), ['fixed_trap']);
    assert.deepEqual(board.generators.map(({ x, y }) => ({ x, y })), generatorPositions);
    assert.deepEqual(board.tools.map(({ x, y }) => ({ x, y })), toolPositions);
    assert.equal(board.teleports.length, 0);
  });

  it('sabotages generators remotely and requires a timed wrench repair', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
    const players = [
      { id: 'repair_good', username: 'RepairGood', isGuest: false, color: '#FF3B30' },
      { id: 'repair_other', username: 'RepairOther', isGuest: false, color: '#007AFF' },
      { id: 'repair_impostor', username: 'RepairImpostor', isGuest: false, color: '#FFCC00' }
    ];
    const events: Array<{ playerId: string; event: string }> = [];
    const game = new GameInstance('impostor_generator_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.onPrivateStateChange = (playerId, event) => events.push({ playerId, event });
    game.start();

    const board = game.board as ImpostorBoard;
    const impostorId = game.impostorId!;
    const good = board.players.get(players.find(player => player.id !== impostorId)!.id)!;
    const impostor = board.players.get(impostorId)!;
    const generator = board.generators[0];
    const radar = board.tools.find(tool => tool.type === 'radar')!;
    board.grid[impostor.y][impostor.x].hasPlayer = null;
    impostor.x = radar.x - 1;
    impostor.y = radar.y;
    board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;
    assert.equal(game.takeImpostorTool(impostorId, radar.id), true);
    assert.equal(game.dropImpostorTool(impostorId), true);
    assert.equal(impostor.impostorTool, null);
    assert.equal(game.takeImpostorTool(impostorId, radar.id), true);

    board.keys.push({ id: 'good_key_in_dark_sector', ownerId: good.id, x: 1, y: 1 });
    good.impostorTool = 'wrench';
    assert.equal(game.damageImpostorGenerator(impostorId, generator.id), true);
    assert.equal(generator.isDamaged, true);
    assert.deepEqual(
      game.getImpostorStateDataForPlayer(impostorId).board.keys.map(key => key.id)
        .includes('good_key_in_dark_sector'),
      true
    );

    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    good.x = generator.x + 2;
    good.y = generator.y;
    board.grid[good.y][good.x].hasPlayer = good.id;
    assert.equal(game.beginImpostorGeneratorRepair(good.id, generator.id), true);
    mock.timers.tick(IMPOSTOR_GENERATOR_REPAIR_DURATION_MS - 1);
    assert.equal(generator.isDamaged, true);
    mock.timers.tick(1);
    assert.equal(generator.isDamaged, false);

    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    impostor.x = generator.x + 2;
    impostor.y = generator.y;
    impostor.impostorTool = 'wrench';
    board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;
    board.damageGenerator(generator.id);
    assert.equal(game.beginImpostorGeneratorRepair(impostor.id, generator.id), true);
    mock.timers.tick(IMPOSTOR_GENERATOR_REPAIR_DURATION_MS);
    assert.equal(generator.isDamaged, false);
    assert.deepEqual(events
      .filter(({ event }) => event.startsWith('impostorGeneratorRepair'))
      .map(({ playerId, event }) => ({ playerId, event })), [
      { playerId: good.id, event: 'impostorGeneratorRepairStarted' },
      { playerId: good.id, event: 'impostorGeneratorRepairEnded' },
      { playerId: impostor.id, event: 'impostorGeneratorRepairStarted' },
      { playerId: impostor.id, event: 'impostorGeneratorRepairEnded' }
    ]);
  });

  it('allows only one generator sabotage per minute', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
    const players = [
      { id: 'sabotage_good', username: 'Good', isGuest: false, color: '#FF3B30' },
      { id: 'sabotage_impostor', username: 'Impostor', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_generator_cooldown_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.start();
    const board = game.board as ImpostorBoard;
    const impostorId = game.impostorId!;
    const [firstGenerator, secondGenerator] = board.generators;

    assert.equal(game.damageImpostorGenerator(impostorId, firstGenerator.id), true);
    assert.equal(game.getImpostorStateDataForPlayer(impostorId).impostorGeneratorSabotageSecondsRemaining, 60);
    assert.equal(game.damageImpostorGenerator(impostorId, secondGenerator.id), false);
    mock.timers.tick(IMPOSTOR_GENERATOR_SABOTAGE_COOLDOWN_MS - 1);
    assert.equal(game.getImpostorStateDataForPlayer(impostorId).impostorGeneratorSabotageSecondsRemaining, 1);
    game.recordPlayerActivity(impostorId);
    mock.timers.tick(1);
    assert.equal(game.damageImpostorGenerator(impostorId, secondGenerator.id), true);
  });

  it('limits each trap type to five active traps and allows the impostor to remove one', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
    const players = [
      { id: 'trap_good', username: 'TrapGood', isGuest: false, color: '#FF3B30' },
      { id: 'trap_impostor', username: 'TrapImpostor', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_trap_inventory_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.start();
    const board = game.board as ImpostorBoard;
    board.walls = [];
    const impostorId = game.impostorId!;
    const trapCells = board.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .filter(({ x, y }) => board.canPlaceTrap(x, y))
      .slice(0, IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE + 1);
    assert.equal(trapCells.length, IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE + 1);

    for (let index = 0; index < IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE; index++) {
      if (index > 0) mock.timers.tick(IMPOSTOR_TRAP_COOLDOWN_MS);
      const cell = trapCells[index];
      assert.equal(game.placeImpostorTrap(impostorId, 'ice', cell.x, cell.y), true);
    }
    assert.equal(board.traps.filter(trap => trap.type === 'ice').length, 5);
    mock.timers.tick(IMPOSTOR_TRAP_COOLDOWN_MS);
    const replacementCell = trapCells[IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE];
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', replacementCell.x, replacementCell.y), false,
      'the sixth trap is rejected while five are active');
    assert.equal(game.removeImpostorTrap(impostorId, board.traps[0].id), true);
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', replacementCell.x, replacementCell.y), true);
    assert.equal(board.traps.filter(trap => trap.type === 'ice').length, 5);
  });

  it('ends the good-team objective only after every good player returns with their own key', async () => {
    const players = [
      { id: 'good_one', username: 'GoodOne', isGuest: false, color: '#FF3B30' },
      { id: 'good_two', username: 'GoodTwo', isGuest: false, color: '#007AFF' },
      { id: 'impostor_player', username: 'Impostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('impostor_return_objective_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.start();

    const board = game.board as ImpostorBoard;
    board.walls = [];
    const middle = Math.floor(board.size / 2);
    const goodPlayers = players
      .filter(candidate => candidate.id !== game.impostorId)
      .map(candidate => board.players.get(candidate.id)!);
    const impostor = board.players.get(game.impostorId!)!;
    const impostorView = game.getImpostorStateDataForPlayer(impostor.id);
    assert.equal(impostorView.board.keys.length, 3);
    assert.deepEqual(
      impostorView.board.keys.map(key => key.ownerId).sort(),
      [...goodPlayers.map(player => player.id), impostor.id].sort()
    );
    assert.deepEqual(game.getImpostorStateDataForPlayer(goodPlayers[0].id).board.keys, []);
    board.grid.forEach(row => row.forEach(cell => { cell.hasPlayer = null; }));
    goodPlayers.forEach((player, index) => {
      player.isInPrison = false;
      player.hasImpostorKey = true;
      player.x = middle + (index === 0 ? -2 : 2);
      player.y = middle - 1;
      board.grid[player.y][player.x].hasPlayer = player.id;
    });
    impostor.isInPrison = false;
    impostor.hasImpostorKey = true;
    impostor.x = middle + 3;
    impostor.y = middle - 1;
    board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;
    assert.equal(board.keys.some(key => key.ownerId === impostor.id), true);

    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(game.executeMove(impostor.id, impostor.x, middle), true);
    assert.equal(impostor.hasImpostorKey, false);
    assert.equal(impostor.hasImpostorKeyDelivered, true);
    assert.equal(impostor.hasImpostorEscaped, false);
    assert.equal(game.state, 'playing');
    assert.equal(game.getImpostorStateDataForPlayer(impostor.id).impostorGoodPlayersReturned, 1);
    assert.equal(
      game.getImpostorStateDataForPlayer('good_one').board.players[impostor.id]
        .hasImpostorKeyDelivered,
      true
    );

    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(game.executeMove(goodPlayers[0].id, goodPlayers[0].x, middle), true);
    assert.equal(game.state, 'playing');
    assert.equal(goodPlayers[0].hasImpostorEscaped, true);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(game.executeMove(goodPlayers[1].id, goodPlayers[1].x, middle), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'good');
  });
});
