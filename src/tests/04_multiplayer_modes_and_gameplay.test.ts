import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './test-helper.js';
import { container } from 'tsyringe';
import { RoomService } from '../services/room.service.js';
import { GameInstance, LABYRINTH_GHOST_DURATION_MS } from '../game/engine/game-instance.js';
import { MazeBoard } from '../game/engine/maze-board.js';
import { Player, Wall } from '../game/engine/models.js';
import { MazeAuditService } from '../services/maze-audit.service.js';
import { MazeMatchAuditState } from '../models/maze-match-audit-state.entity.js';
import { AppDataSource } from '../config/database.config.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

describe('04 - Multiplayer Modes (4-FFA, 2v2) & Core Game Mechanics Tests', () => {
  let roomService: RoomService;

  before(async () => {
    await setupTestEnvironment();
    roomService = container.resolve(RoomService);
  });

  it('Should let a ghost move diagonally in a straight line through maze walls', () => {
    const board = new MazeBoard(10);
    const ghost = new Player('maze_diagonal_ghost', 'Ghost', false, 1, 1);
    board.addPlayer(ghost);
    ghost.ghostModeExpiresAt = Date.now() + 10_000;
    board.walls.push(new Wall('ghost_path_wall', 'maze', 1, 1, true));

    assert.ok(board.getMazeValidMoves(ghost.id).some(move => move.x === 2 && move.y === 2));
    assert.equal(board.moveMazePlayer(ghost.id, 2, 2), true);
    assert.deepEqual({ x: ghost.x, y: ghost.y }, { x: 2, y: 2 });
  });

  it('Should capture complete Maze board and role data in audit snapshots', () => {
    const players = [
      { id: 'maze_audit_good', username: 'AuditGood', isGuest: false, color: '#FF3B30' },
      { id: 'maze_audit_other', username: 'AuditOther', isGuest: false, color: '#007AFF' },
      { id: 'maze_audit_impostor', username: 'AuditImpostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('maze_audit_snapshot_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();

    const snapshot = game.getMazeAuditSnapshot() as {
      state: string;
      impostorId: string;
      players: Array<{ id: string; role: string; x: number; y: number }>;
      board: {
        size: number;
        walls: unknown[];
        keys: unknown[];
        exits: unknown[];
        teleports: unknown[];
        extraction: { x: number; y: number };
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
    assert.deepEqual(snapshot.board.extraction, {
      x: Math.floor(snapshot.board.size / 2),
      y: Math.floor(snapshot.board.size / 2)
    });
    assert.ok(snapshot.board.teleports.length > 0);
    game.destroy();
  });

  it('Should allow any player to collect any free Maze key, but only one key per player', () => {
    const board = new MazeBoard(10);
    const owner = new Player('maze_key_owner', 'KeyOwner', false, 1, 1);
    const other = new Player('maze_key_other', 'Other', false, 2, 1);
    board.addPlayer(owner);
    board.addPlayer(other);
    board.keys = [
      { id: 'maze_key_one', x: 3, y: 3 },
      { id: 'maze_key_two', x: 4, y: 4 }
    ];

    assert.equal(board.collectKey(other.id, 3, 3)?.id, 'maze_key_one',
      'a player can collect a key regardless of which key it is');
    other.hasMazeKey = true;
    assert.equal(board.collectKey(other.id, 4, 4), null,
      'a player carrying a key cannot collect a second one');
    assert.equal(board.collectKey(owner.id, 4, 4)?.id, 'maze_key_two');
    owner.hasMazeKey = true;
    owner.hasMazeKeyDelivered = true;
    assert.equal(board.collectKey(owner.id, 3, 3), null,
      'a player who delivered their key still cannot collect another one');
    assert.equal(board.keys.length, 0);
  });

  it('Should prevent walls from making an uncollected key unreachable', () => {
    const board = new MazeBoard(6);
    const owner = new Player('maze_key_access_owner', 'KeyOwner', false, 0, 3);
    board.addPlayer(owner);
    board.keys = [{ id: 'maze_key_access', x: 3, y: 3 }];
    board.walls.push(
      new Wall('key_north', 'maze', 2, 2, true),
      new Wall('key_south', 'maze', 3, 3, true),
      new Wall('key_east', 'maze', 3, 2, false)
    );
    const closingWall = new Wall('key_west', 'maze', 2, 3, false);

    assert.equal(board.isMazeCellReachable(owner.x, owner.y, 3, 3), true);
    assert.equal(board.wouldMakeUncollectedKeyUnreachable(closingWall), true);
    assert.equal(board.walls.length, 3, 'validation must not leave the preview wall on the board');

    board.keys = [];
    assert.equal(board.wouldMakeUncollectedKeyUnreachable(closingWall), false);
  });

  it('Should prevent good walls from disconnecting teammates', () => {
    const board = new MazeBoard(6);
    const goodA = new Player('maze_connection_a', 'GoodA', false, 0, 3);
    const goodB = new Player('maze_connection_b', 'GoodB', false, 5, 3);
    board.addPlayer(goodA);
    board.addPlayer(goodB);
    board.walls.push(
      new Wall('maze_barrier_upper', 'maze', 2, 0, false),
      new Wall('maze_barrier_lower', 'maze', 2, 4, false)
    );
    const closingWall = new Wall('maze_barrier_middle', 'maze', 2, 2, false);

    assert.equal(board.isMazeCellReachable(goodA.x, goodA.y, goodB.x, goodB.y), true);
    assert.equal(board.wouldSeparatePlayersWithWall(closingWall, [goodA.id, goodB.id]), true);
    assert.equal(board.walls.length, 2, 'validation must not leave the preview wall on the board');
  });

  it('Should reject a good wall that disconnects teammates during a Maze game', () => {
    const players = [
      { id: 'maze_cut_good_a', username: 'GoodA', isGuest: false, color: '#FF3B30' },
      { id: 'maze_cut_good_b', username: 'GoodB', isGuest: false, color: '#007AFF' },
      { id: 'maze_cut_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('maze_cut_teammates_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as MazeBoard;
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
      if (y !== 2) board.walls.push(new Wall(`maze_cut_barrier_${y}`, 'maze', 19, y, false));
    }

    assert.equal(game.placeMazeWall(goodPlayers[0].id, 19, 2, false, 'maze_cut_teammates'), false);
    assert.equal(board.walls.length, 19);
    game.destroy();
  });

  it('Should persist ordered Maze audit states', async () => {
    const auditService = container.resolve(MazeAuditService);
    const matchId = `maze_audit_persist_${Date.now()}`;
    try {
      await Promise.all([
        auditService.recordState(matchId, 'game_created', { status: 'waiting', board: { size: 40 } }),
        auditService.recordState(matchId, 'mazeStateChanged', { status: 'playing', playerX: 4 }),
        auditService.recordState(matchId, 'game_finished', { status: 'finished', winner: 'good' })
      ]);
      const storedStates = await AppDataSource.getRepository(MazeMatchAuditState).find({
        where: { matchId },
        order: { sequence: 'ASC' }
      });

      it('Should continue audit sequences when a room id has previous persisted states', async () => {
        const auditService = container.resolve(MazeAuditService);
        const matchId = `maze_audit_resume_${Date.now()}`;
        try {
          await auditService.recordState(matchId, 'previous_game_finished', { status: 'finished' });
          await auditService.releaseMatch(matchId);
          await auditService.recordState(matchId, 'game_created', { status: 'waiting' });

          const storedStates = await AppDataSource.getRepository(MazeMatchAuditState).find({
            where: { matchId },
            order: { sequence: 'ASC' }
          });
          assert.deepEqual(storedStates.map(state => state.sequence), [1, 2]);
          assert.equal(storedStates[1].event, 'game_created');
        } finally {
          await AppDataSource.getRepository(MazeMatchAuditState).delete({ matchId });
          await auditService.releaseMatch(matchId);
        }
      });

      it('Should preserve unique ordered audit sequences across concurrent service instances', async () => {
        const firstService = new MazeAuditService();
        const secondService = new MazeAuditService();
        const matchId = `maze_audit_concurrent_${Date.now()}_${Math.random()}`;
        try {
          await Promise.all(Array.from({ length: 20 }, (_, index) =>
            (index % 2 === 0 ? firstService : secondService).recordState(
              matchId,
              `concurrent_event_${index}`,
              { index }
            )
          ));

          const storedStates = await AppDataSource.getRepository(MazeMatchAuditState).find({
            where: { matchId },
            order: { sequence: 'ASC' }
          });
          assert.deepEqual(storedStates.map(state => state.sequence), Array.from({ length: 20 }, (_, index) => index + 1));
          assert.equal(new Set(storedStates.map(state => state.event)).size, 20);
        } finally {
          await AppDataSource.getRepository(MazeMatchAuditState).delete({ matchId });
          await Promise.all([
            firstService.releaseMatch(matchId),
            secondService.releaseMatch(matchId)
          ]);
        }
      });

      assert.deepEqual(storedStates.map(state => state.sequence), [1, 2, 3]);
      assert.deepEqual(storedStates.map(state => state.event), [
        'game_created',
        'mazeStateChanged',
        'game_finished'
      ]);
      assert.deepEqual(storedStates[2].snapshot, { status: 'finished', winner: 'good' });
    } finally {
      await AppDataSource.getRepository(MazeMatchAuditState).delete({ matchId });
      await auditService.releaseMatch(matchId);
    }
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

  it('Should prevent two room participants from selecting the same pawn skin', () => {
    const room = roomService.createRoom('maze_skin_owner', 'SkinOwner', false, 'Skin room', 'labyrinth');
    roomService.joinRoom(room.id, 'maze_skin_other', 'SkinOther', false);
    roomService.setPlayerCosmetic(room.id, 'maze_skin_owner', 'PAWN_SKIN', 'skin_unique');

    assert.throws(
      () => roomService.setPlayerCosmetic(room.id, 'maze_skin_other', 'PAWN_SKIN', 'skin_unique'),
      /Pawn skin is already taken/
    );

    roomService.setPlayerCosmetic(room.id, 'maze_skin_owner', 'PAWN_SKIN', null);
    assert.doesNotThrow(() =>
      roomService.setPlayerCosmetic(room.id, 'maze_skin_other', 'PAWN_SKIN', 'skin_unique')
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

  it('Should keep exactly four cardinal entrances around the central Labyrinth and hide wall owners', () => {
    class InspectableMazeBoard extends MazeBoard {
      public isPassageBlocked(fromX: number, fromY: number, toX: number, toY: number): boolean {
        return this.isWallBlocking(fromX, fromY, toX, toY);
      }
    }

    const board = new InspectableMazeBoard(20);
    for (let index = 0; index < 6; index++) {
      board.addPlayer(new Player(`maze_gate_${index}`, `Gate${index}`, false, index, 0));
    }
    board.generateRandomMazeWalls(16, () => 0.5, 6);

    const centerWalls = board.walls.filter(wall => wall.id.startsWith('maze_center_'));
    assert.equal(centerWalls.length, 12);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('maze_center_n_')).length, 3);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('maze_center_s_')).length, 3);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('maze_center_e_')).length, 3);
    assert.equal(centerWalls.filter(wall => wall.id.startsWith('maze_center_w_')).length, 3);
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
    assert.ok(dto.walls.every(wall => wall.ownerId === 'maze'));
    assert.ok(dto.walls.every(wall => 'isSabotageWall' in wall));
  });

  it('Should always generate four exits with two humans and four bots', () => {
    const board = new MazeBoard(20);
    const players = [
      ['maze_two_humans_1', false],
      ['maze_two_humans_2', false],
      ['bot_maze_two_1', true],
      ['bot_maze_two_2', true],
      ['bot_maze_two_3', true],
      ['bot_maze_two_4', true]
    ] as const;
    players.forEach(([id, isGuest], index) =>
      board.addPlayer(new Player(id, id, isGuest, index, 0))
    );
    board.generateRandomMazeWalls(0, () => 0.5, players.length);

    assert.equal(board.exits.length, 4);
    assert.equal(new Set(board.exits.map(exit => `${exit.x},${exit.y}`)).size, 4);
    assert.ok(board.exits.every(exit => exit.playerId.startsWith('maze_two_humans_')));
  });

  it('Should block both directions through a sealed central gate', () => {
    const board = new MazeBoard(20);
    const players = Array.from({ length: 6 }, (_, index) =>
      new Player(`maze_sealed_gate_${index}`, `Gate${index}`, false, index, 0)
    );
    players.forEach(player => board.addPlayer(player));
    board.generateRandomMazeWalls(16, () => 0.5, 6);
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

    assert.ok(board.getMazeValidMoves(movingPlayer.id).some(move =>
      move.x === insideCell.x && move.y === insideCell.y
    ));
    board.sealMazeExit(northExit.id, 10_000);
    assert.ok(!board.getMazeValidMoves(movingPlayer.id).some(move =>
      move.x === insideCell.x && move.y === insideCell.y
    ));
    movingPlayer.ghostModeExpiresAt = Date.now() + 10_000;
    assert.ok(!board.getMazeValidMoves(movingPlayer.id).some(move =>
      move.x === insideCell.x && move.y === insideCell.y
    ));
    movingPlayer.ghostModeExpiresAt = 0;

    board.grid[outsideCell.y][outsideCell.x].hasPlayer = null;
    movingPlayer.x = insideCell.x;
    movingPlayer.y = insideCell.y;
    board.grid[insideCell.y][insideCell.x].hasPlayer = movingPlayer.id;
    assert.ok(!board.getMazeValidMoves(movingPlayer.id).some(move =>
      move.x === outsideCell.x && move.y === outsideCell.y
    ));
    assert.equal(board.openMazeExit(northExit.id), 1);
    assert.ok(board.getMazeValidMoves(movingPlayer.id).some(move =>
      move.x === outsideCell.x && move.y === outsideCell.y
    ));
  });

  it('Should only let a nearby good player reopen a sealed Labyrinth exit', () => {
    const emittedEvents: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('maze_open_gate_test', 'labyrinth', [
      { id: 'maze_open_good_1', username: 'Good 1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_open_good_2', username: 'Good 2', isGuest: false, color: '#007AFF' }
    ], (event, data) => emittedEvents.push({ event, data }), GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as MazeBoard;
    const exit = board.exits[0];
    const impostorId = game.impostorId!;
    const goodPlayerId = game.playersList.find(id => id !== impostorId)!;
    const player = board.players.get(goodPlayerId)!;
    const farCell = { x: exit.x, y: exit.y === 0 ? exit.y + 2 : exit.y - 2 };
    board.grid[player.y][player.x].hasPlayer = null;
    player.x = farCell.x;
    player.y = farCell.y;
    board.grid[player.y][player.x].hasPlayer = goodPlayerId;
    board.sealMazeExit(exit.id, 10_000);

    assert.equal(game.openMazeExit(impostorId, exit.id), false);
    assert.equal(game.openMazeExit(goodPlayerId, exit.id), false);
    player.y = exit.y < game.board.size / 2 ? exit.y + 1 : exit.y - 1;
    board.grid[farCell.y][farCell.x].hasPlayer = null;
    board.grid[player.y][player.x].hasPlayer = goodPlayerId;
    assert.equal(game.openMazeExit(goodPlayerId, exit.id), true);
    assert.equal(exit.disabledUntil, 0);
    assert.ok(emittedEvents.some(({ event, data }) =>
      event === 'mazeStateChanged' && data.mazeExitOpenUsedBy.includes(goodPlayerId)
    ));

    const nextExit = board.exits[1];
    board.sealMazeExit(nextExit.id, 10_000);
    board.grid[player.y][player.x].hasPlayer = null;
    player.x = nextExit.x < game.board.size / 2 ? nextExit.x + 1 : nextExit.x - 1;
    player.y = nextExit.y;
    board.grid[player.y][player.x].hasPlayer = goodPlayerId;
    assert.equal(game.openMazeExit(goodPlayerId, nextExit.id), false);
    game.destroy();
  });

  it('Should only teleport after an explicit request from a paired portal', () => {
    const players = [
      { id: 'maze_teleport_player', username: 'Traveler', isGuest: false, color: '#FF3B30' },
      { id: 'maze_teleport_other', username: 'Other', isGuest: false, color: '#007AFF' }
    ];
    const game = new GameInstance('maze_teleport_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    assert.equal(game.getMazeSecondsUntilChange(), 0, 'the impostor can change the maze immediately at match start');
    const mazeBoard = game.board as MazeBoard;
    const source = mazeBoard.teleports[0];
    const destination = mazeBoard.teleports.find(portal => portal.pairId === source.pairId && portal.id !== source.id)!;
    const traveler = game.board.players.get(players[0].id)!;
    const other = game.board.players.get(players[1].id)!;
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;
    game.board.walls.splice(0);
    traveler.x = source.x - 1;
    traveler.y = source.y;
    game.board.grid[traveler.y][traveler.x].hasPlayer = traveler.id;
    other.x = 0;
    other.y = 0;
    game.board.grid[0][0].hasPlayer = other.id;

    assert.equal(game.teleportMazePlayer(traveler.id, source.id), false, 'the player must stand on the portal');
    assert.equal(game.executeMove(traveler.id, source.x, source.y), true);
    assert.deepEqual({ x: traveler.x, y: traveler.y }, { x: source.x, y: source.y });
    assert.equal(game.teleportMazePlayer(traveler.id, source.id), true);
    assert.deepEqual({ x: traveler.x, y: traveler.y }, { x: destination.x, y: destination.y });
    assert.equal(game.teleportMazePlayer(traveler.id, source.id), false, 'the player must be at the selected portal');
    const impostor = game.board.players.get(game.impostorId!)!;
    const nonImpostor = game.board.players.get(players.find(player => player.id !== impostor.id)!.id)!;
    assert.equal(game.changeMazeLayout(nonImpostor.id), false, 'only the impostor can change the maze');
    assert.equal(game.changeMazeLayout(impostor.id, () => 0.37), true);
    assert.equal(game.getMazeSecondsUntilChange(), 30);
    assert.equal(game.changeMazeLayout(impostor.id, () => 0.37), false, 'the ability has a 30-second cooldown');
    assert.equal(game.getMazeSecondsUntilChange(Date.now() + 30_000), 0);
    game.destroy();
  });

  it('Should allow only the impostor to place a wall and refresh shared sabotage charges each maze cycle', () => {
    const players = [
      { id: 'maze_sabotage_good_1', username: 'Good1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_sabotage_good_2', username: 'Good2', isGuest: false, color: '#007AFF' },
      { id: 'maze_sabotage_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' },
      { id: 'maze_sabotage_good_3', username: 'Good3', isGuest: false, color: '#34C759' }
    ];
    const game = new GameInstance('maze_sabotage_options_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    const good = game.board.players.get(players.find(player => player.id !== game.impostorId)!.id)!;
    const impostor = game.board.players.get(game.impostorId!)!;
    const portal = (game.board as MazeBoard).teleports[0];

    assert.equal(game.placeMazeWall(good.id, 1, 1, true, 'good_wall_1'), true);
    assert.equal(game.placeMazeWall(good.id, 3, 3, false, 'good_wall_2'), false);
    assert.equal(game.getPrivateMazeRole(good.id)?.canPlaceWall, false);
    assert.equal(game.placeMazeWall(impostor.id, 3, 3, false, 'impostor_wall'), true);
    assert.equal(game.getPrivateMazeRole(impostor.id)?.sabotageActionsRemaining, 2);
    assert.equal(game.jamMazeTeleport(impostor.id, portal.id), true);
    assert.equal(game.getPrivateMazeRole(impostor.id)?.sabotageActionsRemaining, 1);
    const pair = (game.board as MazeBoard).teleports.filter(item => item.pairId === portal.pairId);
    assert.equal(pair.length, 2);
    assert.ok(pair.every(item => (item.disabledUntil ?? 0) > Date.now()));
    const exit = (game.board as MazeBoard).exits[0];
    assert.equal(game.sealMazeExit(impostor.id, exit.id), true);
    assert.ok((exit.disabledUntil ?? 0) > Date.now());
    assert.equal(game.getPrivateMazeRole(impostor.id)?.sabotageActionsRemaining, 0);
    assert.equal(game.jamMazeTeleport(impostor.id, portal.id), false);

    assert.equal(game.changeMazeLayout(impostor.id, () => 0.4), true);
    assert.equal(
      game.getPrivateMazeRole(impostor.id)?.sabotageActionsRemaining,
      game.initialSabotageActions
    );
    assert.equal([...game.board.players.values()].filter(player =>
      player.ghostModeExpiresAt > Date.now()
    ).length, 1);
    game.destroy();
  });

  it('Should let the random ghost walk through walls and end wall phasing when its timer expires', () => {
    const board = new MazeBoard(6);
    const ghost = new Player('maze_ghost', 'Ghost', false, 2, 2);
    board.addPlayer(ghost);
    ghost.isInPrison = true;
    ghost.ghostModeExpiresAt = Date.now() + 10_000;
    board.walls = [
      new Wall('cage_n', 'impostor', 2, 1, true, undefined, undefined, true, true),
      new Wall('cage_s', 'impostor', 2, 2, true, undefined, undefined, true, true),
      new Wall('cage_w', 'impostor', 1, 2, false, undefined, undefined, true, true),
      new Wall('cage_e', 'impostor', 2, 2, false, undefined, undefined, true, true)
    ];

    assert.ok(board.getMazeValidMoves(ghost.id).some(move => move.x === 3 && move.y === 2));
    assert.equal(board.moveMazePlayer(ghost.id, 3, 2), true);
    ghost.ghostModeExpiresAt = Date.now() - 1;
    board.walls.push(new Wall('expired_ghost_wall', 'impostor', 3, 2, false));
    assert.ok(!board.getMazeValidMoves(ghost.id).some(move => move.x === 4 && move.y === 2));
  });

  it('Should finish only after every good player reaches the central extraction with their key', async () => {
    const players = [
      { id: 'maze_escape_good_a', username: 'EscapeeA', isGuest: false, color: '#FF3B30' },
      { id: 'maze_escape_good_b', username: 'EscapeeB', isGuest: false, color: '#007AFF' },
      { id: 'maze_escape_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' }
    ];
    let finishedWinner: string | null = null;
    const game = new GameInstance('maze_escape_test', 'labyrinth', players, (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const mazeBoard = game.board as MazeBoard;
    const goodPlayers = players
      .filter(player => player.id !== game.impostorId)
      .map(player => game.board.players.get(player.id)!);
    const impostor = game.board.players.get(game.impostorId!)!;
    const extraction = mazeBoard.extraction;
    game.board.walls.splice(0);
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;
    const northCell = { x: extraction.x, y: extraction.y - 1 };
    const southCell = { x: extraction.x, y: extraction.y + 1 };
    goodPlayers[0].x = northCell.x;
    goodPlayers[0].y = northCell.y;
    goodPlayers[1].x = southCell.x;
    goodPlayers[1].y = southCell.y;
    goodPlayers.forEach(player => {
      player.isInPrison = false;
      player.ghostModeExpiresAt = 0;
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    });
    impostor.x = 0;
    impostor.y = 0;
    game.board.grid[0][0].hasPlayer = impostor.id;

    assert.equal(game.executeMove(goodPlayers[0].id, extraction.x, extraction.y), true);
    assert.equal(goodPlayers[0].hasMazeEscaped, false, 'a player without their key cannot extract');
    assert.equal(finishedWinner, null);

    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(game.executeMove(goodPlayers[0].id, northCell.x, northCell.y), true);
    goodPlayers[0].hasMazeKey = true;
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(game.executeMove(goodPlayers[0].id, extraction.x, extraction.y), true);
    assert.equal(goodPlayers[0].hasMazeKeyDelivered, true);
    assert.equal(goodPlayers[0].hasMazeEscaped, false, 'delivering a key must not remove the player from the match');
    assert.equal(finishedWinner, null, 'the remaining good player must also extract');
    assert.equal(mazeBoard.grid[extraction.y][extraction.x].hasPlayer, goodPlayers[0].id);
    assert.ok(mazeBoard.getMazeValidMoves(goodPlayers[0].id).length > 0,
      'a player who delivered their key can keep moving to help teammates');

    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(game.executeMove(goodPlayers[0].id, northCell.x, northCell.y), true,
      'a delivered player can leave the extraction to assist teammates');
    await new Promise(resolve => setTimeout(resolve, 130));
    goodPlayers[1].hasMazeKey = true;
    assert.equal(game.executeMove(goodPlayers[1].id, extraction.x, extraction.y), true);
    assert.equal(goodPlayers[1].hasMazeKeyDelivered, true);
    assert.equal(goodPlayers[1].hasMazeEscaped, false);
    assert.equal(finishedWinner, 'good');
    game.destroy();
  });

  it('Should count a fake impostor key delivery without allowing it to satisfy the good-team objective', async () => {
    const players = [
      { id: 'maze_delivery_player_1', username: 'Player1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_delivery_player_2', username: 'Player2', isGuest: false, color: '#007AFF' },
      { id: 'maze_delivery_player_3', username: 'Player3', isGuest: false, color: '#FFCC00' },
      { id: 'maze_delivery_player_4', username: 'Player4', isGuest: false, color: '#34C759' }
    ];
    let finishedWinner: string | null = null;
    const game = new GameInstance('maze_fake_delivery_test', 'labyrinth', players, (event, data) => {
      if (event === 'gameFinished') finishedWinner = data.winner;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const board = game.board as MazeBoard;
    board.walls.splice(0);
    board.keys = [];
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const extraction = board.extraction;
    impostor.x = extraction.x - 1;
    impostor.y = extraction.y;
    impostor.hasMazeKey = true;
    board.grid[impostor.y][impostor.x].hasPlayer = impostor.id;
    assert.equal(game.executeMove(impostor.id, extraction.x, extraction.y), true);
    assert.equal(impostor.hasMazeKeyDelivered, true);
    assert.equal(impostor.hasMazeEscaped, false, 'the impostor remains in play after faking a delivery');
    assert.equal(board.toDTO().players[impostor.id].hasMazeKeyDelivered, true);
    assert.equal(finishedWinner, null, 'the impostor delivery cannot complete the good-team objective');

    board.grid[extraction.y][extraction.x].hasPlayer = null;
    board.grid[impostor.y][impostor.x].hasPlayer = null;
    impostor.x = 0;
    impostor.y = 0;
    board.grid[0][0].hasPlayer = impostor.id;
    const goodPlayers = [...game.board.players.values()].filter(player => player.id !== impostor.id);
    const deliveryCells = [
      { x: extraction.x, y: extraction.y - 1 },
      { x: extraction.x, y: extraction.y + 1 },
      { x: extraction.x - 1, y: extraction.y }
    ];
    goodPlayers.forEach((player, index) => {
      player.x = deliveryCells[index].x;
      player.y = deliveryCells[index].y;
      player.hasMazeKey = true;
      board.grid[player.y][player.x].hasPlayer = player.id;
    });

    for (const [index, player] of goodPlayers.entries()) {
      await new Promise(resolve => setTimeout(resolve, 130));
      assert.equal(game.executeMove(player.id, extraction.x, extraction.y), true);
      assert.equal(player.hasMazeEscaped, false);
      if (index < goodPlayers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 130));
        assert.equal(game.executeMove(player.id, deliveryCells[index].x, deliveryCells[index].y), true,
          'a player can keep moving after delivering their key');
      }
    }
    assert.equal(finishedWinner, 'good');
    assert.equal(goodPlayers.every(player => player.hasMazeKeyDelivered), true);
    game.destroy();
  });

  it('Should preserve captives and free players when the maze layout is reshuffled', () => {
    const mazeBoard = new MazeBoard(20);
    mazeBoard.addPlayer(new Player('maze_shift_captive', 'Captive', false, 10, 10));
    mazeBoard.addPlayer(new Player('maze_shift_free_1', 'Free1', false, 2, 2));
    mazeBoard.addPlayer(new Player('maze_shift_free_2', 'Free2', false, 17, 17));
    const captive = mazeBoard.players.get('maze_shift_captive')!;
    captive.isInPrison = true;
    mazeBoard.walls = [
      new Wall('preserved_north', 'maze_shift_impostor', 9, 9, true, undefined, undefined, true, true),
      new Wall('preserved_south', 'maze_shift_impostor', 9, 10, true, undefined, undefined, true, true),
      new Wall('preserved_west', 'maze_shift_impostor', 9, 9, false, undefined, undefined, true, true),
      new Wall('preserved_east', 'maze_shift_impostor', 10, 9, false, undefined, undefined, true, true)
    ];
    mazeBoard.keys = [{ id: 'key_1', x: 1, y: 1 }];
    mazeBoard.spawnTeleports(() => 0.41);
    const previousTeleports = JSON.stringify(mazeBoard.teleports);
    const previousKeyPosition = { x: mazeBoard.keys[0].x, y: mazeBoard.keys[0].y };
    const previousCaptivePosition = { x: captive.x, y: captive.y };
    mazeBoard.reshuffleMaze(() => 0.73);

    assert.deepEqual({ x: captive.x, y: captive.y }, previousCaptivePosition);
    assert.equal(mazeBoard.isMazePlayerEnclosed(captive.id), true);
    assert.ok(mazeBoard.walls.some(wall => wall.id === 'preserved_north'));
    assert.ok(mazeBoard.players.size === 3);
    assert.ok([...mazeBoard.players.values()]
      .filter(player => !player.isInPrison)
      .every(player => !mazeBoard.isMazePlayerEnclosed(player.id)));
    assert.notEqual(JSON.stringify(mazeBoard.teleports), previousTeleports);
    assert.notDeepEqual(
      { x: mazeBoard.keys[0].x, y: mazeBoard.keys[0].y },
      previousKeyPosition
    );
    assert.ok(mazeBoard.teleports.every(portal =>
      mazeBoard.grid[portal.y][portal.x].hasPlayer === null
    ));
  });

  it('Should favor safe barriers near gates when a player is close to an entrance', () => {
    class InspectableMazeBoard extends MazeBoard {
      public isPassageBlocked(fromX: number, fromY: number, toX: number, toY: number): boolean {
        return this.isWallBlocking(fromX, fromY, toX, toY);
      }
    }

    const board = new InspectableMazeBoard(20);
    const middle = Math.floor(board.size / 2);
    board.addPlayer(new Player('maze_gate_approach_player', 'NearGate', false, middle, middle - 2));
    board.addPlayer(new Player('maze_gate_approach_other', 'Other', false, 1, 1));
    board.generateRandomMazeWalls(0, () => 0.5);
    board.reshuffleMaze(() => 0.5, true);

    const northExit = board.exits.find(exit => exit.x === middle && exit.y < middle)!;
    for (let offset = -1; offset <= 0; offset++) {
      assert.equal(
        board.isPassageBlocked(northExit.x + offset, northExit.y - 1, northExit.x + offset, northExit.y),
        false,
        'reshuffling must never seal the gate itself'
      );
    }
    assert.ok([...board.players.values()].every(player =>
      !board.isMazePlayerEnclosed(player.id)
    ), 'barriers must not enclose a player who is near a gate');
    assert.ok(board.walls.some(wall =>
      !wall.id.startsWith('maze_center_') &&
      Math.abs(wall.x - northExit.x) + Math.abs(wall.y - northExit.y) <= 3
    ), 'the new layout should try to add barriers around the nearby gate approach');
  });

  it('Should collect any unassigned Labyrinth key and broadcast the carrier state', () => {
    const players = [
      { id: 'maze_key_player_1', username: 'Key1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_key_player_2', username: 'Key2', isGuest: false, color: '#007AFF' }
    ];
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('maze_key_test', 'labyrinth', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    const mazeBoard = game.board as MazeBoard;
    const key = mazeBoard.keys[0];
    const collector = game.board.players.get(players[0].id)!;
    const other = game.board.players.get(players[1].id)!;
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;
    collector.x = key.x - 1;
    collector.y = key.y;
    game.board.grid[collector.y][collector.x].hasPlayer = collector.id;
    other.x = 0;
    other.y = 0;
    game.board.grid[0][0].hasPlayer = other.id;

    assert.equal(game.executeMove(collector.id, key.x, key.y), true);
    assert.equal(collector.hasMazeKey, true);
    assert.equal(mazeBoard.keys.some(candidate => candidate.id === key.id), false);
    assert.equal(game.getMazePublicActionCounts()[collector.id], 0);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' && data.type === 'key_collected' && data.playerName === collector.username
    ));
    const lastBoardUpdate = events.filter(({ event }) => event === 'mazeStateChanged').at(-1)?.data;
    assert.equal(lastBoardUpdate.board.players[collector.id].hasMazeKey, true);
    game.destroy();
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
    assert.equal(game.board.size, 40);
    const positions = [...game.board.players.values()].map(player => `${player.x},${player.y}`);
    assert.equal(new Set(positions).size, 6);
    const middle = Math.floor(game.board.size / 2);
    for (const player of game.board.players.values()) {
      assert.ok(Math.abs(player.x - middle) <= 1);
      assert.ok(Math.abs(player.y - middle) <= 1);
      assert.equal(player.wallsLeft, 0);
    }
    assert.ok(game.board.walls.length >= game.board.size * game.board.size * 0.3);
    assert.equal(mazeBoard.exits.length, 4);
    assert.equal(new Set(mazeBoard.exits.map(exit => `${exit.x},${exit.y}`)).size, 4);
    assert.ok(mazeBoard.exits.every(exit =>
      Math.abs(exit.x - middle) === 3 || Math.abs(exit.y - middle) === 3
    ));
    assert.equal(game.board.boosts.length, 0);
    assert.equal(mazeBoard.keys.length, 3);
    assert.equal(mazeBoard.keys.length, 3);
    assert.ok(mazeBoard.keys.every(key => !('playerId' in key)),
      'keys are unassigned until a player picks one up');
    assert.ok(mazeBoard.keys.every(key =>
      Math.max(Math.abs(key.x - middle), Math.abs(key.y - middle)) >= 10
    ));
    assert.ok(mazeBoard.teleports.every(teleport => {
      const distance = Math.max(Math.abs(teleport.x - middle), Math.abs(teleport.y - middle));
      return distance >= 4 && distance <= 12;
    }));
    assert.ok(mazeBoard.isCellCapturable(mazeBoard.keys[0].x, mazeBoard.keys[0].y));
    assert.equal(mazeBoard.keys.length, 3, 'spawn one unassigned key per human player, including the impostor');
    assert.equal(game.initialSabotageActions, 2);
    assert.equal(game.getMazeGameTimeLimitSeconds(), 300);

    const humanRoles = players
      .filter(player => !player.id.startsWith('bot_'))
      .map(player => game.getPrivateMazeRole(player.id));
    assert.equal(humanRoles.filter(role => role?.role === 'impostor').length, 1);
    assert.equal(humanRoles.filter(role => role?.role === 'good').length, 2);
    const ghost = [...game.board.players.values()].find(player => player.ghostModeExpiresAt > 0);
    assert.ok(ghost);
    assert.ok(ghost.ghostModeExpiresAt - Date.now() <= LABYRINTH_GHOST_DURATION_MS);
    assert.ok(ghost.ghostModeExpiresAt - Date.now() > LABYRINTH_GHOST_DURATION_MS - 500);
    assert.ok(humanRoles.every(role =>
      role !== null && role.sabotageActionsRemaining === (role.role === 'impostor' ? 2 : 0)
    ));
    assert.equal(game.getPrivateMazeRole('bot_maze_1'), null);
    assert.equal(JSON.stringify(game.board.toDTO('maze_human_1')).includes('impostor'), false);
    assert.equal(Object.keys(game.getMazePublicActionCounts()).length, 3);
    const botPosition = { x: game.board.players.get('bot_maze_1')?.x, y: game.board.players.get('bot_maze_1')?.y };
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.deepEqual(
      { x: game.board.players.get('bot_maze_1')?.x, y: game.board.players.get('bot_maze_1')?.y },
      botPosition
    );
    assert.equal(game.getCurrentPlayer(), '', 'Labyrinth has no active turn owner');
    game.destroy();
  });

  it('Should allow independent real-time Labyrinth movement without turn events', () => {
    const players = [
      { id: 'maze_realtime_1', username: 'Maze1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_realtime_2', username: 'Maze2', isGuest: false, color: '#007AFF' }
    ];
    let startEvent: any;
    const emittedEvents: string[] = [];
    const movementEvents: any[] = [];
    const mazeStateUpdates: any[] = [];
    const game = new GameInstance('maze_realtime_test', 'labyrinth', players, (event, data) => {
      emittedEvents.push(event);
      if (event === 'gameStarted') startEvent = data;
      if (event === 'playerMoved') movementEvents.push(data);
      if (event === 'mazeStateChanged') mazeStateUpdates.push(data);
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    game.board.walls.splice(0);
    game.setPlayerCosmetic('maze_realtime_1', 'MOVEMENT_TRAIL', 'trail_test', '✨');

    assert.equal('currentTurn' in startEvent, false);
    assert.equal('turnTimeLimitSeconds' in startEvent, false);
    assert.equal('turnSecondsRemaining' in startEvent, false);
    assert.equal(startEvent.gameTimeLimitSeconds, 300);
    const mazeBoard = game.board as MazeBoard;
    const firstMove = mazeBoard.getMazeValidMoves('maze_realtime_1')[0];
    assert.ok(firstMove);
    assert.equal(game.executeMove('maze_realtime_1', firstMove.x, firstMove.y), true);
    const secondMove = mazeBoard.getMazeValidMoves('maze_realtime_2')[0];
    assert.ok(secondMove);
    assert.equal(game.executeMove('maze_realtime_2', secondMove.x, secondMove.y), true);
    assert.equal(emittedEvents.filter(event => event === 'mazeStateChanged').length, 3);
    assert.equal(emittedEvents.filter(event => event === 'playerMoved').length, 2);
    assert.equal(movementEvents[0].movementTrailId, 'trail_test');
    assert.equal(movementEvents[0].movementTrailIcon, '✨');
    assert.equal(
      mazeStateUpdates[2].board.players.maze_realtime_1.x,
      mazeBoard.players.get('maze_realtime_1')?.x
    );
    assert.equal(
      mazeStateUpdates[2].board.players.maze_realtime_2.x,
      mazeBoard.players.get('maze_realtime_2')?.x
    );
    assert.equal(emittedEvents.includes('turnChanged'), false);
    const nextMove = mazeBoard.getMazeValidMoves('maze_realtime_1')[0];
    if (nextMove) {
      assert.equal(game.executeMove('maze_realtime_1', nextMove.x, nextMove.y), false, 'movement is rate-limited per player');
    }
    game.destroy();
  });

  it('Should keep impostor traps private, outside the safe zone, and on independent cooldowns', () => {
    const players = [
      { id: 'maze_trap_a', username: 'TrapA', isGuest: false, color: '#FF3B30' },
      { id: 'maze_trap_b', username: 'TrapB', isGuest: false, color: '#007AFF' },
      { id: 'maze_trap_c', username: 'TrapC', isGuest: false, color: '#34C759' },
      { id: 'maze_trap_d', username: 'TrapD', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('maze_trap_privacy_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const mazeBoard = game.board as MazeBoard;
    const impostorId = game.impostorId!;
    const goodId = players.find(player => player.id !== impostorId)!.id;
    const trapCell = mazeBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => !mazeBoard.isSafeZoneCell(x, y) && mazeBoard.canPlaceTrap(x, y))!;
    const safeCell = mazeBoard.extraction;

    assert.equal(game.placeMazeTrap(goodId, 'ice', trapCell.x, trapCell.y), false);
    assert.equal(game.placeMazeTrap(impostorId, 'ice', safeCell.x, safeCell.y), false);
    assert.equal(game.placeMazeTrap(impostorId, 'ice', trapCell.x, trapCell.y), true);
    const teleportCell = mazeBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => !mazeBoard.isSafeZoneCell(x, y) &&
        mazeBoard.canPlaceTrap(x, y) && (x !== trapCell.x || y !== trapCell.y))!;
    assert.equal(game.placeMazeTrap(impostorId, 'teleport', teleportCell.x, teleportCell.y), true);
    assert.equal(game.placeMazeTrap(impostorId, 'ice', teleportCell.x, teleportCell.y), false);
    assert.equal(game.getPrivateMazeTrapState(goodId), null);
    assert.equal(game.getPrivateMazeTrapState(impostorId)?.traps.length, 2);
    assert.ok((game.getPrivateMazeTrapState(impostorId)?.cooldowns.ice ?? 0) > 0);
    assert.ok((game.getPrivateMazeTrapState(impostorId)?.cooldowns.teleport ?? 0) > 0);
    assert.equal('traps' in mazeBoard.toDTO(), false);
    const trapIdsBeforeReshuffle = mazeBoard.traps.map(trap => trap.id).sort();
    mazeBoard.reshuffleMaze(() => 0.5, true);
    assert.deepEqual(mazeBoard.traps.map(trap => trap.id).sort(), trapIdsBeforeReshuffle);
    game.destroy();
  });

  it('Should freeze good players for 30 seconds when they trigger an ice trap', () => {
    const players = [
      { id: 'maze_ice_a', username: 'IceA', isGuest: false, color: '#FF3B30' },
      { id: 'maze_ice_b', username: 'IceB', isGuest: false, color: '#007AFF' },
      { id: 'maze_ice_c', username: 'IceC', isGuest: false, color: '#34C759' },
      { id: 'maze_ice_d', username: 'IceD', isGuest: false, color: '#FFCC00' }
    ];
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('maze_ice_trap_test', 'labyrinth', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const mazeBoard = game.board as MazeBoard;
    mazeBoard.walls.splice(0);
    const impostorId = game.impostorId!;
    const victimId = players.find(player => player.id !== impostorId)!.id;
    const trapCell = mazeBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => x >= 2 && !mazeBoard.isSafeZoneCell(x, y) &&
        mazeBoard.canPlaceTrap(x, y))!;
    assert.equal(game.placeMazeTrap(impostorId, 'ice', trapCell.x, trapCell.y), true);

    for (const row of mazeBoard.grid) for (const cell of row) cell.hasPlayer = null;
    const victim = mazeBoard.players.get(victimId)!;
    victim.x = trapCell.x - 1;
    victim.y = trapCell.y;
    for (const player of mazeBoard.players.values()) {
      mazeBoard.grid[player.y][player.x].hasPlayer = player.id;
    }
    assert.equal(game.executeMove(victimId, trapCell.x, trapCell.y), true);
    assert.ok(victim.mazeFrozenUntil >= Date.now() + 29_000);
    assert.equal(mazeBoard.getMazeValidMoves(victimId).length, 0);
    assert.equal(mazeBoard.traps.length, 0);
    assert.deepEqual(events.find(item => item.event === 'mazeTrapTriggered')?.data, {
      playerId: victimId,
      type: 'ice',
      shielded: false
    });
    game.destroy();
  });

  it('Should consume a shield to block a trap and teleport unshielded victims to a board edge', async () => {
    const players = [
      { id: 'maze_tele_a', username: 'TeleA', isGuest: false, color: '#FF3B30' },
      { id: 'maze_tele_b', username: 'TeleB', isGuest: false, color: '#007AFF' },
      { id: 'maze_tele_c', username: 'TeleC', isGuest: false, color: '#34C759' },
      { id: 'maze_tele_d', username: 'TeleD', isGuest: false, color: '#FFCC00' }
    ];
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('maze_teleport_trap_test', 'labyrinth', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const mazeBoard = game.board as MazeBoard;
    mazeBoard.walls.splice(0);
    const impostorId = game.impostorId!;
    const victimId = players.find(player => player.id !== impostorId)!.id;
    const trapCell = mazeBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => x >= 2 && !mazeBoard.isSafeZoneCell(x, y) &&
        mazeBoard.canPlaceTrap(x, y))!;
    assert.equal(game.placeMazeTrap(impostorId, 'teleport', trapCell.x, trapCell.y), true);

    for (const row of mazeBoard.grid) for (const cell of row) cell.hasPlayer = null;
    const victim = mazeBoard.players.get(victimId)!;
    victim.x = trapCell.x - 1;
    victim.y = trapCell.y;
    victim.mazeShieldExpiresAt = Date.now() + 60_000;
    for (const player of mazeBoard.players.values()) {
      mazeBoard.grid[player.y][player.x].hasPlayer = player.id;
    }
    assert.equal(game.executeMove(victimId, trapCell.x, trapCell.y), true);
    assert.equal(victim.mazeShieldExpiresAt, 0);
    assert.deepEqual({ x: victim.x, y: victim.y }, trapCell);
    assert.equal(events.find(item => item.event === 'mazeTrapTriggered')?.data.shielded, true);

    await new Promise(resolve => setTimeout(resolve, 130));
    const nextTrapCell = mazeBoard.grid.flatMap((row, y) => row.map((_, x) => ({ x, y })))
      .find(({ x, y }) => x >= 2 && !mazeBoard.isSafeZoneCell(x, y) &&
        mazeBoard.canPlaceTrap(x, y))!;
    mazeBoard.placeTrap({ id: 'teleport_trap_test', type: 'teleport', ...nextTrapCell });
    const startCell = { x: nextTrapCell.x - 1, y: nextTrapCell.y };
    mazeBoard.grid[victim.y][victim.x].hasPlayer = null;
    victim.x = startCell.x;
    victim.y = startCell.y;
    mazeBoard.grid[victim.y][victim.x].hasPlayer = victim.id;
    assert.equal(game.executeMove(victimId, nextTrapCell.x, nextTrapCell.y), true);
    assert.ok(victim.x === 0 || victim.y === 0 ||
      victim.x === mazeBoard.size - 1 || victim.y === mazeBoard.size - 1);
    assert.equal(events.filter(item => item.event === 'playerMoved' && item.data.teleported).length, 1);
    game.destroy();
  });

  it('Should spawn shields outside the safe zone and grant one when a good player reaches it', () => {
    const players = [
      { id: 'maze_shield_a', username: 'ShieldA', isGuest: false, color: '#FF3B30' },
      { id: 'maze_shield_b', username: 'ShieldB', isGuest: false, color: '#007AFF' },
      { id: 'maze_shield_c', username: 'ShieldC', isGuest: false, color: '#34C759' },
      { id: 'maze_shield_d', username: 'ShieldD', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('maze_shield_pickup_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const mazeBoard = game.board as MazeBoard;
    mazeBoard.walls.splice(0);
    assert.equal(mazeBoard.shieldPickups.length, 3);
    assert.ok(mazeBoard.shieldPickups.every(pickup => !mazeBoard.isSafeZoneCell(pickup.x, pickup.y)));

    const impostorId = game.impostorId!;
    const victimId = players.find(player => player.id !== impostorId)!.id;
    const pickup = mazeBoard.shieldPickups.find(({ x }) => x >= 2)!;
    const victim = mazeBoard.players.get(victimId)!;
    for (const row of mazeBoard.grid) for (const cell of row) cell.hasPlayer = null;
    victim.x = pickup.x - 1;
    victim.y = pickup.y;
    for (const player of mazeBoard.players.values()) {
      mazeBoard.grid[player.y][player.x].hasPlayer = player.id;
    }
    assert.equal(game.executeMove(victimId, pickup.x, pickup.y), true);
    assert.ok(victim.mazeShieldExpiresAt > Date.now());
    assert.equal(mazeBoard.shieldPickups.length, 2);
    game.destroy();
  });

  it('Should allow a Labyrinth player to jump over a player directly ahead', () => {
    const game = new GameInstance('maze_jump_test', 'labyrinth', [
      { id: 'maze_jumper', username: 'Jumper', isGuest: false, color: '#FF3B30' },
      { id: 'maze_blocker', username: 'Blocker', isGuest: false, color: '#007AFF' }
    ], () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const mazeBoard = game.board as MazeBoard;
    mazeBoard.walls.splice(0);
    const jumper = mazeBoard.players.get('maze_jumper')!;
    const blocker = mazeBoard.players.get('maze_blocker')!;
    for (const row of mazeBoard.grid) for (const cell of row) cell.hasPlayer = null;
    jumper.x = 10;
    jumper.y = 10;
    blocker.x = 10;
    blocker.y = 9;
    mazeBoard.grid[jumper.y][jumper.x].hasPlayer = jumper.id;
    mazeBoard.grid[blocker.y][blocker.x].hasPlayer = blocker.id;

    assert.equal(game.executeMove(jumper.id, blocker.x, blocker.y), false, 'players cannot occupy the same cell');
    assert.equal(game.executeMove(jumper.id, 10, 8), true, 'the player can jump over the pawn ahead');
    assert.deepEqual({ x: jumper.x, y: jumper.y }, { x: 10, y: 8 });
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

  it('Should award the good team the win when the impostor surrenders in Labyrinth', () => {
    const players = [
      { id: 'maze_surrender_impostor', username: 'Impostor', isGuest: false, color: '#FF3B30' },
      { id: 'maze_surrender_good_1', username: 'Good1', isGuest: false, color: '#007AFF' },
      { id: 'maze_surrender_good_2', username: 'Good2', isGuest: false, color: '#34C759' },
      { id: 'maze_surrender_good_3', username: 'Good3', isGuest: false, color: '#FFCC00' }
    ];
    let finishedData: { winner: string | null; mazeEndReason?: string } | undefined;
    const game = new GameInstance('maze_impostor_surrender_test', 'labyrinth', players, (event, data) => {
      if (event === 'gameFinished') finishedData = data;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorId = game.impostorId!;

    assert.equal(game.surrender(impostorId), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'good');
    assert.equal(finishedData?.winner, 'good');
    assert.equal(finishedData?.mazeEndReason, 'surrender');
    game.destroy();
  });

  it('Should award the impostor the win when a good Labyrinth player surrenders', () => {
    const players = [
      { id: 'maze_good_surrender_1', username: 'Good1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_good_surrender_2', username: 'Good2', isGuest: false, color: '#007AFF' },
      { id: 'maze_good_surrender_3', username: 'Good3', isGuest: false, color: '#34C759' },
      { id: 'maze_good_surrender_4', username: 'Good4', isGuest: false, color: '#FFCC00' }
    ];
    let finishedData: { winner: string | null; mazeEndReason?: string } | undefined;
    const game = new GameInstance('maze_good_surrender_test', 'labyrinth', players, (event, data) => {
      if (event === 'gameFinished') finishedData = data;
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    const impostorId = game.impostorId!;
    const goodPlayerId = players.find(player => player.id !== impostorId)!.id;

    assert.equal(game.surrender(goodPlayerId), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, impostorId);
    assert.equal(finishedData?.winner, impostorId);
    assert.equal(finishedData?.mazeEndReason, 'surrender');
    game.destroy();
  });

  it('Should reset the global Labyrinth inactivity timer when any player is active', () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 });
    let finishedWinner: string | null = null;
    let finishedReason: string | undefined;
    const game = new GameInstance('maze_idle_test', 'labyrinth', [
      { id: 'maze_idle_1', username: 'Idle1', isGuest: false, color: '#FF3B30' },
      { id: 'maze_idle_2', username: 'Idle2', isGuest: false, color: '#007AFF' }
    ], (event, data) => {
      if (event === 'gameFinished') {
        finishedWinner = data.winner;
        finishedReason = data.mazeEndReason;
      }
    }, GAME_INSTANCE_TEST_OPTIONS);

    try {
      game.start();
      mock.timers.tick(59_000);
      game.recordPlayerActivity('maze_idle_2');
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
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    game.board.walls.splice(0);
    (game.board as MazeBoard).keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    impostor.x = middle;
    impostor.y = middle;
    game.board.grid[middle][middle].hasPlayer = impostor.id;
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
      { x: middle - 1, y: middle - 1, horizontal: true },
      { x: middle, y: middle, horizontal: true },
      { x: middle - 1, y: middle, horizontal: false },
      { x: middle, y: middle - 1, horizontal: false }
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

  it('Should let the impostor cage a player after that player has collected their key', () => {
    const players = [
      { id: 'maze_key_carrier_good', username: 'KeyCarrier', isGuest: false, color: '#FF3B30' },
      { id: 'maze_key_carrier_friend', username: 'Friend', isGuest: false, color: '#007AFF' },
      { id: 'maze_key_carrier_impostor', username: 'Impostor', isGuest: false, color: '#FFCC00' }
    ];
    const game = new GameInstance('maze_key_carrier_cage_test', 'labyrinth', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    const board = game.board as MazeBoard;
    board.walls.splice(0);
    board.keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const goodPlayers = players
      .map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== game.impostorId);
    const [target, friend] = goodPlayers;
    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    target.x = middle;
    target.y = middle;
    target.hasMazeKey = true;
    friend.x = 0;
    friend.y = 0;
    impostor.x = 39;
    impostor.y = 39;
    for (const player of [target, friend, impostor]) {
      game.board.grid[player.y][player.x].hasPlayer = player.id;
    }
    board.walls.push(
      new Wall('carrier_cage_north', impostor.id, middle - 1, middle - 1, true),
      new Wall('carrier_cage_south', impostor.id, middle, middle, true),
      new Wall('carrier_cage_west', impostor.id, middle - 1, middle, false)
    );

    assert.equal(game.state, 'playing');
    assert.equal(impostor.isInPrison, false);
    assert.equal(game.getPrivateMazeRole(impostor.id)?.canPlaceWall, true);
    assert.equal(board.canPlaceWall(new Wall('carrier_cage_east', impostor.id, middle, middle - 1, false)), true);
    assert.equal(game.placeMazeWall(impostor.id, middle, middle - 1, false, 'carrier_cage_east'), true);
    assert.equal(target.isInPrison, true);
    assert.equal(target.hasMazeKey, true);
    game.destroy();
  });

  it('Should prevent a good player from caging another good player', () => {
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
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    game.board.walls.splice(0);
    (game.board as MazeBoard).keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    const edge = game.board.size - 1;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = middle;
    target.y = middle;
    game.board.grid[middle][middle].hasPlayer = target.id;
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
      { x: middle - 1, y: middle - 1, horizontal: true },
      { x: middle, y: middle, horizontal: true },
      { x: middle - 1, y: middle, horizontal: false },
      { x: middle, y: middle - 1, horizontal: false }
    ];
    cageWalls.slice(0, -1).forEach((wall, index) => {
      assert.equal(
        game.placeMazeWall(goodPlayers[index + 1].id, wall.x, wall.y, wall.horizontal, `wrong_cage_${index}`),
        true
      );
    });
    const finalWall = cageWalls.at(-1)!;
    assert.equal(
      game.placeMazeWall(
        goodPlayers[goodPlayers.length - 1].id,
        finalWall.x,
        finalWall.y,
        finalWall.horizontal,
        'wrong_cage_final'
      ),
      false
    );
    assert.equal(target.isInPrison, false);
    assert.equal(finishedWinner, null);
    game.destroy();
  });

  it('Should let a nearby good player rescue one captive once', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `maze_rescue_${index}`,
      username: `Rescue${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('maze_rescue_test', 'labyrinth', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    game.board.walls.splice(0);
    (game.board as MazeBoard).keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    const edge = game.board.size - 1;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = middle;
    target.y = middle;
    game.board.grid[middle][middle].hasPlayer = target.id;
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
      { x: middle - 1, y: middle - 1, horizontal: true },
      { x: middle, y: middle, horizontal: true },
      { x: middle - 1, y: middle, horizontal: false },
      { x: middle, y: middle - 1, horizontal: false }
    ];
    cageWalls.forEach((wall, index) => {
      assert.equal(game.placeMazeWall(impostor.id, wall.x, wall.y, wall.horizontal, `impostor_cage_${index}`), true);
    });
    assert.equal(target.isInPrison, true);
    assert.ok(game.getMazeRescueStatus().availableRescuers >= 3);
    const rescuer = goodPlayers[1];
    const previousPosition = { x: rescuer.x, y: rescuer.y };
    game.board.grid[previousPosition.y][previousPosition.x].hasPlayer = null;
    rescuer.x = middle + 1;
    rescuer.y = middle;
    game.board.grid[rescuer.y][rescuer.x].hasPlayer = rescuer.id;
    assert.equal(game.rescueMazePlayer(rescuer.id, target.id), true);
    assert.equal(target.isInPrison, false);
    assert.equal(game.rescueMazePlayer(rescuer.id, target.id), false, 'a rescuer can rescue only once');
    assert.equal(game.getMazePublicActionCounts()[rescuer.id], 1);
    assert.ok(game.board.walls.some(wall => wall.isSabotageWall));
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' && data.type === 'player_rescued'
    ));
    game.destroy();
  });

  it('Should only let a nearby player break a red impostor wall that opens a prison', () => {
    const players = Array.from({ length: 6 }, (_, index) => ({
      id: `maze_break_${index}`,
      username: `Break${index}`,
      isGuest: false,
      color: ['#FF3B30', '#007AFF', '#FFCC00', '#34C759', '#AF52DE', '#FF9500'][index]
    }));
    const events: Array<{ event: string; data: any }> = [];
    const game = new GameInstance('maze_break_test', 'labyrinth', players, (event, data) => {
      events.push({ event, data });
    }, GAME_INSTANCE_TEST_OPTIONS);
    game.start();
    for (const player of game.board.players.values()) player.ghostModeExpiresAt = 0;
    game.board.walls.splice(0);
    (game.board as MazeBoard).keys = [];
    for (const row of game.board.grid) for (const cell of row) cell.hasPlayer = null;

    const impostor = game.board.players.get(game.impostorId!)!;
    const middle = Math.floor(game.board.size / 2);
    const edge = game.board.size - 1;
    const goodPlayers = players.map(player => game.board.players.get(player.id)!)
      .filter(player => player.id !== impostor.id);
    const target = goodPlayers[0];
    target.x = middle;
    target.y = middle;
    game.board.grid[middle][middle].hasPlayer = target.id;
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
      { x: middle - 1, y: middle - 1, horizontal: true },
      { x: middle, y: middle, horizontal: true },
      { x: middle - 1, y: middle, horizontal: false },
      { x: middle, y: middle - 1, horizontal: false }
    ];
    cageWalls.forEach((wall, index) => {
      assert.equal(game.placeMazeWall(impostor.id, wall.x, wall.y, wall.horizontal, `maze_break_cage_${index}`), true);
    });
    const mazeBoard = game.board as MazeBoard;
    const releaseWall = mazeBoard.getMazeReleaseWalls(target.id)
      .find(wall => wall.isSabotageWall);
    assert.ok(releaseWall);
    const rescuer = goodPlayers[1];
    assert.equal(game.breakMazeBlock(rescuer.id, releaseWall.id), false, 'the rescuer must travel to the captive');

    game.board.grid[rescuer.y][rescuer.x].hasPlayer = null;
    rescuer.x = middle + 1;
    rescuer.y = middle;
    game.board.grid[rescuer.y][rescuer.x].hasPlayer = rescuer.id;
    assert.equal(game.breakMazeBlock(rescuer.id, releaseWall.id), true);
    assert.equal(target.isInPrison, false);
    assert.equal(game.getMazePublicActionCounts()[rescuer.id], 1);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazeStateChanged' && data.publicActionCounts[rescuer.id] === 1
    ));
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' && data.type === 'impostor_sabotage'
    ));
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' && data.type === 'player_broke_prison_wall'
    ));
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
    const game = new GameInstance('ffa_surrender_test', '4-FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);

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
    const game = new GameInstance('ffa_owner_surrender_test', '4-FFA', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);

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
    const game = new GameInstance('ffa_bots_only_surrender_test', '4-FFA', players, (event, data) => {
      if (event === 'gameFinished') finishData = data;
    }, GAME_INSTANCE_TEST_OPTIONS);

    game.start();
    assert.equal(game.surrender('ffa_last_human'), true);

    assert.equal(game.state, 'finished');
    assert.deepEqual(finishData, { winner: null, durationSeconds: 1, abandoned: true });
    game.destroy();
  });
});
