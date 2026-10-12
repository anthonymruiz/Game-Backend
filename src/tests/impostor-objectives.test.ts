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
    assert.equal(game.getImpostorRemainingSeconds(), 420);
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
    const magnifier = board.tools.find(tool => tool.type === 'magnifier')!;
    const hammer = board.tools.find(tool => tool.type === 'hammer')!;
    player.x = radar.x;
    player.y = radar.y - 1;
    assert.equal(board.takeTool(player.id, radar.id), true);
    assert.equal(player.impostorTool, 'radar');
    assert.equal(board.takeTool(player.id, radar.id), false);

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

  it('lets players request and transfer the radar from the central table after the grace period', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
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
    const middle = Math.floor(board.size / 2);
    const requester = board.players.get('tool_requester')!;
    const holder = board.players.get('tool_holder')!;
    const radar = board.tools.find(tool => tool.type === 'radar')!;
    holder.x = middle - 1;
    holder.y = middle - 2;
    assert.equal(game.takeImpostorTool(holder.id, radar.id), true);
    holder.x = middle + 3;
    holder.y = middle + 3;

    requester.x = middle - 2;
    requester.y = middle - 1;

    // Before grace period expires (30s), request is rejected
    assert.equal(game.requestImpostorTool(requester.id), false);

    // Advance 30 seconds
    mock.timers.tick(30_000);

    // Request from table succeeds
    assert.equal(game.requestImpostorTool(requester.id), true);
    const firstRequest = privateEvents.find(event => event.event === 'impostorToolRequestReceived')!.data;
    assert.deepEqual(
      { playerId: privateEvents.find(event => event.event === 'impostorToolRequestReceived')!.playerId, toolType: firstRequest.toolType },
      { playerId: holder.id, toolType: 'radar' }
    );

    // Holder accepts -> radar transferred immediately
    assert.equal(game.respondToImpostorToolRequest(holder.id, firstRequest.requestId, true), true);
    assert.equal(holder.impostorTool, null);
    assert.equal(requester.impostorTool, 'radar');
    assert.equal(radar.carriedBy, requester.id);
    assert.equal(privateEvents.at(-1)?.event, 'impostorToolRequestResult');
    assert.equal(privateEvents.at(-1)?.data.status, 'accepted');

    // Requester now has 30s grace period
    holder.x = middle - 2;
    holder.y = middle - 1;
    assert.equal(game.requestImpostorTool(holder.id), false);

    // Advance 30s
    mock.timers.tick(30_000);

    // Holder requests radar and lets the 5s timeout auto-transfer it
    assert.equal(game.requestImpostorTool(holder.id), true);
    const secondRequest = privateEvents.filter(event => event.event === 'impostorToolRequestReceived').at(-1)!.data;
    mock.timers.tick(5_000);
    assert.equal(holder.impostorTool, 'radar');
    assert.equal(requester.impostorTool, null);
    assert.equal(radar.carriedBy, holder.id);
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
    assert.equal(board.isToolTableCell(middle + 1, middle + 1), true);
    assert.equal(board.isToolTableCell(middle - 1, middle), false);
    // Player moves to cell adjacent to table (middle - 1, middle) successfully
    assert.equal(board.moveImpostorPlayer(player.id, middle - 1, middle), true);
    // Player cannot step onto the tool table cell (middle, middle)
    assert.equal(board.moveImpostorPlayer(player.id, middle, middle), false);
    assert.ok(board.getImpostorValidMoves(player.id).every(({ x, y }) =>
      !board.isToolTableCell(x, y)
    ));
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

  it('spawns three-by-three generators with protected entrances through layout changes', () => {
    const board = new ImpostorBoard(20);
    board.spawnGenerators();
    assert.deepEqual(board.generators.map(({ sector, x, y }) => ({ sector, x, y })), [
      { sector: 'northwest', x: 0, y: 0 },
      { sector: 'northeast', x: 17, y: 0 },
      { sector: 'southwest', x: 0, y: 17 },
      { sector: 'southeast', x: 17, y: 17 }
    ]);

    const doorPassages: Array<Array<[number, number, number, number]>> = [
      [[3, 0, 4, 0], [3, 1, 4, 1], [3, 2, 4, 2],
        [0, 3, 0, 4], [1, 3, 1, 4], [2, 3, 2, 4]],
      [[16, 0, 15, 0], [16, 1, 15, 1],
        [17, 3, 17, 4], [18, 3, 18, 4], [19, 3, 19, 4]],
      [[3, 17, 4, 17], [3, 18, 4, 18], [3, 19, 4, 19],
        [0, 16, 0, 15], [1, 16, 1, 15], [2, 16, 2, 15]],
      [[16, 17, 15, 17], [16, 18, 15, 18], [16, 19, 15, 19],
        [17, 16, 17, 15], [18, 16, 18, 15], [19, 16, 19, 15]]
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
    assert.equal(board.isGeneratorCell(2, 2), true);
    assert.equal(board.isGeneratorCell(3, 2), false);
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
          const overlapsSafeZone = [
            [regionX + 1, regionY + 1],
            [regionX + 3, regionY + 1],
            [regionX + 1, regionY + 3],
            [regionX + 3, regionY + 3]
          ].some(([x, y]) => board.isSafeZoneCell(x, y));
          if ((regionX === 8 && regionY === 8) ||
              (regionX === 0 && regionY === 0) ||
              (regionX === board.size - 4 && regionY === 0) ||
              (regionX === 0 && regionY === board.size - 4) ||
              (regionX === board.size - 4 && regionY === board.size - 4) ||
              overlapsSafeZone) continue;
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
              { x: generator.x - 1, y: generator.y + 2 },
              { x: generator.x + 3, y: generator.y },
              { x: generator.x + 3, y: generator.y + 1 },
              { x: generator.x + 3, y: generator.y + 2 },
              { x: generator.x, y: generator.y - 1 },
              { x: generator.x + 1, y: generator.y - 1 },
              { x: generator.x + 2, y: generator.y - 1 },
              { x: generator.x, y: generator.y + 3 },
              { x: generator.x + 1, y: generator.y + 3 },
              { x: generator.x + 2, y: generator.y + 3 }
            ];
            assert.ok(approachCells.some(({ x, y }) =>
              x >= 0 && x < board.size && y >= 0 && y < board.size &&
              !board.isSeparatedByWall(x, y,
                x < generator.x ? x + 1 : x > generator.x + 2 ? x - 1 : x,
                y < generator.y ? y + 1 : y > generator.y + 2 ? y - 1 : y)
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
    const player = new Player('generator_access_player', 'GeneratorAccess', false, 3, 0);
    board.addPlayer(player);
    board.walls = [];

    assert.equal(board.isAdjacentToGenerator(board.generators[0], player.x, player.y), true);
    assert.equal(board.moveImpostorPlayer(player.id, 2, 0), false);
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
    good.x = generator.x + 3;
    good.y = generator.y;
    board.grid[good.y][good.x].hasPlayer = good.id;
    assert.equal(game.beginImpostorGeneratorRepair(good.id, generator.id), true);
    mock.timers.tick(IMPOSTOR_GENERATOR_REPAIR_DURATION_MS - 1);
    assert.equal(generator.isDamaged, true);
    mock.timers.tick(1);
    assert.equal(generator.isDamaged, false);

    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    impostor.x = generator.x + 3;
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

  it('allows wrench repairs of sabotaged doors from both sides and awards the impostor for sealing all four', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
    const players = [
      { id: 'door_good', username: 'DoorGood', isGuest: false, color: '#FF3B30' },
      { id: 'door_impostor', username: 'DoorImpostor', isGuest: false, color: '#007AFF' }
    ];
    const repairGame = new GameInstance('impostor_door_repair_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(repairGame);
    const privateEvents: string[] = [];
    repairGame.onPrivateStateChange = (_playerId, event) => privateEvents.push(event);
    repairGame.start();
    const board = repairGame.board as ImpostorBoard;
    const good = board.players.get('door_good')!;
    const [northDoor, eastDoor] = board.exits;
    good.impostorTool = 'wrench';

    board.sealImpostorExit(northDoor.id);
    good.x = northDoor.x;
    good.y = northDoor.y - 1;
    assert.equal(board.isAdjacentToImpostorExit(northDoor, good.x, good.y), true);
    assert.equal(repairGame.beginImpostorDoorRepair(good.id, northDoor.id), true);
    mock.timers.tick(IMPOSTOR_GENERATOR_REPAIR_DURATION_MS);
    assert.equal(northDoor.isSealed, false);

    board.sealImpostorExit(eastDoor.id);
    good.x = eastDoor.x - 1;
    good.y = eastDoor.y;
    assert.equal(board.isAdjacentToImpostorExit(eastDoor, good.x, good.y), true);
    assert.equal(repairGame.beginImpostorDoorRepair(good.id, eastDoor.id), true);
    mock.timers.tick(IMPOSTOR_GENERATOR_REPAIR_DURATION_MS);
    assert.equal(eastDoor.isSealed, false);
    assert.deepEqual(privateEvents.filter(event => event.startsWith('impostorDoorRepair')), [
      'impostorDoorRepairStarted',
      'impostorDoorRepairEnded',
      'impostorDoorRepairStarted',
      'impostorDoorRepairEnded'
    ]);

    const winGame = new GameInstance('impostor_doors_win_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(winGame);
    winGame.start();
    const winBoard = winGame.board as ImpostorBoard;
    const impostorId = winGame.impostorId!;
    for (const exit of winBoard.exits.slice(0, -1)) winBoard.sealImpostorExit(exit.id);
    const lastDoor = winBoard.exits[winBoard.exits.length - 1];
    assert.equal(winGame.sabotageImpostorDoor(impostorId, lastDoor.id), true);
    assert.equal(winBoard.exits.every(exit => exit.isSealed), true);
    assert.equal(winGame.winner, impostorId);
    assert.equal(winGame.state, 'finished');
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
    const sixthCell = trapCells[IMPOSTOR_MAX_ACTIVE_TRAPS_PER_TYPE];
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', sixthCell.x, sixthCell.y), true,
      'the sixth trap is now allowed with unlimited traps');
    assert.equal(board.traps.filter(trap => trap.type === 'ice').length, 6);
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

  it('reveals traps with magnifier within distance 3 in powered sectors, broadcasts announcement, and allows wrench deactivation', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000 });
    const players = [
      { id: 'investigator_player', username: 'Investigator', isGuest: false, color: '#FF3B30' },
      { id: 'technician_player', username: 'Technician', isGuest: false, color: '#007AFF' },
      { id: 'impostor_trap_maker', username: 'TrapMaker', isGuest: false, color: '#FFCC00' }
    ];
    const publicEvents: Array<{ event: string; data: any }> = [];
    const privateEvents: Array<{ playerId: string; event: string; data: any }> = [];
    const game = new GameInstance('impostor_reveal_deactivate_test', 'impostor', players, (event, data) => {
      publicEvents.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.onPrivateStateChange = (playerId, event, data) => privateEvents.push({ playerId, event, data });
    game.start();

    const board = game.board as ImpostorBoard;
    board.walls = [];
    const impostorId = game.impostorId!;
    const goodPlayers = players.filter(p => p.id !== impostorId);
    const investigator = board.players.get(goodPlayers[0].id)!;
    const technician = board.players.get(goodPlayers[1].id)!;

    // Place a trap at (5, 5) which is in the northwest powered sector
    const trapX = 5;
    const trapY = 5;
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', trapX, trapY), true);
    const placedTrap = board.traps.find(t => t.x === trapX && t.y === trapY)!;
    assert.ok(placedTrap);
    assert.equal(placedTrap.isRevealed, undefined);

    // Good players without magnifier or revealed traps do not receive trap state
    assert.equal(game.getPrivateImpostorTrapState(technician.id), null);

    // Impostor always sees the trap
    const impostorTrapState = game.getPrivateImpostorTrapState(impostorId);
    assert.equal(impostorTrapState?.traps.length, 1);
    assert.equal(impostorTrapState?.traps[0].id, placedTrap.id);

    // Technician with hammer cannot deactivate an unrevealed trap
    technician.impostorTool = 'hammer';
    technician.x = trapX + 1;
    technician.y = trapY;
    assert.equal(game.beginImpostorTrapDeactivation(technician.id, placedTrap.id), false);

    // Player without magnifier cannot reveal the trap
    investigator.impostorTool = 'radar';
    investigator.x = trapX + 2;
    investigator.y = trapY;
    assert.equal(game.revealImpostorTrap(investigator.id, placedTrap.id), false);

    // Investigator with magnifier but too far (>3 distance) cannot reveal
    investigator.impostorTool = 'magnifier';
    investigator.x = trapX + 4;
    investigator.y = trapY;
    assert.equal(game.revealImpostorTrap(investigator.id, placedTrap.id), false);

    // Investigator in dark/unpowered sector cannot reveal
    board.damageGenerator('generator_northwest');
    investigator.x = trapX + 2;
    investigator.y = trapY;
    assert.equal(game.revealImpostorTrap(investigator.id, placedTrap.id), false);

    // Repair generator -> powered sector again -> reveal succeeds
    board.repairGenerator('generator_northwest');
    assert.equal(game.revealImpostorTrap(investigator.id, placedTrap.id), true);
    assert.equal(placedTrap.isRevealed, true);

    // Public event broadcasted
    assert.ok(publicEvents.some(e =>
      e.event === 'impostorPublicEvent' &&
      e.data?.type === 'trap_revealed' &&
      e.data?.playerName === investigator.username &&
      e.data?.trapType === 'ice'
    ));

    // Now technician receives the revealed trap
    const technicianTrapStateAfter = game.getPrivateImpostorTrapState(technician.id);
    assert.equal(technicianTrapStateAfter?.traps.length, 1);
    assert.equal(technicianTrapStateAfter?.traps[0].id, placedTrap.id);
    assert.equal(technicianTrapStateAfter?.traps[0].isRevealed, true);

    // Technician with hammer adjacent to the revealed trap can now begin deactivation
    assert.equal(game.beginImpostorTrapDeactivation(technician.id, placedTrap.id), true);
    assert.ok(privateEvents.some(e => e.playerId === technician.id && e.event === 'impostorTrapDeactivationStarted'));

    // Advance 5 seconds
    mock.timers.tick(5000);
    assert.ok(privateEvents.some(e => e.playerId === technician.id && e.event === 'impostorTrapDeactivationEnded'));
    assert.ok(publicEvents.some(e =>
      e.event === 'impostorPublicEvent' &&
      e.data?.type === 'trap_deactivated' &&
      e.data?.playerName === technician.username
    ));
    assert.equal(board.traps.length, 0);
  });

  it('strictly limits tool requests and transfers to the safe zone', () => {
    const players = [
      { id: 'sz_requester', username: 'SZRequester', isGuest: false, color: '#FF3B30' },
      { id: 'sz_holder', username: 'SZHolder', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_safe_zone_tool_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    games.push(game);
    game.start();

    const board = game.board as ImpostorBoard;
    const middle = Math.floor(board.size / 2);
    const requester = board.players.get('sz_requester')!;
    const holder = board.players.get('sz_holder')!;
    const radar = board.tools.find(tool => tool.type === 'radar')!;
    radar.carriedBy = holder.id;
    holder.impostorTool = 'radar';

    // Outside safe zone: request fails
    requester.x = 2;
    requester.y = 2;
    holder.x = 2;
    holder.y = 3;
    assert.equal(board.isSafeZoneCell(requester.x, requester.y), false);
    assert.equal(game.requestImpostorTool(requester.id, holder.id), false);

    // Requester inside safe zone: request succeeds
    requester.x = middle - 2;
    requester.y = middle - 1;
    assert.equal(board.isSafeZoneCell(requester.x, requester.y), true);
    assert.equal(board.isAdjacentToToolTable(requester.x, requester.y), true);
    assert.equal(game.requestImpostorTool(requester.id, holder.id), true);
  });

  it('tracks footprints for the impostor outside safe zone and emits them to players holding magnifier', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 10_000 });
    const players = [
      { id: 'fp_good', username: 'GoodInvestigator', isGuest: false, color: '#FF3B30' },
      { id: 'fp_impostor', username: 'ImpostorWalker', isGuest: false, color: '#007AFF' }
    ];
    const privateEvents: Array<{ playerId: string; event: string; data: any }> = [];
    const game = new GameInstance('impostor_footprint_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.onPrivateStateChange = (playerId, event, data) => {
      privateEvents.push({ playerId, event, data });
    };
    games.push(game);
    game.start();

    const board = game.board as ImpostorBoard;
    const impostorId = game.impostorId!;
    const goodId = players.find(p => p.id !== impostorId)!.id;
    const impostor = board.players.get(impostorId)!;
    const good = board.players.get(goodId)!;
    const middle = Math.floor(board.size / 2);

    // Good player starts with magnifier
    good.impostorTool = 'magnifier';
    good.x = 5;
    good.y = 5;
    board.walls = [];

    // Impostor in safe zone moving within safe zone does NOT leave footprints
    impostor.x = middle;
    impostor.y = middle;
    board.grid[middle][middle].hasPlayer = impostorId;
    assert.equal(board.isSafeZoneCell(middle, middle + 1), true);
    board.moveImpostorPlayer(impostorId, middle, middle + 1);
    assert.equal(board.footprints.length, 0);

    // Impostor outside safe zone stepping on (4, 2) (Step 1 -> leaves footprint)
    impostor.x = 4;
    impostor.y = 1;
    board.grid[1][4].hasPlayer = impostorId;
    assert.equal(board.isSafeZoneCell(4, 2), false);

    privateEvents.length = 0;
    assert.equal(game.executeMove(impostorId, 4, 2), true);
    assert.equal(board.footprints.length, 1);
    assert.equal(board.footprints[0].x, 4);
    assert.equal(board.footprints[0].y, 2);

    // Impostor steps on (4, 3) (Step 2 -> intermittent, skips footprint)
    mock.timers.tick(200);
    assert.equal(game.executeMove(impostorId, 4, 3), true);
    assert.equal(board.footprints.length, 1, 'Intermittent step does not leave footprint');

    // Impostor steps on (4, 4) (Step 3 -> leaves footprint)
    mock.timers.tick(200);
    assert.equal(game.executeMove(impostorId, 4, 4), true);
    assert.equal(board.footprints.length, 2, 'Third step leaves footprint');

    // Impostor moves further away to (4, 7).
    // The footprint at (4, 2) is 5 tiles away (> 2 tiles) so it is emitted.
    // The footprint at (4, 4) is 3 tiles away (> 2 tiles) so it is emitted.
    impostor.x = 4;
    impostor.y = 6;
    board.grid[6][4].hasPlayer = impostorId;
    mock.timers.tick(200);
    privateEvents.length = 0;
    assert.equal(game.executeMove(impostorId, 4, 7), true);

    const emittedFps = privateEvents.filter(e => e.playerId === goodId && e.event === 'impostorFootprints').pop();
    assert.ok(emittedFps);
    assert.ok(emittedFps.data.some((f: any) => f.x === 4 && f.y === 2));

    // When impostor is at (4, 4), the footprint at (4, 2) is 2 tiles away (<= 2 tiles) -> masked!
    impostor.x = 4;
    impostor.y = 4;
    game.emitPrivateImpostorFootprints();
    const maskedFps = privateEvents.filter(e => e.playerId === goodId && e.event === 'impostorFootprints').pop();
    assert.ok(maskedFps);
    assert.equal(maskedFps.data.some((f: any) => f.x === 4 && f.y === 2), false, 'Footprint within 2 tiles of impostor is masked');

    // If good player drops magnifier, they receive empty footprints
    good.impostorTool = null;
    game.emitPrivateImpostorFootprints();
    const droppedEvent = privateEvents.filter(e => e.playerId === goodId && e.event === 'impostorFootprints').pop();
    assert.ok(droppedEvent);
    assert.equal(droppedEvent.data.length, 0);

    privateEvents.length = 0;
    game.emitPrivateImpostorFootprints();
    assert.equal(
      privateEvents.filter(e => e.playerId === goodId && e.event === 'impostorFootprints').length,
      0,
      'Unchanged footprint state should not be emitted again'
    );

    // Advance 11 seconds: footprint expires and is cleaned up
    mock.timers.tick(11_000);
    board.cleanupExpiredFootprints(Date.now());
    assert.equal(board.footprints.length, 0);
  });
});
