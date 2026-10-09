import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { container } from 'tsyringe';
import { RoomService } from '../services/room.service.js';
import {
  GameInstance,
  IMPOSTOR_GHOST_DURATION_MS,
  IMPOSTOR_TELEPORT_ANIMATION_MS,
  IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS
} from '../game/engine/game-instance.js';
import { InfectionBoard } from '../game/engine/infection-board.js';
import { ImpostorBoard } from '../game/engine/impostor-board.js';
import { Player, Wall } from '../game/engine/models.js';
import { ImpostorAuditService } from '../services/impostor-audit.service.js';
import { ImpostorMatchAuditState } from '../models/impostor-match-audit-state.entity.js';
import { AppDataSource } from '../config/database.config.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

describe('04 - Multiplayer Modes (FFA, 2v2) & Core Game Mechanics Tests', () => {
  let roomService: RoomService;

  before(async () => {
    await setupTestEnvironment();
    roomService = container.resolve(RoomService);
  });

  it('Should let a ghost move diagonally in a straight line through impostor walls', () => {
    const board = new ImpostorBoard(10);
    const ghost = new Player('impostor_diagonal_ghost', 'Ghost', false, 1, 1);
    board.addPlayer(ghost);
    ghost.ghostModeExpiresAt = Date.now() + 10_000;
    board.walls.push(new Wall('ghost_path_wall', 'impostor', 1, 1, true));

    assert.ok(board.getImpostorValidMoves(ghost.id).some(move => move.x === 2 && move.y === 2));
    assert.equal(board.moveImpostorPlayer(ghost.id, 2, 2), true);
    assert.deepEqual({ x: ghost.x, y: ghost.y }, { x: 2, y: 2 });
  });

  it('Should capture complete Impostor board and role data in audit snapshots', () => {
    const players = [
      { id: 'impostor_audit_good', username: 'AuditGood', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_audit_other', username: 'AuditOther', isGuest: false, color: '#007AFF' },
      { id: 'impostor_audit_impostor', username: 'AuditImpostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('impostor_audit_snapshot_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    const snapshot = game.getImpostorAuditSnapshot() as {
      state: string;
      impostorId: string;
      players: Array<{ id: string; role: string; x: number; y: number }>;
      board: {
        size: number;
        walls: unknown[];
        keys: unknown[];
        exits: unknown[];
        teleports: unknown[];
        generators: unknown[];
        tools: unknown[];
      };
    };
    assert.equal(snapshot.state, 'playing');
    assert.equal(snapshot.impostorId, game.impostorId);
    assert.equal(snapshot.players.find(player => player.id === game.impostorId)?.role, 'impostor');
    assert.ok(snapshot.players.every(player => Number.isInteger(player.x) && Number.isInteger(player.y)));
    assert.equal(snapshot.board.size, game.board.size);
    assert.ok(snapshot.board.walls.length > 0);
    assert.ok(snapshot.board.keys.length > 0);
    assert.equal(snapshot.board.exits.length, 4);
    assert.equal(snapshot.board.teleports.length, 0);
    assert.equal(snapshot.board.generators.length, 4);
    assert.equal(snapshot.board.tools.length, 4);
    game.destroy();
  });

  it('Should mark player-placed walls in public state without revealing their owners', () => {
    const board = new ImpostorBoard(10);
    board.walls.push(
      new Wall('generated_wall', 'board', 1, 1, true),
      new Wall('good_player_wall', 'good_player', 3, 3, true),
      new Wall('impostor_player_wall', 'impostor', 5, 5, false)
    );

    const publicWalls = board.toDTO().walls;
    assert.deepEqual(publicWalls.map(wall => ({
      ownerId: wall.ownerId,
      isPlayerPlaced: wall.isPlayerPlaced
    })), [
      { ownerId: 'impostor', isPlayerPlaced: false },
      { ownerId: 'impostor', isPlayerPlaced: true },
      { ownerId: 'impostor', isPlayerPlaced: true }
    ]);
  });

  it('Should protect the central room from generated walls while allowing generated walls in its safe margin', () => {
    const board = new ImpostorBoard(40);
    const middle = Math.floor(board.size / 2);
    const protectedMin = middle - 5;
    const protectedMax = middle + 5;
    const protectedWall = new Wall('protected_good_wall', 'good_player', middle - 6, middle, true);
    const protectedImpostorWall = new Wall('protected_impostor_wall', 'impostor', middle, middle - 6, false);
    const outsideWall = new Wall('outside_protected_zone', 'good_player', 2, 2, true);
    const boundaryWall = new Wall('protected_zone_boundary_wall', 'good_player', protectedMin, protectedMin - 1, true);
    const insideWall = new Wall('inside_protected_zone_wall', 'good_player', protectedMin, protectedMin, true);

    assert.equal(board.canPlaceWall(protectedWall), false);
    assert.equal(board.canPlaceWall(protectedImpostorWall), false);
    assert.equal(board.placeImpostorWall(protectedWall), false);
    assert.equal(board.canPlaceWall(outsideWall), true);
    assert.equal(board.canPlaceWall(boundaryWall), true);
    assert.equal(board.canPlaceWall(insideWall), false);

    const assertRandomWallsStayOutOfCentralRoom = (): void => {
      const randomWalls = board.walls.filter(candidate => !candidate.id.startsWith('impostor_center_'));
      let hasWallInSafeMargin = false;
      for (const wall of randomWalls) {
        const passages = wall.isHorizontal
          ? [
              [{ x: wall.x, y: wall.y }, { x: wall.x, y: wall.y + 1 }],
              [{ x: wall.x + 1, y: wall.y }, { x: wall.x + 1, y: wall.y + 1 }]
            ]
          : [
              [{ x: wall.x, y: wall.y }, { x: wall.x + 1, y: wall.y }],
              [{ x: wall.x, y: wall.y + 1 }, { x: wall.x + 1, y: wall.y + 1 }]
            ];
        for (const passage of passages) {
          const bothInCentralRoom = passage.every(({ x, y }) =>
            Math.abs(x - middle) <= 3 && Math.abs(y - middle) <= 3
          );
          assert.equal(bothInCentralRoom, false, `wall ${wall.id} blocks a central-room passage`);
          const bothInSafeZone = passage.every(({ x, y }) =>
            x >= protectedMin && x <= protectedMax && y >= protectedMin && y <= protectedMax
          );
          if (bothInSafeZone) hasWallInSafeMargin = true;
        }
      }
      assert.ok(hasWallInSafeMargin, 'random walls should also occupy the outer safe-zone margin');
    };

    board.generateRandomImpostorWalls(560, () => 0.5);
    assertRandomWallsStayOutOfCentralRoom();
    board.reshuffleImpostor(() => 0.5);
    assertRandomWallsStayOutOfCentralRoom();
  });

  it('Should restrict personal keys to their owner and require a powered sector and radar', () => {
    const board = new ImpostorBoard(20);
    const owner = new Player('impostor_key_owner', 'KeyOwner', false, 5, 5);
    const other = new Player('impostor_key_other', 'Other', false, 6, 5);
    board.addPlayer(owner);
    board.addPlayer(other);
    board.spawnGenerators();
    board.keys = [{ id: 'owner_key', ownerId: owner.id, x: 8, y: 8 }];

    assert.equal(board.collectKey(other.id, 8, 8), null);
    assert.equal(board.collectKey(owner.id, 8, 8), null, 'radar is required');
    owner.impostorTool = 'radar';
    assert.deepEqual(board.toDTO(owner.id).keys.map(key => key.id), ['owner_key']);
    assert.deepEqual(board.toDTO(other.id).keys, []);
    board.damageGenerator('generator_northwest');
    assert.equal(board.collectKey(owner.id, 8, 8), null, 'a damaged sector hides and protects its key');
  });

  it('Should prevent walls from making an uncollected key unreachable', () => {
    const board = new ImpostorBoard(20);
    const owner = new Player('impostor_key_access_owner', 'KeyOwner', false, 0, 9);
    board.addPlayer(owner);
    board.keys = [{ id: 'impostor_key_access', x: 3, y: 9 }];
    board.walls.push(
      new Wall('key_north', 'impostor', 2, 8, true),
      new Wall('key_south', 'impostor', 3, 9, true),
      new Wall('key_east', 'impostor', 3, 8, false)
    );
    const closingWall = new Wall('key_west', 'impostor', 2, 9, false);

    assert.equal(board.isImpostorCellReachable(owner.x, owner.y, 3, 9), true);
    assert.equal(board.wouldMakeUncollectedKeyUnreachable(closingWall), true);
    assert.equal(board.walls.length, 3, 'validation must not leave the preview wall on the board');

    board.keys = [];
    assert.equal(board.wouldMakeUncollectedKeyUnreachable(closingWall), false);
  });

  it('Should reject good-player wall placement while allowing the impostor to close a route', () => {
    const players = [
      { id: 'impostor_cut_good_a', username: 'GoodA', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_cut_good_b', username: 'GoodB', isGuest: false, color: '#007AFF' },
      { id: 'impostor_cut_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('impostor_cut_teammates_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    board.walls.splice(0);
    board.keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const goodPlayers = players
      .map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== game.impostorId);
    goodPlayers[0].x = 0;
    goodPlayers[0].y = 2;
    goodPlayers[1].x = 39;
    goodPlayers[1].y = 2;
    goodPlayers.forEach(player => {
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });
    const impostor = game.board.players.get(game.impostorId!)!;
    impostor.x = 0;
    impostor.y = 0;
    game.board.grid[0][0].hasPlayer = impostor.id;

    for (let y = 0; y < game.board.size; y += 2) {
      if (y !== 2) board.walls.push(new Wall(`impostor_cut_barrier_${y}`, 'impostor', 19, y, false));
    }

    assert.equal(game.getPrivateImpostorRole(goodPlayers[0].id)?.canPlaceWall, false);
    assert.equal(game.placeImpostorWall(goodPlayers[0].id, 19, 2, false, 'good_cut_teammates'), false);
    assert.equal(board.walls.length, 19);
    assert.equal(game.placeImpostorWall(impostor.id, 19, 2, false, 'impostor_cut_teammates'), true);
    assert.equal(board.walls.length, 20);
    game.destroy();
  });

  it('Should persist ordered Impostor audit states', async () => {
    const auditService = container.resolve(ImpostorAuditService);
    const matchId = `impostor_audit_persist_${Date.now()}`;
    try {
      await Promise.all([
        auditService.recordState(matchId, 'game_created', { status: 'waiting', board: { size: 40 } }),
        auditService.recordState(matchId, 'impostorStateChanged', { status: 'playing', playerX: 4 }),
        auditService.recordState(matchId, 'game_finished', { status: 'finished', winner: 'good' })
      ]);
      const storedStates = await AppDataSource.getRepository(ImpostorMatchAuditState).find({
        where: { matchId },
        order: { sequence: 'ASC' }
      });

      it('Should continue audit sequences when a room id has previous persisted states', async () => {
        const auditService = container.resolve(ImpostorAuditService);
        const matchId = `impostor_audit_resume_${Date.now()}`;
        try {
          await auditService.recordState(matchId, 'previous_game_finished', { status: 'finished' });
          await auditService.releaseMatch(matchId);
          await auditService.recordState(matchId, 'game_created', { status: 'waiting' });

          const storedStates = await AppDataSource.getRepository(ImpostorMatchAuditState).find({
            where: { matchId },
            order: { sequence: 'ASC' }
          });
          assert.deepEqual(storedStates.map(state => state.sequence), [1, 2]);
          assert.equal(storedStates[1].event, 'game_created');
        } finally {
          await AppDataSource.getRepository(ImpostorMatchAuditState).delete({ matchId });
          await auditService.releaseMatch(matchId);
        }
      });

      it('Should preserve unique ordered audit sequences across concurrent service instances', async () => {
        const firstService = new ImpostorAuditService();
        const secondService = new ImpostorAuditService();
        const matchId = `impostor_audit_concurrent_${Date.now()}_${Math.random()}`;
        try {
          await Promise.all(Array.from({ length: 20 }, (_, index) =>
            (index % 2 === 0 ? firstService : secondService).recordState(
              matchId,
              `concurrent_event_${index}`,
              { index }
            )
          ));

          const storedStates = await AppDataSource.getRepository(ImpostorMatchAuditState).find({
            where: { matchId },
            order: { sequence: 'ASC' }
          });
          assert.deepEqual(storedStates.map(state => state.sequence), Array.from({ length: 20 }, (_, index) => index + 1));
          assert.equal(new Set(storedStates.map(state => state.event)).size, 20);
        } finally {
          await AppDataSource.getRepository(ImpostorMatchAuditState).delete({ matchId });
          await Promise.all([
            firstService.releaseMatch(matchId),
            secondService.releaseMatch(matchId)
          ]);
        }
      });

      assert.deepEqual(storedStates.map(state => state.sequence), [1, 2, 3]);
      assert.deepEqual(storedStates.map(state => state.event), [
        'game_created',
        'impostorStateChanged',
        'game_finished'
      ]);
      assert.deepEqual(storedStates[2].snapshot, { status: 'finished', winner: 'good' });
    } finally {
      await AppDataSource.getRepository(ImpostorMatchAuditState).delete({ matchId });
      await auditService.releaseMatch(matchId);
    }
  });

  after(async () => {
    await teardownTestEnvironment();
  });

  it('Should correctly initialize a FFA (Free-For-All) room with 4 players on 4 borders', () => {
    const room = roomService.createRoom('p1', 'Player1', false, 'FFA Room', 'FFA');
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
    assert.equal(room.maxPlayers, 6);

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

    // Each player in FFA starts with 7 walls
    assert.equal(p1?.wallsLeft, 7);
    assert.equal(p2?.wallsLeft, 7);
    assert.equal(p1?.pawnColor, '#92400E');
    assert.equal(game.board.toDTO('p1').players.p1.pawnColor, '#92400E');

    game.destroy();
  });

  it('Should give each player 7 walls in 6-player FFA', () => {
    const room = roomService.createRoom('six_ffa_1', 'Player1', false, 'FFA Room', 'FFA');
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

  it('Should create a six-slot Impostor room that can be filled with bots', () => {
    const room = roomService.createRoom('impostor_host', 'ImpostorHost', false, 'Impostor room', 'impostor');
    assert.equal(room.maxPlayers, 6);
    for (let index = 0; index < 5; index++) {
      roomService.addBotToCustomRoom(room.id, 'impostor_host');
    }
    assert.equal(room.players.length, 6);
    assert.equal(room.players.filter(player => player.id.startsWith('bot_')).length, 5);
  });

  it('Should prevent two room participants from selecting the same pawn skin', () => {
    const room = roomService.createRoom('impostor_skin_owner', 'SkinOwner', false, 'Skin room', 'impostor');
    roomService.joinRoom(room.id, 'impostor_skin_other', 'SkinOther', false);
    roomService.setPlayerCosmetic(room.id, 'impostor_skin_owner', 'PAWN_SKIN', 'skin_unique');

    assert.throws(
      () => roomService.setPlayerCosmetic(room.id, 'impostor_skin_other', 'PAWN_SKIN', 'skin_unique'),
      /Pawn skin is already taken/
    );

    roomService.setPlayerCosmetic(room.id, 'impostor_skin_owner', 'PAWN_SKIN', null);
    assert.doesNotThrow(() =>
      roomService.setPlayerCosmetic(room.id, 'impostor_skin_other', 'PAWN_SKIN', 'skin_unique')
    );
  });

  it('Should prevent both players in a standard 1v1 room from selecting the same pawn skin', () => {
    const room = roomService.createRoom('duel_skin_owner', 'DuelOwner', false, 'Duel room', '1v1');
    roomService.joinRoom(room.id, 'duel_skin_other', 'DuelOther', false);
    roomService.setPlayerCosmetic(room.id, 'duel_skin_owner', 'PAWN_SKIN', 'skin_shared');

    assert.throws(
      () => roomService.setPlayerCosmetic(room.id, 'duel_skin_other', 'PAWN_SKIN', 'skin_shared'),
      /Pawn skin is already taken/
    );
  });

  it('Should keep exactly four cardinal entrances around the central Impostor and hide wall owners', () => {
    class InspectableImpostorBoard extends ImpostorBoard {
      public isPassageBlocked(fromX: number, fromY: number, toX: number, toY: number): boolean {
        return this.isWallBlocking(fromX, fromY, toX, toY);
      }
    }

    const board = new InspectableImpostorBoard(20);
    for (let index = 0; index < 6; index++) {
      board.addPlayer(new Player(`impostor_gate_${index}`, `Gate${index}`, false, index, 0));
    }
    board.generateRandomImpostorWalls(16, () => 0.5, 6);

    const centerWalls = board.walls.filter(wall => wall.id.startsWith('impostor_center_'));
    assert.equal(centerWalls.length, 12);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('impostor_center_n_')).length, 3);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('impostor_center_s_')).length, 3);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('impostor_center_e_')).length, 3);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('impostor_center_w_')).length, 3);
    assert.equal(board.exits.length, 4);
    const middle = Math.floor(board.size / 2);
    const min = middle - 3;
    const max = middle + 3;
    for (let position = min; position <= max; position++) {
      const isGatePosition = position === middle - 1 || position === middle;
      assert.equal(board.isPassageBlocked(position, min - 1, position, min), !isGatePosition);
      assert.equal(board.isPassageBlocked(position, max, position, max + 1), !isGatePosition);
      assert.equal(board.isPassageBlocked(min - 1, position, min, position), !isGatePosition);
      assert.equal(board.isPassageBlocked(max, position, max + 1, position), !isGatePosition);
    }
    const dto = board.toDTO();
    assert.ok(dto.walls.every(wall => wall.ownerId === 'impostor'));
    assert.ok(dto.walls.every(wall => 'isSabotageWall' in wall));
  });

  it('Should keep all four cardinal zones reachable from the Infection spawn', () => {
    class InspectableInfectionBoard extends InfectionBoard {
      public canReach(start: { x: number; y: number }, target: { x: number; y: number }): boolean {
        const queue = [start];
        const visited = new Set([`${start.x},${start.y}`]);
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index];
          if (current.x === target.x && current.y === target.y) return true;
          for (const next of [
            { x: current.x, y: current.y - 1 },
            { x: current.x + 1, y: current.y },
            { x: current.x, y: current.y + 1 },
            { x: current.x - 1, y: current.y }
          ]) {
            const key = `${next.x},${next.y}`;
            if (next.x < 0 || next.x >= this.size ||
                next.y < 0 || next.y >= this.size ||
                visited.has(key) || this.isWallBlocking(current.x, current.y, next.x, next.y)) continue;
            visited.add(key);
            queue.push(next);
          }
        }
        return false;
      }
    }

    for (let seed = 1; seed <= 8; seed++) {
      const board = new InspectableInfectionBoard(20);
      const infected = new Player(`infection_spawn_${seed}`, 'Infected', false, 0, 0);
      board.addPlayer(infected);
      const spawn = board.placePlayerAtSouthEdge(infected.id);
      let randomState = seed;
      const random = (): number => {
        randomState = (randomState * 48271) % 2_147_483_647;
        return randomState / 2_147_483_647;
      };
      board.generateRandomImpostorWalls(undefined, random);

      const middle = Math.floor(board.size / 2);
      const cardinalZones = [
        { x: middle, y: 0 },
        { x: board.size - 1, y: middle },
        { x: middle, y: board.size - 1 },
        { x: 0, y: middle }
      ];
      for (const zone of cardinalZones) {
        assert.equal(
          board.canReach(spawn, zone),
          true,
          `seed ${seed} should keep the Infection spawn connected to (${zone.x}, ${zone.y})`
        );
      }
    }
  });

  it('Should always generate four exits with two humans and four bots', () => {
    const board = new ImpostorBoard(20);
    const players = [
      ['impostor_two_humans_1', false],
      ['impostor_two_humans_2', false],
      ['bot_impostor_two_1', true],
      ['bot_impostor_two_2', true],
      ['bot_impostor_two_3', true],
      ['bot_impostor_two_4', true]
    ] as const;
    players.forEach(([id, isGuest], index) =>
      board.addPlayer(new Player(id, id, isGuest, index, 0))
    );
    board.generateRandomImpostorWalls(0, () => 0.5, players.length);

    assert.equal(board.exits.length, 4);
    assert.equal(new Set(board.exits.map(exit => `${exit.x},${exit.y}`)).size, 4);
    assert.ok(board.exits.every(exit => exit.playerId.startsWith('impostor_two_humans_')));
  });

  it('Should block both directions through a sealed central gate', () => {
    const board = new ImpostorBoard(20);
    const players = Array.from({ length: 6 }, (_, index) =>
      new Player(`impostor_sealed_gate_${index}`, `Gate${index}`, false, index, 0)
    );
    players.forEach(player => board.addPlayer(player));
    board.generateRandomImpostorWalls(16, () => 0.5, 6);
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;

    const middle = Math.floor(board.size / 2);
    const northExit = board.exits.find(exit => exit.x === middle && exit.y < middle)!;
    const outsideCell = { x: middle, y: northExit.y - 1 };
    const insideCell = { x: middle, y: northExit.y };
    const movingPlayer = players[0];
    movingPlayer.x = outsideCell.x;
    movingPlayer.y = outsideCell.y;
    board.grid[outsideCell.y][outsideCell.x].hasPlayer = movingPlayer.id;
    players.slice(1).forEach((player, index) => {
      player.x = index;
      player.y = 0;
      board.grid[player.y][player.x].hasPlayer = player.id;
    });

    assert.ok(board.getImpostorValidMoves(movingPlayer.id).some(move =>
      move.x === insideCell.x && move.y === insideCell.y
    ));
    board.sealImpostorExit(northExit.id);
    assert.ok(!board.getImpostorValidMoves(movingPlayer.id).some(move =>
      move.x === insideCell.x && move.y === insideCell.y
    ));
    movingPlayer.ghostModeExpiresAt = Date.now() + 10_000;
    assert.ok(!board.getImpostorValidMoves(movingPlayer.id).some(move =>
      move.x === insideCell.x && move.y === insideCell.y
    ));
    movingPlayer.ghostModeExpiresAt = 0;

    board.grid[outsideCell.y][outsideCell.x].hasPlayer = null;
    movingPlayer.x = insideCell.x;
    movingPlayer.y = insideCell.y;
    board.grid[insideCell.y][insideCell.x].hasPlayer = movingPlayer.id;
    assert.ok(!board.getImpostorValidMoves(movingPlayer.id).some(move =>
      move.x === outsideCell.x && move.y === outsideCell.y
    ));
    assert.equal(board.openImpostorExit(northExit.id), 1);
    assert.ok(board.getImpostorValidMoves(movingPlayer.id).some(move =>
      move.x === outsideCell.x && move.y === outsideCell.y
    ));
  });

  it('Should keep safe-zone entrances permanently open in Impostor', () => {
    const players = [
      { id: 'impostor_gate_good', username: 'Good', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_gate_impostor', username: 'Impostor', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_open_gate_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    assert.ok(board.exits.every(exit => !exit.isSealed));
    assert.equal(game.sealImpostorExit(game.impostorId!, board.exits[0].id), false);
    assert.equal(game.openImpostorExit(players[0].id, board.exits[0].id), false);
    assert.ok(board.exits.every(exit => !exit.isSealed));
    game.destroy();
  });
  it('Should not spawn or use portals in Impostor', () => {
    const players = [
      { id: 'impostor_portal_a', username: 'PortalA', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_portal_b', username: 'PortalB', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_portal_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    assert.equal(board.teleports.length, 0);
    assert.equal(game.teleportImpostorPlayer(players[0].id, 'missing_portal'), false);
    game.destroy();
  });
  it('Should restrict wall placement to the impostor and enforce its ten-second cooldown', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    const players = [
      { id: 'impostor_sabotage_good_1', username: 'Good1', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_sabotage_good_2', username: 'Good2', isGuest: false, color: '#007AFF' },
      { id: 'impostor_sabotage_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' },
      { id: 'impostor_sabotage_good_3', username: 'Good3', isGuest: false, color: '#34C759' }
    ];
    const publicEvents: any[] = [];
    const emittedEvents: string[] = [];
    const game = new GameInstance('impostor_sabotage_options_test', 'impostor', players, (event, data) => {
      emittedEvents.push(event);
      if (event === 'impostorPublicEvent') publicEvents.push(data);
    }, GAME_INSTANCE_TEST_OPTIONS);
    const privateEvents: string[] = [];
    game.onPrivateStateChange = (_playerId, event) => privateEvents.push(event);
    try {
      game.start();
      assert.ok(privateEvents.includes('impostorActionState'), 'initial wall controls receive their action state');
      game.board.walls.splice(0);
      const board = game.board as ImpostorBoard;
      board.keys = [];
      const good = game.board.players.get(players.find(player => player.id !== game.impostorId)!.id)!;
      const impostor = game.board.players.get(game.impostorId!)!;

      assert.equal(game.getPrivateImpostorRole(good.id)?.canPlaceWall, false);
      assert.equal(game.placeImpostorWall(good.id, 1, 1, true, 'good_wall_1'), false);
      assert.equal(board.walls.length, 0, 'a good player cannot place a wall');

      assert.equal(game.getPrivateImpostorRole(impostor.id)?.canPlaceWall, true);
      assert.equal(game.placeImpostorWall(impostor.id, 5, 5, false, 'impostor_wall'), true);
      assert.equal(game.getPrivateImpostorRole(impostor.id)?.canPlaceWall, false);
      assert.equal(game.placeImpostorWall(impostor.id, 7, 7, false, 'impostor_wall_2'), false);
      mock.timers.tick(IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS);
      assert.equal(game.getPrivateImpostorRole(impostor.id)?.canPlaceWall, true);

      board.walls.splice(0);
      for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
      const goodPlayers = [...board.players.values()].filter(player => player.id !== impostor.id);
      goodPlayers.forEach((player, index) => {
        player.x = 1 + index * 4;
        player.y = 1;
        board.grid[player.y][player.x].hasPlayer = player.id;
      });
      const eventCountBeforeReshuffle = emittedEvents.length;
      assert.equal(game.beginImpostorLayoutChange(impostor.id), true);
      assert.equal(game.beginImpostorLayoutChange(impostor.id), false, 'do not overlap impostor changes');
      assert.equal(emittedEvents.length, eventCountBeforeReshuffle, 'beginning leaves generation deferred');
      assert.equal(game.executeMove(goodPlayers[0].id, goodPlayers[0].x + 1, goodPlayers[0].y), false);
      assert.equal(goodPlayers[0].x, 1, 'players cannot move until the reshuffle completes');
      assert.equal(game.completeImpostorLayoutChange(impostor.id, () => 0.4), true);
      const reshuffleEvents = emittedEvents.slice(eventCountBeforeReshuffle);
      assert.equal(
        reshuffleEvents[0],
        'impostorPublicEvent',
        'send the public socket event immediately when the impostor changes'
      );
      assert.equal(reshuffleEvents[1], 'impostorStateChanged');
      assert.ok(publicEvents.some(event => event.type === 'impostor_changed'));
      assert.equal([...game.board.players.values()].filter(player =>
        player.ghostModeExpiresAt > Date.now()
      ).length, 0);
      assert.equal((game.board as ImpostorBoard).ghostPickups.length, 0);
      assert.ok((game.board as ImpostorBoard).exits.every(exit => !exit.isSealed));
    } finally {
      game.destroy();
      mock.timers.reset();
    }
  });

  it('Should let the random ghost walk through walls and end wall phasing when its timer expires', () => {
    const board = new ImpostorBoard(6);
    const ghost = new Player('impostor_ghost', 'Ghost', false, 2, 2);
    board.addPlayer(ghost);
    ghost.isInPrison = true;
    ghost.ghostModeExpiresAt = Date.now() + 10_000;
    board.walls = [
      new Wall('cage_n', 'impostor', 2, 1, true, undefined, undefined, true, true),
      new Wall('cage_s', 'impostor', 2, 2, true, undefined, undefined, true, true),
      new Wall('cage_w', 'impostor', 1, 2, false, undefined, undefined, true, true),
      new Wall('cage_e', 'impostor', 2, 2, false, undefined, undefined, true, true)
    ];

    assert.ok(board.getImpostorValidMoves(ghost.id).some(move => move.x === 3 && move.y === 2));
    assert.equal(board.moveImpostorPlayer(ghost.id, 3, 2), true);
    ghost.ghostModeExpiresAt = Date.now() - 1;
    board.walls.push(new Wall('expired_ghost_wall', 'impostor', 3, 2, false));
    assert.ok(!board.getImpostorValidMoves(ghost.id).some(move => move.x === 4 && move.y === 2));
  });

  it('Should imprison and announce a ghost when its timer expires inside a cage', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    const events: string[] = [];
    const players = [
      { id: 'impostor_expiring_ghost_good', username: 'Ghost', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_expiring_ghost_other', username: 'Other', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_expiring_ghost_cage_test', 'impostor', players, event => {
      events.push(event);
    }, GAME_INSTANCE_TEST_OPTIONS);
    try {
      game.start();
      const board = game.board as ImpostorBoard;
      const ghost = board.players.get(players.find(player => player.id !== game.impostorId)!.id)!;
      board.walls = [];
      board.keys = [];
      ghost.x = 20;
      ghost.y = 20;
      board.grid[ghost.y][ghost.x].hasPlayer = ghost.id;
      ghost.ghostModeExpiresAt = Date.now() + 1_000;
      board.walls.push(
        new Wall('expiring_ghost_n', game.impostorId!, 20, 19, true, undefined, undefined, false, true),
        new Wall('expiring_ghost_s', game.impostorId!, 20, 20, true, undefined, undefined, false, true),
        new Wall('expiring_ghost_w', game.impostorId!, 19, 20, false, undefined, undefined, false, true),
        new Wall('expiring_ghost_e', game.impostorId!, 20, 20, false, undefined, undefined, false, true)
      );

      assert.equal(ghost.isInPrison, false);
      mock.timers.tick(1_000);

      assert.equal(ghost.isInPrison, true);
      assert.ok(board.toDTO().players[ghost.id].isInPrison);
      assert.ok(events.includes('impostorPublicEvent'));
    } finally {
      game.destroy();
      mock.timers.reset();
    }
  });

  it('Should keep personal key locations fixed and remove impostor walls when reshuffling', () => {
    const impostorBoard = new ImpostorBoard(20);
    impostorBoard.addPlayer(new Player('impostor_shift_captive', 'Captive', false, 10, 10));
    impostorBoard.addPlayer(new Player('impostor_shift_free_1', 'Free1', false, 2, 2));
    impostorBoard.addPlayer(new Player('impostor_shift_free_2', 'Free2', false, 17, 17));
    const captive = impostorBoard.players.get('impostor_shift_captive')!;
    captive.isInPrison = true;
    impostorBoard.walls = [
      new Wall('preserved_north', 'impostor_shift_impostor', 9, 9, true, undefined, undefined, true, true),
      new Wall('preserved_south', 'impostor_shift_impostor', 9, 10, true, undefined, undefined, true, true),
      new Wall('preserved_west', 'impostor_shift_impostor', 9, 9, false, undefined, undefined, true, true),
      new Wall('preserved_east', 'impostor_shift_impostor', 10, 9, false, undefined, undefined, true, true)
    ];
    impostorBoard.keys = [
      { id: 'key_1', x: 1, y: 1 },
      { id: 'key_2', x: 2, y: 1 }
    ];
    const previousKeyPositions = new Map(impostorBoard.keys.map(key => [
      key.id,
      { x: key.x, y: key.y }
    ]));
    const previousCaptivePosition = { x: captive.x, y: captive.y };
    impostorBoard.reshuffleImpostor(() => 0.73, false, true);

    assert.deepEqual({ x: captive.x, y: captive.y }, previousCaptivePosition);
    assert.equal(captive.isInPrison, false);
    assert.equal(impostorBoard.walls.some(wall =>
      wall.id.startsWith('preserved_')
    ), false);
    assert.ok(impostorBoard.players.size === 3);
    assert.ok([...impostorBoard.players.values()]
      .filter(player => !player.isInPrison)
      .every(player => !impostorBoard.isImpostorPlayerEnclosed(player.id)));
    assert.equal(impostorBoard.teleports.length, 0);
    assert.ok(impostorBoard.keys.every(key => {
      const previousPosition = previousKeyPositions.get(key.id)!;
      return key.x === previousPosition.x && key.y === previousPosition.y;
    }));
    assert.equal(
      new Set(impostorBoard.keys.map(key => `${key.x},${key.y}`)).size,
      impostorBoard.keys.length,
      'reshuffled keys occupy different cells'
    );
    assert.ok(impostorBoard.teleports.every(portal =>
      impostorBoard.grid[portal.y][portal.x].hasPlayer === null
    ));
  });

  it('Should keep safe routes to central gates when reshuffling near an entrance', () => {
    class InspectableImpostorBoard extends ImpostorBoard {
      public isPassageBlocked(fromX: number, fromY: number, toX: number, toY: number): boolean {
        return this.isWallBlocking(fromX, fromY, toX, toY);
      }
    }

    const board = new InspectableImpostorBoard(20);
    const middle = Math.floor(board.size / 2);
    board.addPlayer(new Player('impostor_gate_approach_player', 'NearGate', false, middle, middle - 2));
    board.addPlayer(new Player('impostor_gate_approach_other', 'Other', false, 1, 1));
    board.generateRandomImpostorWalls(0, () => 0.5);
    board.reshuffleImpostor(() => 0.5, true);

    const northExit = board.exits.find(exit => exit.x === middle && exit.y < middle)!;
    for (let offset = -1; offset <= 0; offset++) {
      assert.equal(
        board.isPassageBlocked(northExit.x + offset, northExit.y - 1, northExit.x + offset, northExit.y),
        false,
        'reshuffling must never seal the gate itself'
      );
    }
    assert.ok([...board.players.values()].every(player =>
      !board.isImpostorPlayerEnclosed(player.id)
    ), 'barriers must not enclose a player who is near a gate');
    assert.ok(board.walls.some(wall => !wall.id.startsWith('impostor_center_')),
      'the new layout should still add random barriers outside the protected zone');
  });

  it('Should collect only the owner key and broadcast the carrier state', async () => {
    const players = [
      { id: 'impostor_key_player_1', username: 'Key1', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_key_player_2', username: 'Key2', isGuest: false, color: '#007AFF' }
    ];
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('impostor_key_test', 'impostor', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    const impostorBoard = game.board as ImpostorBoard;
    const key = impostorBoard.keys[0];
    const collector = game.board.players.get(key.ownerId!)!;
    const other = game.board.players.get(players.find(player => player.id !== key.ownerId)!.id)!;
    collector.impostorTool = 'radar';
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;
    collector.x = key.x - 1;
    collector.y = key.y;
    game.board.grid[collector.y][collector.x].hasPlayer = collector.id;
    other.x = game.board.size - 1;
    other.y = game.board.size - 1;
    game.board.grid[other.y][other.x].hasPlayer = other.id;

    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(game.executeMove(collector.id, key.x, key.y), true);
    assert.equal(collector.hasImpostorKey, true);
    assert.equal(impostorBoard.keys.some(candidate => candidate.id === key.id), false);
    assert.equal(game.getImpostorPublicActionCounts()[collector.id], 0);
    assert.ok(events.some(({ event, data }) =>
      event === 'impostorPublicEvent' && data.type === 'key_collected' && data.playerName === collector.username
    ));
    const lastBoardUpdate = events.filter(({ event }) => event === 'impostorStateChanged').at(-1)?.data;
    assert.equal(lastBoardUpdate.board.players[collector.id].hasImpostorKey, true);
    game.destroy();
  });

  it('Should start Impostor players centrally, keep roles private, and leave filler bots inactive', async () => {
    const players = [
      { id: 'bot_impostor_1', username: 'BOT - Green', isGuest: true, color: '#34C759' },
      { id: 'impostor_human_1', username: 'Human1', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_human_2', username: 'Human2', isGuest: false, color: '#007AFF' },
      { id: 'impostor_human_3', username: 'Human3', isGuest: false, color: '#FFCC00' },
      { id: 'bot_impostor_2', username: 'BOT - Purple', isGuest: true, color: '#AF52DE' },
      { id: 'bot_impostor_3', username: 'BOT - Orange', isGuest: true, color: '#FF9500' }
    ];
    const game = new GameInstance('impostor_start_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    assert.ok(game.board instanceof ImpostorBoard);
    const impostorBoard = game.board as ImpostorBoard;
    assert.equal(game.board.size, 40);
    const positions = [...game.board.players.values()].map(player => `${player.x},${player.y}`);
    assert.equal(new Set(positions).size, 6);
    const middle = Math.floor(game.board.size / 2);
    for (const player of game.board.players.values()) {
      assert.ok(Math.abs(player.x - middle) <= 2);
      assert.ok(Math.abs(player.y - middle) <= 2);
      assert.equal(player.wallsLeft, 0);
    }
    assert.ok(game.board.walls.length >= game.board.size * game.board.size * 0.3);
    assert.equal(impostorBoard.exits.length, 4);
    assert.equal(new Set(impostorBoard.exits.map(exit => `${exit.x},${exit.y}`)).size, 4);
    assert.ok(impostorBoard.exits.every(exit =>
      Math.abs(exit.x - middle) === 3 || Math.abs(exit.y - middle) === 3
    ));
    assert.equal(game.board.boosts.length, 0);
    assert.equal(impostorBoard.keys.length, 3);
    const goodPlayerIds = players
      .filter(player => !player.id.startsWith('bot_') && player.id !== game.impostorId)
      .map(player => player.id);
    assert.deepEqual(
      new Set(impostorBoard.keys.map(key => key.ownerId)),
      new Set([...goodPlayerIds, game.impostorId])
    );
    assert.ok(impostorBoard.keys.every(key =>
      Math.max(Math.abs(key.x - middle), Math.abs(key.y - middle)) >= 10
    ));
    assert.equal(impostorBoard.teleports.length, 0);
    assert.ok(impostorBoard.isCellCapturable(impostorBoard.keys[0].x, impostorBoard.keys[0].y));
    assert.equal(impostorBoard.generators.length, 4);
    assert.equal(impostorBoard.tools.length, 4);
    assert.equal(game.getImpostorGameTimeLimitSeconds(), 480);

    const humanRoles = players
      .filter(player => !player.id.startsWith('bot_'))
      .map(player => game.getPrivateImpostorRole(player.id));
    assert.equal(humanRoles.filter(role => role?.role === 'impostor').length, 1);
    assert.equal(humanRoles.filter(role => role?.role === 'good').length, 2);
    assert.equal([...game.board.players.values()].filter(player =>
      player.ghostModeExpiresAt > Date.now()
    ).length, 0);
    assert.equal(impostorBoard.ghostPickups.length, 0);
    const impostorId = players.find(player =>
      game.getPrivateImpostorRole(player.id)?.role === 'impostor'
    )?.id;
    assert.ok(impostorId);
    assert.deepEqual(game.getImpostorGhostPickupsForPlayer(impostorId), []);
    const goodPlayerId = players.find(player =>
      game.getPrivateImpostorRole(player.id)?.role === 'good'
    )!.id;
    assert.equal(game.getImpostorGhostPickupsForPlayer(goodPlayerId).length, 0);
    assert.ok(humanRoles.every(role => role !== null && !role.canBreakBlock));
    assert.equal(humanRoles.filter(role => role?.role === 'impostor' && role?.canPlaceWall).length, 1);
    assert.ok(humanRoles.filter(role => role?.role === 'good').every(role => role?.canPlaceWall === false));
    assert.equal(game.getPrivateImpostorRole('bot_impostor_1'), null);
    const publicBoard = game.board.toDTO('impostor_human_1');
    assert.equal('impostorRole' in publicBoard, false);
    assert.equal('impostorId' in publicBoard, false);
    assert.equal(Object.keys(game.getImpostorPublicActionCounts()).length, 3);
    const botPosition = { x: game.board.players.get('bot_impostor_1')?.x, y: game.board.players.get('bot_impostor_1')?.y };
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepEqual(
      { x: game.board.players.get('bot_impostor_1')?.x, y: game.board.players.get('bot_impostor_1')?.y },
      botPosition
    );
    assert.equal(game.getCurrentPlayer(), '', 'Impostor has no active turn owner');
    game.destroy();
  });

  it('Should not spawn ghost pickups in Impostor', () => {
    const players = [
      { id: 'impostor_ghost_good_a', username: 'GoodA', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_ghost_good_b', username: 'GoodB', isGuest: false, color: '#007AFF' },
      { id: 'impostor_ghost_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('impostor_ghost_pickup_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    assert.equal(board.ghostPickups.length, 0);
    assert.deepEqual(game.getImpostorGhostPickupsForPlayer(game.impostorId!), []);
    game.destroy();
  });
  it('Should allow independent real-time Impostor movement without turn events', () => {
    const players = [
      { id: 'impostor_realtime_1', username: 'Impostor1', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_realtime_2', username: 'Impostor2', isGuest: false, color: '#007AFF' }
    ];
    let startEvent: any;
    const emittedEvents: string[] = [];
    const movementEvents: any[] = [];
    const impostorStateUpdates: any[] = [];
    const game = new GameInstance('impostor_realtime_test', 'impostor', players, (event, data) => {
      emittedEvents.push(event);
      if (event === 'gameStarted') startEvent = data;
      if (event === 'playerMoved') movementEvents.push(data);
      if (event === 'impostorStateChanged') impostorStateUpdates.push(data);
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    game.setPlayerCosmetic('impostor_realtime_1', 'MOVEMENT_TRAIL', 'trail_test', '✨');

    assert.equal('currentTurn' in startEvent, false);
    assert.equal('turnTimeLimitSeconds' in startEvent, false);
    assert.equal('turnSecondsRemaining' in startEvent, false);
    assert.equal(startEvent.gameTimeLimitSeconds, 480);
    const impostorBoard = game.board as ImpostorBoard;
    const firstMove = impostorBoard.getImpostorValidMoves('impostor_realtime_1')[0];
    assert.ok(firstMove);
    assert.equal(game.executeMove('impostor_realtime_1', firstMove.x, firstMove.y), true);
    const secondMove = impostorBoard.getImpostorValidMoves('impostor_realtime_2')[0];
    assert.ok(secondMove);
    assert.equal(game.executeMove('impostor_realtime_2', secondMove.x, secondMove.y), true);
    assert.equal(emittedEvents.filter(event => event === 'impostorStateChanged').length, 3);
    assert.equal(emittedEvents.filter(event => event === 'playerMoved').length, 2);
    assert.equal(movementEvents[0].movementTrailId, 'trail_test');
    assert.equal(movementEvents[0].movementTrailIcon, '✨');
    assert.equal(
      impostorStateUpdates[1].board.players.impostor_realtime_1.x,
      impostorBoard.players.get('impostor_realtime_1')?.x
    );
    assert.equal(
      impostorStateUpdates[1].board.players.impostor_realtime_2.x,
      impostorBoard.players.get('impostor_realtime_2')?.x
    );
    assert.equal(emittedEvents.includes('turnChanged'), false);
    const nextMove = impostorBoard.getImpostorValidMoves('impostor_realtime_1')[0];
    if (nextMove) {
      assert.equal(game.executeMove('impostor_realtime_1', nextMove.x, nextMove.y), false, 'movement is rate-limited per player');
    }
    game.destroy();
  });

  it('Should keep impostor traps private, outside the safe zone, and on independent cooldowns', () => {
    const players = [
      { id: 'impostor_trap_a', username: 'TrapA', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_trap_b', username: 'TrapB', isGuest: false, color: '#007AFF' },
      { id: 'impostor_trap_c', username: 'TrapC', isGuest: false, color: '#34C759' },
      { id: 'impostor_trap_d', username: 'TrapD', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('impostor_trap_privacy_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorBoard = game.board as ImpostorBoard;
    const impostorId = game.impostorId!;
    const goodId = players.find(player => player.id !== impostorId)!.id;
    const trapCell = impostorBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => !impostorBoard.isSafeZoneCell(x, y) && impostorBoard.canPlaceTrap(x, y))!;
    const middle = Math.floor(impostorBoard.size / 2);
    const safeCell = { x: middle, y: middle };
    const safeZoneMarginCell = { x: middle + 5, y: middle };

    assert.equal(game.placeImpostorTrap(goodId, 'ice', trapCell.x, trapCell.y), false);
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', safeCell.x, safeCell.y), false);
    assert.equal(impostorBoard.isSafeZoneCell(safeZoneMarginCell.x, safeZoneMarginCell.y), true);
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', safeZoneMarginCell.x, safeZoneMarginCell.y), false);
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', trapCell.x, trapCell.y), true);
    const teleportCell = impostorBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => !impostorBoard.isSafeZoneCell(x, y) &&
        impostorBoard.canPlaceTrap(x, y) && (x !== trapCell.x || y !== trapCell.y))!;
    assert.equal(game.placeImpostorTrap(impostorId, 'teleport', teleportCell.x, teleportCell.y), true);
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', teleportCell.x, teleportCell.y), false);
    assert.equal(game.getPrivateImpostorTrapState(goodId), null);
    assert.equal(game.getPrivateImpostorTrapState(impostorId)?.traps.length, 2);
    assert.ok((game.getPrivateImpostorTrapState(impostorId)?.cooldowns.ice ?? 0) > 0);
    assert.ok((game.getPrivateImpostorTrapState(impostorId)?.cooldowns.teleport ?? 0) > 0);
    assert.equal('traps' in impostorBoard.toDTO(), false);
    const trapIdsBeforeReshuffle = impostorBoard.traps.map(trap => trap.id).sort();
    impostorBoard.reshuffleImpostor(() => 0.5, true);
    assert.deepEqual(impostorBoard.traps.map(trap => trap.id).sort(), trapIdsBeforeReshuffle);
    game.destroy();
  });

  it('Should freeze good players for 30 seconds when they trigger an ice trap', () => {
    const players = [
      { id: 'impostor_ice_a', username: 'IceA', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_ice_b', username: 'IceB', isGuest: false, color: '#007AFF' },
      { id: 'impostor_ice_c', username: 'IceC', isGuest: false, color: '#34C759' },
      { id: 'impostor_ice_d', username: 'IceD', isGuest: false, color: '#FFCC00' }
    ];
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('impostor_ice_trap_test', 'impostor', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorBoard = game.board as ImpostorBoard;
    impostorBoard.walls.splice(0);
    const impostorId = game.impostorId!;
    const victimId = players.find(player => player.id !== impostorId)!.id;
    const trapCell = impostorBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => x >= 2 && !impostorBoard.isSafeZoneCell(x, y) &&
        impostorBoard.canPlaceTrap(x, y))!;
    assert.equal(game.placeImpostorTrap(impostorId, 'ice', trapCell.x, trapCell.y), true);

    for (const row of impostorBoard.grid) for (const cell of row) cell.hasPlayer = null;
    const victim = impostorBoard.players.get(victimId)!;
    victim.x = trapCell.x - 1;
    victim.y = trapCell.y;
    for (const player of impostorBoard.players.values()) {
      impostorBoard.grid[player.y][player.x].hasPlayer = player.id;
    }
    assert.equal(game.executeMove(victimId, trapCell.x, trapCell.y), true);
    assert.ok(victim.impostorFrozenUntil >= Date.now() + 29_000);
    assert.equal(impostorBoard.getImpostorValidMoves(victimId).length, 0);
    assert.equal(impostorBoard.traps.length, 0);
    assert.deepEqual(events.find(item => item.event === 'impostorTrapTriggered')?.data, {
      playerId: victimId,
      type: 'ice',
      shielded: false
    });
    game.destroy();
  });

  it('Should not spawn shield pickups in Impostor', () => {
    const players = [
      { id: 'impostor_shield_a', username: 'ShieldA', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_shield_b', username: 'ShieldB', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('impostor_no_shield_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    assert.equal(board.shieldPickups.length, 0);
    assert.ok([...board.players.values()].every(player => !player.impostorShieldActive));
    game.destroy();
  });
  it('Should not trigger the impostor own teleport trap', () => {
    const players = [
      { id: 'impostor_own_trap_a', username: 'TrapA', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_own_trap_b', username: 'TrapB', isGuest: false, color: '#007AFF' },
      { id: 'impostor_own_trap_c', username: 'TrapC', isGuest: false, color: '#34C759' },
      { id: 'impostor_own_trap_d', username: 'TrapD', isGuest: false, color: '#FFCC00' }
    ];
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('impostor_own_teleport_trap_test', 'impostor', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorBoard = game.board as ImpostorBoard;
    impostorBoard.walls.splice(0);
    const impostorId = game.impostorId!;
    const trap = impostorBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => x >= 2 && x < impostorBoard.size - 1 &&
        !impostorBoard.isSafeZoneCell(x, y) && impostorBoard.canPlaceTrap(x, y))!;
    assert.equal(game.placeImpostorTrap(impostorId, 'teleport', trap.x, trap.y), true);

    for (const row of impostorBoard.grid) for (const cell of row) cell.hasPlayer = null;
    const impostor = impostorBoard.players.get(impostorId)!;
    impostor.x = trap.x - 1;
    impostor.y = trap.y;
    const otherPlayers = [...impostorBoard.players.values()].filter(player => player.id !== impostorId);
    const fallbackCells = [
      { x: 0, y: 0 },
      { x: impostorBoard.size - 1, y: 0 },
      { x: 0, y: impostorBoard.size - 1 },
      { x: impostorBoard.size - 1, y: impostorBoard.size - 1 }
    ].filter(cell => cell.x !== impostor.x || cell.y !== impostor.y);
    otherPlayers.forEach((player, index) => {
      const cell = fallbackCells[index];
      player.x = cell.x;
      player.y = cell.y;
    });
    for (const player of impostorBoard.players.values()) {
      impostorBoard.grid[player.y][player.x].hasPlayer = player.id;
    }

    assert.equal(game.executeMove(impostorId, trap.x, trap.y), true);
    assert.deepEqual({ x: impostor.x, y: impostor.y }, trap);
    assert.equal(impostorBoard.traps.some(candidate => candidate.x === trap.x && candidate.y === trap.y), true);
    assert.equal(events.some(item => item.event === 'impostorTrapTriggered'), false);
    game.destroy();
  });

  it('Should allow a Impostor player to jump over a player directly ahead', () => {
    const game = new GameInstance('impostor_jump_test', 'impostor', [
      { id: 'impostor_jumper', username: 'Jumper', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_blocker', username: 'Blocker', isGuest: false, color: '#007AFF' }
    ], () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorBoard = game.board as ImpostorBoard;
    impostorBoard.walls.splice(0);
    const jumper = impostorBoard.players.get('impostor_jumper')!;
    const blocker = impostorBoard.players.get('impostor_blocker')!;
    for (const row of impostorBoard.grid) for (const cell of row) cell.hasPlayer = null;
    jumper.x = 10;
    jumper.y = 10;
    blocker.x = 10;
    blocker.y = 9;
    impostorBoard.grid[jumper.y][jumper.x].hasPlayer = jumper.id;
    impostorBoard.grid[blocker.y][blocker.x].hasPlayer = blocker.id;

    assert.equal(game.executeMove(jumper.id, blocker.x, blocker.y), false, 'players cannot occupy the same cell');
    assert.equal(game.executeMove(jumper.id, 10, 8), true, 'the player can jump over the pawn ahead');
    assert.deepEqual({ x: jumper.x, y: jumper.y }, { x: 10, y: 8 });
    game.destroy();
  });

  it('Should give the impostor the win when the eight-minute Impostor timer expires', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    let finishedWinner: string | null = null;
    const game = new GameInstance('impostor_timer_test', 'impostor', [
      { id: 'impostor_timer_1', username: 'Timer1', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_timer_2', username: 'Timer2', isGuest: false, color: '#007AFF' }
    ], (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    try {
      game.start();
      for (let minute = 0; minute < 8; minute++) {
        mock.timers.tick(59_000);
        game.recordPlayerActivity('impostor_timer_1');
        game.recordPlayerActivity('impostor_timer_2');
      }
      mock.timers.tick(7_999);
      assert.equal(game.state, 'playing');
      mock.timers.tick(1);
      assert.equal(game.state, 'finished');
      assert.equal(finishedWinner, game.impostorId);
    } finally {
      game.destroy();
      mock.timers.reset();
    }
  });

  it('Should award the good team the win when the impostor surrenders in Impostor', () => {
    const players = [
      { id: 'impostor_surrender_impostor', username: 'Impostor', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_surrender_good_1', username: 'Good1', isGuest: false, color: '#007AFF' },
      { id: 'impostor_surrender_good_2', username: 'Good2', isGuest: false, color: '#34C759' },
      { id: 'impostor_surrender_good_3', username: 'Good3', isGuest: false, color: '#FFCC00' }
    ];
    let finishedData: { winner: string | null; impostorEndReason?: string; impostorSurrenderedPlayerId?: string | null } | undefined;
    const game = new GameInstance('impostor_impostor_surrender_test', 'impostor', players, (event, data) => {
      if (event === 'gameFinished') finishedData = data;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorId = game.impostorId!;

    assert.equal(game.surrender(impostorId), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'good');
    assert.equal(finishedData?.winner, 'good');
    assert.equal(finishedData?.impostorEndReason, 'surrender');
    assert.equal(finishedData?.impostorSurrenderedPlayerId, impostorId);
    game.destroy();
  });

  it('Should award the impostor the win when a good Impostor player surrenders', () => {
    const players = [
      { id: 'impostor_good_surrender_1', username: 'Good1', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_good_surrender_2', username: 'Good2', isGuest: false, color: '#007AFF' },
      { id: 'impostor_good_surrender_3', username: 'Good3', isGuest: false, color: '#34C759' },
      { id: 'impostor_good_surrender_4', username: 'Good4', isGuest: false, color: '#FFCC00' }
    ];
    let finishedData: { winner: string | null; impostorEndReason?: string; impostorSurrenderedPlayerId?: string | null } | undefined;
    const game = new GameInstance('impostor_good_surrender_test', 'impostor', players, (event, data) => {
      if (event === 'gameFinished') finishedData = data;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorId = game.impostorId!;
    const goodPlayerId = players.find(player => player.id !== impostorId)!.id;

    assert.equal(game.surrender(goodPlayerId), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, impostorId);
    assert.equal(finishedData?.winner, impostorId);
    assert.equal(finishedData?.impostorEndReason, 'surrender');
    assert.equal(finishedData?.impostorSurrenderedPlayerId, goodPlayerId);
    game.destroy();
  });

  it('Should reset the global Impostor inactivity timer when any player is active', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    let finishedWinner: string | null = null;
    let finishedReason: string | undefined;
    const game = new GameInstance('impostor_idle_test', 'impostor', [
      { id: 'impostor_idle_1', username: 'Idle1', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_idle_2', username: 'Idle2', isGuest: false, color: '#007AFF' }
    ], (event, data) => {
      if (event === 'gameFinished') {
        finishedWinner = data.winner;
        finishedReason = data.impostorEndReason;
      }
    }, GAME_INSTANCE_TEST_OPTIONS);

    try {
      game.start();
      mock.timers.tick(59_000);
      game.recordPlayerActivity('impostor_idle_2');
      mock.timers.tick(59_999);
      assert.equal(game.state, 'playing', 'activity from any participant should restart the shared timer');
      mock.timers.tick(1);
      assert.equal(game.state, 'finished');
      assert.equal(finishedWinner, game.impostorId);
      assert.equal(finishedReason, 'inactivity');
    } finally {
      game.destroy();
      mock.timers.reset();
    }
  });

  it('Should not let good players win merely by caging the impostor', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `impostor_cage_${index}`,
      username: `Impostor${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    let finishedWinner: string | null = null;
    const game = new GameInstance('impostor_cage_impostor_test', 'impostor', players, (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    board.walls.splice(0);
    board.keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    impostor.x = 4;
    impostor.y = 4;
    game.board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const edge = game.board.size - 1;
    const safePositions = [{ x: 0, y: 0 }, { x: edge, y: 0 }, { x: 0, y: edge }, { x: edge, y: edge }, { x: middle, y: 0 }];
    goodPlayers.forEach((player, index) => {
      player.x = safePositions[index].x;
      player.y = safePositions[index].y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });

    const cageWalls = [
      { x: impostor.x - 1, y: impostor.y - 1, horizontal: true },
      { x: impostor.x, y: impostor.y, horizontal: true },
      { x: impostor.x - 1, y: impostor.y, horizontal: false },
      { x: impostor.x, y: impostor.y - 1, horizontal: false }
    ];
    cageWalls.slice(0, -1).forEach((wall, index) => {
      assert.equal(board.placeImpostorWall(new Wall(
        `generated_cage_${index}`,
        'board',
        wall.x,
        wall.y,
        wall.horizontal
      )), true);
    });
    const finalWall = cageWalls.at(-1)!;
    assert.equal(
      game.placeImpostorWall(impostor.id, finalWall.x, finalWall.y, finalWall.horizontal, 'impostor_cage_final'),
      true
    );
    assert.equal(finishedWinner, null);
    assert.equal(game.state, 'playing');
    assert.equal(impostor.isInPrison, true);
    assert.ok(game.board.walls.filter(wall => wall.isPrisonBlock).length >= 4);
    game.destroy();
  });

  it('Should let the impostor cage a player after that player has collected their key', () => {
    const players = [
      { id: 'impostor_key_carrier_good', username: 'KeyCarrier', isGuest: false, color: '#FF3B30' },
      { id: 'impostor_key_carrier_friend', username: 'Friend', isGuest: false, color: '#007AFF' },
      { id: 'impostor_key_carrier_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('impostor_key_carrier_cage_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    const board = game.board as ImpostorBoard;
    board.walls.splice(0);
    board.keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const goodPlayers = players
      .map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== game.impostorId);
    const [target, friend] = goodPlayers;
    const impostor = game.board.players.get(game.impostorId!)!;
    target.x = 4;
    target.y = 4;
    target.hasImpostorKey = true;
    friend.x = 0;
    friend.y = 0;
    impostor.x = 39;
    impostor.y = 39;
    for (const player of [target, friend, impostor]) {
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    }
    board.walls.push(
      new Wall('carrier_cage_north', impostor.id, target.x - 1, target.y - 1, true),
      new Wall('carrier_cage_south', impostor.id, target.x, target.y, true),
      new Wall('carrier_cage_west', impostor.id, target.x - 1, target.y, false)
    );

    assert.equal(game.state, 'playing');
    assert.equal(impostor.isInPrison, false);
    assert.equal(game.getPrivateImpostorRole(impostor.id)?.canPlaceWall, true);
    assert.equal(board.canPlaceWall(new Wall('carrier_cage_east', impostor.id, target.x, target.y - 1, false)), true);
    assert.equal(game.placeImpostorWall(impostor.id, target.x, target.y - 1, false, 'carrier_cage_east'), true);
    assert.equal(target.isInPrison, true);
    assert.equal(target.hasImpostorKey, true);
    game.destroy();
  });

  it('Should not award the impostor a win for trapping only one good player', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `impostor_wrong_cage_${index}`,
      username: `Wrong${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    let finishedWinner: string | null = null;
    const game = new GameInstance('impostor_wrong_cage_test', 'impostor', players, (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    board.walls.splice(0);
    board.keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    const edge = game.board.size - 1;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = 4;
    target.y = 4;
    game.board.grid[target.y][target.x].hasPlayer = target.id;
    goodPlayers.slice(1).forEach((player, index) => {
      const position = [{ x: 0, y: 0 }, { x: edge, y: 0 }, { x: 0, y: edge }, { x: edge, y: edge }][index];
      player.x = position.x;
      player.y = position.y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });
    impostor.x = 0;
    impostor.y = middle;
    game.board.grid[middle][0].hasPlayer = impostor.id;

    const cageWalls = [
      { x: target.x - 1, y: target.y - 1, horizontal: true },
      { x: target.x, y: target.y, horizontal: true },
      { x: target.x - 1, y: target.y, horizontal: false },
      { x: target.x, y: target.y - 1, horizontal: false }
    ];
    cageWalls.slice(0, -1).forEach((wall, index) => {
      assert.equal(board.placeImpostorWall(new Wall(
        `generated_wrong_cage_${index}`,
        'board',
        wall.x,
        wall.y,
        wall.horizontal
      )), true);
    });
    const finalWall = cageWalls.at(-1)!;
    assert.equal(
      game.placeImpostorWall(
        impostor.id,
        finalWall.x,
        finalWall.y,
        finalWall.horizontal,
        'impostor_wrong_cage_final'
      ),
      true
    );
    assert.equal(target.isInPrison, true);
    assert.equal(finishedWinner, null);
    game.destroy();
  });

  it('Should let any nearby player rescue captives without using a rescue action', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `impostor_rescue_${index}`,
      username: `Rescue${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('impostor_rescue_test', 'impostor', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    game.board.walls.splice(0);
    (game.board as ImpostorBoard).keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    const edge = game.board.size - 1;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = 4;
    target.y = 4;
    game.board.grid[target.y][target.x].hasPlayer = target.id;
    goodPlayers.slice(1).forEach((player, index) => {
      const position = [{ x: 0, y: 0 }, { x: edge, y: 0 }, { x: 0, y: edge }, { x: edge, y: edge }][index];
      player.x = position.x;
      player.y = position.y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });

    impostor.x = middle;
    impostor.y = 0;
    game.board.grid[0][middle].hasPlayer = impostor.id;

    const cageWalls = [
      { x: target.x - 1, y: target.y - 1, horizontal: true },
      { x: target.x, y: target.y, horizontal: true },
      { x: target.x - 1, y: target.y, horizontal: false },
      { x: target.x, y: target.y - 1, horizontal: false }
    ];
    cageWalls.forEach((wall, index) => {
      if (index > 0) mock.timers.tick(IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS);
      assert.equal(game.placeImpostorWall(impostor.id, wall.x, wall.y, wall.horizontal, `impostor_cage_${index}`), true);
    });
    assert.equal(target.isInPrison, true);
    assert.ok(game.getImpostorRescueStatus().availableRescuers >= 3);
    const rescuer = goodPlayers[1];
    const previousPosition = { x: rescuer.x, y: rescuer.y };
    game.board.grid[previousPosition.y][previousPosition.x].hasPlayer = null;
    rescuer.x = target.x + 1;
    rescuer.y = target.y;
    game.board.grid[rescuer.y][rescuer.x].hasPlayer = rescuer.id;
    assert.equal(game.rescueImpostorPlayer(rescuer.id, target.id), true);
    assert.equal(target.isInPrison, false);
    assert.equal(game.getPrivateImpostorRole(rescuer.id)?.canRescue, true);
    assert.equal(game.rescueImpostorPlayer(rescuer.id, target.id), false, 'the target is no longer imprisoned');
    assert.equal(game.getImpostorPublicActionCounts()[rescuer.id], 0);
    assert.ok(game.board.walls.some(wall => wall.isSabotageWall));
    assert.ok(events.some(({ event, data }) =>
      event === 'impostorPublicEvent' && data.type === 'player_rescued'
    ));
    game.destroy();
    mock.timers.reset();
  });

  it('Should award the impostor a capture win only after caging every good player', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `impostor_unlimited_break_${index}`,
      username: `Unlimited${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    const game = new GameInstance('impostor_unlimited_break_test', 'impostor', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as ImpostorBoard;
    board.walls = [];
    board.keys = [];
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = board.players.get(game.impostorId!)!;
    impostor.x = 39;
    impostor.y = 39;
    board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;
    const goods = players
      .map(player => board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const prisonerPositions = [{ x: 4, y: 4 }, { x: 9, y: 9 }, { x: 30, y: 30 }, { x: 35, y: 35 }];
    let wallsPlaced = 0;
    goods.forEach((player, index) => {
      const position = prisonerPositions[index] || { x: 0, y: 0 };
      player.x = position.x;
      player.y = position.y;
      board.grid[player.y][player.x].hasPlayer = player.id;
      if (index >= prisonerPositions.length) return;
      const cageWalls = [
        { x: position.x - 1, y: position.y - 1, horizontal: true },
        { x: position.x, y: position.y, horizontal: true },
        { x: position.x - 1, y: position.y, horizontal: false },
        { x: position.x, y: position.y - 1, horizontal: false }
      ];
      cageWalls.forEach((wall, wallIndex) => {
        if (wallsPlaced > 0) mock.timers.tick(IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS);
        assert.equal(
          game.placeImpostorWall(impostor.id, wall.x, wall.y, wall.horizontal, `unlimited_cage_${index}_${wallIndex}`),
          true
        );
        wallsPlaced++;
      });
    });

    assert.equal(goods.slice(0, prisonerPositions.length).filter(player => player.isInPrison).length, 4);
    assert.equal(game.state, 'playing');

    const lastGood = goods.at(-1)!;
    lastGood.x = 34;
    lastGood.y = 4;
    board.grid[0][0].hasPlayer = null;
    board.grid[lastGood.y][lastGood.x].hasPlayer = lastGood.id;
    const finalCageWalls = [
      { x: lastGood.x - 1, y: lastGood.y - 1, horizontal: true },
      { x: lastGood.x, y: lastGood.y, horizontal: true },
      { x: lastGood.x - 1, y: lastGood.y, horizontal: false },
      { x: lastGood.x, y: lastGood.y - 1, horizontal: false }
    ];
    finalCageWalls.forEach((wall, index) => {
      mock.timers.tick(IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS);
      assert.equal(
        game.placeImpostorWall(impostor.id, wall.x, wall.y, wall.horizontal, `unlimited_final_cage_${index}`),
        true
      );
    });
    assert.equal(lastGood.isInPrison, true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, impostor.id);
    game.destroy();
    mock.timers.reset();
  });

  it('Should require a hammer to break player-placed adjacent walls', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `impostor_break_${index}`,
      username: `Break${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('impostor_break_test', 'impostor', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    game.board.walls.splice(0);
    (game.board as ImpostorBoard).keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    const edge = game.board.size - 1;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = 4;
    target.y = 4;
    game.board.grid[target.y][target.x].hasPlayer = target.id;
    goodPlayers.slice(1).forEach((player, index) => {
      const position = [{ x: 0, y: 0 }, { x: edge, y: 0 }, { x: 0, y: edge }, { x: edge, y: edge }][index];
      player.x = position.x;
      player.y = position.y;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });
    impostor.x = 10;
    impostor.y = 0;
    game.board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;

    const cageWalls = [
      { x: target.x - 1, y: target.y - 1, horizontal: true },
      { x: target.x, y: target.y, horizontal: true },
      { x: target.x - 1, y: target.y, horizontal: false },
      { x: target.x, y: target.y - 1, horizontal: false }
    ];
    cageWalls.forEach((wall, index) => {
      if (index > 0) mock.timers.tick(IMPOSTOR_WALL_PLACEMENT_COOLDOWN_MS);
      assert.equal(game.placeImpostorWall(impostor.id, wall.x, wall.y, wall.horizontal, `impostor_break_cage_${index}`), true);
    });
    const impostorBoard = game.board as ImpostorBoard;
    const releaseWall = impostorBoard.getImpostorReleaseWalls(target.id)
      .find(wall => wall.isSabotageWall);
    assert.ok(releaseWall);
    assert.equal(game.breakImpostorBlock(target.id, releaseWall.id), false, 'an imprisoned player cannot break their cage');
    const rescuer = goodPlayers[1];
    assert.equal(game.breakImpostorBlock(rescuer.id, releaseWall.id), false, 'the player must stand next to the wall');

    game.board.grid[rescuer.y][rescuer.x].hasPlayer = null;
    const adjacentCells = releaseWall.isHorizontal
      ? [
          { x: releaseWall.x, y: releaseWall.y },
          { x: releaseWall.x, y: releaseWall.y + 1 },
          { x: releaseWall.x + 1, y: releaseWall.y },
          { x: releaseWall.x + 1, y: releaseWall.y + 1 }
        ]
      : [
          { x: releaseWall.x, y: releaseWall.y },
          { x: releaseWall.x + 1, y: releaseWall.y },
          { x: releaseWall.x, y: releaseWall.y + 1 },
          { x: releaseWall.x + 1, y: releaseWall.y + 1 }
        ];
    const adjacentCell = adjacentCells.find(cell =>
      ![...game.board.players.values()].some(player =>
        player.id !== rescuer.id && player.x === cell.x && player.y === cell.y
      )
    );
    assert.ok(adjacentCell);
    rescuer.x = adjacentCell.x;
    rescuer.y = adjacentCell.y;
    assert.equal(impostorBoard.isPlayerAdjacentToWall(rescuer.id, releaseWall), true);
    game.board.grid[rescuer.y][rescuer.x].hasPlayer = rescuer.id;
    assert.equal(game.breakImpostorBlock(rescuer.id, releaseWall.id), false,
      'a good player without a hammer cannot break a wall');
    rescuer.impostorTool = 'hammer';
    assert.equal(game.breakImpostorBlock(rescuer.id, releaseWall.id), true);
    assert.equal(target.isInPrison, false);
    assert.equal(game.getImpostorPublicActionCounts()[rescuer.id], 0);
    assert.ok(events.some(({ event, data }) =>
      event === 'impostorStateChanged' && data.publicActionCounts[rescuer.id] === 0
    ));
    assert.equal(events.some(({ event, data }) =>
      event === 'impostorPublicEvent' &&
      (data.type === 'impostor_sabotage' || data.type === 'player_wall_placed')
    ), false, 'placing a wall must not produce a public notification');
    assert.ok(events.some(({ event, data }) =>
      event === 'impostorPublicEvent' && data.type === 'player_broke_prison_wall'
    ));
    const goodOwnedWall = new Wall('good_owned_wall', goodPlayers[0].id, 32, 32, true);
    assert.equal(impostorBoard.placeImpostorWall(goodOwnedWall), true);
    game.board.grid[impostor.y][impostor.x].hasPlayer = null;
    impostor.x = 32;
    impostor.y = 32;
    impostor.impostorTool = 'hammer';
    game.board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;
    assert.equal(game.breakImpostorBlock(impostor.id, goodOwnedWall.id), true,
      'the impostor can break a wall placed by a good player');
    const generatedWall = new Wall('impostor_generated_wall', 'board', 32, 32, false);
    assert.equal(impostorBoard.placeImpostorWall(generatedWall), true);
    assert.equal(game.breakImpostorBlock(impostor.id, generatedWall.id), false,
      'generated impostor walls cannot be broken');
    game.destroy();
    mock.timers.reset();
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
    const game = new GameInstance('bot_match_abandon', 'FFA', players, (event, data) => {
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
    const room = roomService.createRoom('p1', 'Player1', false, 'Killer FFA', 'FFA');
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
    const room = roomService.createRoom('swap1', 'Player1', false, 'Swap FFA', 'FFA');
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

  it('Should keep a 2v2 match running when a player surrenders without eliminating their teammate', () => {
    const players = [
      { id: 'surrender_human', username: 'Human', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'bot_surrender', username: 'BOT Red', isGuest: true, color: '#F59E0B', team: 1 },
      { id: 'opponent_human', username: 'Opponent', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'bot_opponent', username: 'BOT Blue', isGuest: true, color: '#34C759', team: 2 }
    ];
    let finishedWinner: string | null | undefined;
    const game = new GameInstance('team_surrender_test', '2v2', players, (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.equal(game.hasBots(), true);
    game.surrender('surrender_human');

    assert.equal(game.state, 'playing');
    assert.equal(finishedWinner, undefined);
    assert.equal(game.board.players.get('surrender_human')?.isDead, true);
    assert.equal(game.board.players.get('bot_surrender')?.isDead, false);
    assert.equal(game.board.players.get('opponent_human')?.isDead, false);
    assert.equal(game.board.players.get('bot_opponent')?.isDead, false);
    game.destroy();
  });

  it('Should require both 2v2 teammates to reach the goal and let a reached player place remaining walls', () => {
    const players = [
      { id: 'goal_team_1a', username: 'Red 1', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'goal_team_2a', username: 'Blue 1', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'goal_team_1b', username: 'Red 2', isGuest: false, color: '#F59E0B', team: 1 },
      { id: 'goal_team_2b', username: 'Blue 2', isGuest: false, color: '#34C759', team: 2 }
    ];
    const game = new GameInstance('team_both_reach_goal_test', '2v2', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board;
    board.boosts = [];
    board.grid.forEach(row => row.forEach(cell => cell.hasBoost = null));
    const movePlayerTo = (id: string, x: number, y: number) => {
      const player = board.players.get(id)!;
      board.grid[player.y][player.x].hasPlayer = null;
      player.x = x;
      player.y = y;
      board.grid[y][x].hasPlayer = id;
    };
    movePlayerTo('goal_team_1a', 0, 1);
    movePlayerTo('goal_team_2a', 1, 5);
    movePlayerTo('goal_team_1b', 10, 1);
    movePlayerTo('goal_team_2b', 9, 5);

    assert.equal(game.executeMove('goal_team_1a', 0, 0), true);
    assert.equal(board.players.get('goal_team_1a')?.hasReachedGoal, true);
    assert.equal(game.state, 'playing');

    assert.equal(game.executeMove('goal_team_2a', 2, 5), true);
    assert.equal(game.executeMove('goal_team_1b', 9, 1), true);
    assert.equal(game.executeMove('goal_team_2b', 8, 5), true);
    assert.equal(game.getCurrentPlayer(), 'goal_team_1a');
    assert.equal(game.executeMove('goal_team_1a', 0, 1), false);
    assert.equal(game.executeWall('goal_team_1a', 'goal-helper-wall', 4, 4, true), true);
    assert.equal(board.players.get('goal_team_1a')?.wallsLeft, 6);

    assert.equal(game.executeMove('goal_team_2a', 3, 5), true);
    assert.equal(game.executeMove('goal_team_1b', 9, 0), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'goal_team_1b');
    game.destroy();
  });

  it('Should automatically skip a 2v2 player who reached the goal and has no walls left', () => {
    const players = [
      { id: 'skip_team_1a', username: 'Red 1', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'skip_team_2a', username: 'Blue 1', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'skip_team_1b', username: 'Red 2', isGuest: false, color: '#F59E0B', team: 1 },
      { id: 'skip_team_2b', username: 'Blue 2', isGuest: false, color: '#34C759', team: 2 }
    ];
    const game = new GameInstance('team_skip_finished_turn_test', '2v2', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const reachedPlayer = game.board.players.get('skip_team_1a')!;
    reachedPlayer.hasReachedGoal = true;
    reachedPlayer.wallsLeft = 0;
    game.currentTurnIndex = game.playersList.indexOf('skip_team_2b');

    game.nextTurn();

    assert.equal(game.getCurrentPlayer(), 'skip_team_2a');
    assert.equal(game.state, 'playing');
    game.destroy();
  });

  it('Should not let a remaining 2v2 player win alone after their teammate is removed', () => {
    const players = [
      { id: 'removed_team_1a', username: 'Red 1', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'removed_team_2a', username: 'Blue 1', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'removed_team_1b', username: 'Red 2', isGuest: false, color: '#F59E0B', team: 1 },
      { id: 'removed_team_2b', username: 'Blue 2', isGuest: false, color: '#34C759', team: 2 }
    ];
    const game = new GameInstance('team_removed_teammate_test', '2v2', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board;
    board.boosts = [];
    board.walls.splice(0);
    board.grid.forEach(row => row.forEach(cell => {
      cell.hasBoost = null;
      cell.hasPlayer = null;
    }));
    const removedIndex = game.playersList.indexOf('removed_team_1b');
    game.playersList.splice(removedIndex, 1);
    board.players.delete('removed_team_1b');

    const runner = board.players.get('removed_team_1a')!;
    const opponentA = board.players.get('removed_team_2a')!;
    const opponentB = board.players.get('removed_team_2b')!;
    Object.assign(runner, { x: 0, y: 1 });
    Object.assign(opponentA, { x: 5, y: 5 });
    Object.assign(opponentB, { x: 8, y: 5 });
    board.grid[runner.y][runner.x].hasPlayer = runner.id;
    board.grid[opponentA.y][opponentA.x].hasPlayer = opponentA.id;
    board.grid[opponentB.y][opponentB.x].hasPlayer = opponentB.id;
    game.currentTurnIndex = game.playersList.indexOf(runner.id);

    assert.equal(game.executeMove(runner.id, 0, 0), true);
    assert.equal(runner.hasReachedGoal, true);
    assert.equal(game.state, 'playing');
    assert.equal(game.winner, null);
    game.destroy();
  });

  it('Should accept an FFA surrender while keeping the remaining players in the match', () => {
    const players = [
      { id: 'ffa_surrender', username: 'Player', isGuest: false, color: '#FF3B30' },
      { id: 'ffa_rival_1', username: 'Rival 1', isGuest: false, color: '#007AFF' },
      { id: 'ffa_rival_2', username: 'Rival 2', isGuest: false, color: '#34C759' },
      { id: 'ffa_rival_3', username: 'Rival 3', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('ffa_surrender_test', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.equal(game.surrender('ffa_surrender'), true);

    assert.equal(game.state, 'playing');
    assert.equal(game.board.players.get('ffa_surrender')?.isDead, true);
    assert.equal(game.board.players.get('ffa_rival_1')?.isDead, false);
    assert.equal(game.surrender('ffa_surrender'), false);
    game.destroy();
  });

  it('Should keep an FFA match running when its owner surrenders but real players remain', () => {
    const players = [
      { id: 'ffa_host', username: 'Host', isGuest: false, color: '#FF3B30' },
      { id: 'ffa_real_player', username: 'Player', isGuest: false, color: '#007AFF' },
      { id: 'bot_ffa_one', username: 'BOT 1', isGuest: true, color: '#34C759' },
      { id: 'bot_ffa_two', username: 'BOT 2', isGuest: true, color: '#FFCC00' }
    ];
    const game = new GameInstance('ffa_owner_surrender_test', 'FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.equal(game.surrender('ffa_host'), true);

    assert.equal(game.state, 'playing');
    assert.equal(game.board.players.get('ffa_host')?.isDead, true);
    assert.equal(game.board.players.get('ffa_real_player')?.isDead, false);
    game.destroy();
  });

  it('Should abandon an FFA match if surrender leaves only bots alive', () => {
    const players = [
      { id: 'ffa_last_human', username: 'Host', isGuest: false, color: '#FF3B30' },
      { id: 'bot_ffa_last_one', username: 'BOT 1', isGuest: true, color: '#007AFF' },
      { id: 'bot_ffa_last_two', username: 'BOT 2', isGuest: true, color: '#34C759' },
      { id: 'bot_ffa_last_three', username: 'BOT 3', isGuest: true, color: '#FFCC00' }
    ];
    let finishData: { winner: string | null; abandoned: boolean } | null = null;
    const game = new GameInstance('ffa_bots_only_surrender_test', 'FFA', players, (event, data) => {
      if (event === 'gameFinished') finishData = data;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.equal(game.surrender('ffa_last_human'), true);

    assert.equal(game.state, 'finished');
    assert.deepEqual(finishData, { winner: null, durationSeconds: 1, abandoned: true });
    game.destroy();
  });
});
