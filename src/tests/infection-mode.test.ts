import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { InfectionBoard } from '../game/engine/infection-board.js';
import { GameInstance } from '../game/engine/game-instance.js';
import { Player, Wall } from '../game/engine/models.js';
import type { IRoomPlayer } from '../services/room.service.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

function makePlayers(count: number, botCount = 0): IRoomPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index >= count - botCount ? `bot_${index}` : `player_${index}`,
    username: index >= count - botCount ? `Bot ${index}` : `Player ${index}`,
    isGuest: false,
    color: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'][index]
  }));
}

function createGame(
  players = makePlayers(3),
  onStateChange: (event: string, data: any) => void = () => {}
): GameInstance {
  return new GameInstance('infection-test', 'infection', players, onStateChange, GAME_INSTANCE_TEST_OPTIONS);
}

describe('Infection mode', () => {
  it('requires three participants and supports up to six', () => {
    assert.throws(() => createGame(makePlayers(2)), /3-6 participants/);
    assert.throws(() => createGame(makePlayers(7)), /3-6 participants/);
    const game = createGame(makePlayers(6));
    assert.ok(game.board instanceof InfectionBoard);
    game.destroy();
  });

  it('keeps test bots static in the safe zone and assigns exactly one initial infected', () => {
    const game = createGame(makePlayers(3, 2));
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].filter(player => player.isInfected);
    assert.equal(infected.length, 1);
    assert.equal(infected[0].id.startsWith('bot_'), false);
    assert.equal(infected[0].y, board.size - 1);
    assert.equal(board.isSafeZoneCell(infected[0].x, infected[0].y), false);
    const bots = [...board.players.values()].filter(player => player.id.startsWith('bot_'));
    assert.equal(bots.length, 2);
    assert.ok(bots.every(bot => board.isSafeZoneCell(bot.x, bot.y)));

    const bot = bots[0];
    const start = { x: bot.x, y: bot.y };
    assert.equal(game.executeMove(bot.id, bot.x + 1, bot.y), false);
    assert.deepEqual({ x: bot.x, y: bot.y }, start);
    game.destroy();
  });

  it('allows the room host to be randomly assigned as the initial infected', () => {
    const originalRandom = Math.random;
    let randomCalls = 0;
    const randomMock = mock.method(Math, 'random', () =>
      randomCalls++ === 0 ? 0 : originalRandom()
    );
    let game: GameInstance;
    try {
      game = createGame(makePlayers(3));
    } finally {
      randomMock.mock.restore();
    }

    assert.equal(game.impostorId, 'player_0');
    assert.equal(game.getPrivateMazeRole('player_0')?.role, 'infected');
    game.destroy();
  });

  it('holds the initial infected for ten seconds and announces when the hunt begins', async () => {
    const events: Array<{ event: string; data: any }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    const board = game.board as InfectionBoard;
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.equal(survivors.length, 2);
    assert.ok(survivors.every(survivor => board.isSafeZoneCell(survivor.x, survivor.y)));

    game.start();
    const infected = [...board.players.values()].find(player => player.isInfected);
    assert.ok(infected);
    assert.equal(infected.y, board.size - 1);
    assert.equal(game.getPrivateInfectionState(infected.id)?.huntSecondsRemaining, 10);

    board.walls = [];
    assert.equal(game.executeMove(infected.id, infected.x, infected.y - 1), false);
    game.startTime = Date.now() - 10_000;
    assert.equal(game.getPrivateInfectionState(infected.id)?.huntSecondsRemaining, 0);
    assert.equal(game.executeMove(infected.id, infected.x, infected.y - 1), true);
    await new Promise(resolve => setTimeout(resolve, 1_050));
    assert.equal(events.filter(item => item.event === 'mazePublicEvent' &&
      item.data.type === 'infection_hunt_started').length, 1);
    game.destroy();
  });

  it('gives each survivor an independent ten-second safe-zone timer and a one-minute re-entry cooldown', async () => {
    const game = createGame();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.ok(infected && survivors.length === 2);

    for (const row of board.grid) {
      for (const cell of row) cell.hasPlayer = null;
    }
    const middle = Math.floor(board.size / 2);
    infected.x = middle;
    infected.y = board.size - 1;
    survivors[0].x = middle;
    survivors[0].y = middle - 3;
    survivors[1].x = middle + 1;
    survivors[1].y = middle + 1;
    for (const player of [infected, ...survivors]) {
      board.grid[player.y][player.x].hasPlayer = player.id;
    }
    board.walls = [];
    game.start();

    assert.equal(game.getPrivateInfectionState(survivors[0].id)?.safeZoneSecondsRemaining, 10);
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.safeZoneSecondsRemaining, 10);
    assert.equal(game.executeMove(survivors[0].id, middle, middle - 4), true);
    assert.equal(game.getPrivateInfectionState(survivors[0].id)?.safeZoneSecondsRemaining, 0);
    assert.equal(game.getPrivateInfectionState(survivors[0].id)?.safeZoneCooldownSecondsRemaining, 60);
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.safeZoneSecondsRemaining, 10);

    await new Promise(resolve => setTimeout(resolve, 125));
    assert.equal(game.executeMove(survivors[0].id, middle, middle - 3), false);
    game.destroy();
  });

  it('ejects survivors and starts their cooldown when the ten-second timer expires', async () => {
    const movedPlayers: string[] = [];
    const game = createGame(makePlayers(3), (event, data) => {
      if (event === 'playerMoved' && data.teleported) movedPlayers.push(data.playerId);
    });
    const board = game.board as InfectionBoard;
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    game.start();
    assert.ok(survivors.every(player => board.isSafeZoneCell(player.x, player.y)));
    assert.ok(survivors.every(player =>
      game.getPrivateInfectionState(player.id)?.safeZoneSecondsRemaining === 10
    ));

    await new Promise(resolve => setTimeout(resolve, 10_100));

    assert.ok(survivors.every(player => !board.isSafeZoneCell(player.x, player.y)));
    assert.ok(survivors.every(player =>
      (game.getPrivateInfectionState(player.id)?.safeZoneCooldownSecondsRemaining ?? 0) >= 59
    ));
    assert.equal(movedPlayers.length, survivors.length);
    game.destroy();
  });

  it('keeps Infection safe-zone entrances open after maze reshuffles and ejects beside the zone', () => {
    const game = createGame();
    const board = game.board as InfectionBoard;
    const middle = Math.floor(board.size / 2);
    const radius = 3;
    const player = [...board.players.values()].find(candidate => !candidate.isInfected);
    assert.ok(player);

    assert.equal(board.isSafeZoneCell(middle + radius, middle), true);
    assert.equal(board.isSafeZoneCell(middle + radius + 1, middle), false);
    board.reshuffleMaze(() => 0.5);
    assert.ok(board.walls.some(wall => wall.id.startsWith('maze_center_')));
    const entrances = [
      [middle - 1, middle - radius - 1, middle - 1, middle - radius],
      [middle, middle - radius - 1, middle, middle - radius],
      [middle - 1, middle + radius, middle - 1, middle + radius + 1],
      [middle, middle + radius, middle, middle + radius + 1],
      [middle - radius - 1, middle - 1, middle - radius, middle - 1],
      [middle - radius - 1, middle, middle - radius, middle],
      [middle + radius, middle, middle + radius + 1, middle],
      [middle + radius, middle - 1, middle + radius + 1, middle - 1]
    ];
    for (let reshuffle = 0; reshuffle < 3; reshuffle++) {
      board.reshuffleMaze(() => 0.5);
      for (const [fromX, fromY, toX, toY] of entrances) {
        for (const row of board.grid) {
          for (const cell of row) cell.hasPlayer = null;
        }
        player.x = fromX;
        player.y = fromY;
        board.grid[fromY][fromX].hasPlayer = player.id;
        assert.ok(board.getMazeValidMoves(player.id).some(move =>
          move.x === toX && move.y === toY
        ));
      }
    }

    for (const row of board.grid) {
      for (const cell of row) cell.hasPlayer = null;
    }
    player.x = middle;
    player.y = middle;
    board.grid[middle][middle].hasPlayer = player.id;
    const destination = board.ejectPlayerFromSafeZone(player.id, () => 0);
    assert.ok(destination);
    assert.equal(board.isSafeZoneCell(destination.x, destination.y), false);
    assert.ok([
      { x: destination.x - 1, y: destination.y },
      { x: destination.x + 1, y: destination.y },
      { x: destination.x, y: destination.y - 1 },
      { x: destination.x, y: destination.y + 1 }
    ].some(cell => board.isSafeZoneCell(cell.x, cell.y)));
    game.destroy();
  });

  it('keeps invisible survivors and powerups hidden from infected board DTOs', () => {
    const game = createGame();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    assert.ok(infected && survivor);

    survivor.invisibleUntil = Date.now() + 5_000;
    survivor.isInPrison = true;
    const infectedView = board.toDTO(infected.id);
    const survivorView = board.toDTO(survivor.id);
    const infectedState = game.getMazeStateDataForPlayer(infected.id);
    const survivorState = game.getMazeStateDataForPlayer(survivor.id);

    assert.equal(infectedView.players[survivor.id], undefined);
    assert.equal(infectedView.grid[survivor.y][survivor.x].hasPlayer, null);
    assert.equal(infectedView.teleports.length, 0);
    assert.equal(infectedView.ghostPickups.length, 0);
    assert.equal(infectedView.invisiblePickups.length, 0);
    assert.equal(infectedView.shieldPickups.length, 0);
    assert.equal(survivorView.players[survivor.id].isInvisible, true);
    assert.equal(survivorView.ghostPickups.length, 3);
    assert.equal(survivorView.invisiblePickups.length, 3);
    assert.equal(survivorView.shieldPickups.length, 3);
    assert.equal(infectedState.rescueStatus.capturedPlayers.includes(survivor.id), false);
    assert.equal(survivorState.rescueStatus.capturedPlayers.includes(survivor.id), true);
    assert.equal(game.canViewerSeeInfectionPlayer(infected.id, survivor.id), false);
    assert.equal(game.canViewerSeeInfectionPlayer(survivor.id, survivor.id), true);
    game.destroy();
  });

  it('keeps three invisible and shield pickups available and relocates collected ones', () => {
    const game = createGame();
    const board = game.board as InfectionBoard;
    const invisible = board.invisiblePickups[0];
    const shield = board.shieldPickups[0];
    assert.ok(invisible && shield);
    assert.equal(board.invisiblePickups.length, 3);
    assert.equal(board.shieldPickups.length, 3);

    assert.equal(board.collectInfectionPowerupAt(invisible.x, invisible.y), 'invisible');
    assert.equal(board.invisiblePickups.length, 3);
    assert.ok(board.invisiblePickups.every(pickup =>
      pickup.x !== invisible.x || pickup.y !== invisible.y
    ));
    assert.equal(board.collectInfectionPowerupAt(shield.x, shield.y), 'shield');
    assert.equal(board.shieldPickups.length, 3);
    assert.ok(board.shieldPickups.every(pickup =>
      pickup.x !== shield.x || pickup.y !== shield.y
    ));
    game.destroy();
  });

  it('allows only the last survivor to reshuffle and preserves traps when moving power-ups', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.equal(survivors.length, 2);
    assert.equal(game.changeMazeLayout(survivors[0].id, () => 0.5), false);
    assert.equal(game.surrender(survivors[0].id), true);
    const lastSurvivor = survivors[1];
    const oldPowerupPositions = new Set([
      ...board.ghostPickups,
      ...board.invisiblePickups,
      ...board.shieldPickups
    ].map(({ x, y }) => `${x},${y}`));
    const trapCell = Array.from({ length: board.size }, (_, y) =>
      Array.from({ length: board.size }, (_, x) => ({ x, y }))
    ).flat().find(({ x, y }) =>
      board.canPlaceTrap(x, y) &&
      !board.ghostPickups.some(item => item.x === x && item.y === y) &&
      !board.invisiblePickups.some(item => item.x === x && item.y === y)
    );
    assert.ok(trapCell);
    const trap = { id: 'reshuffle-persistent-trap', type: 'ice' as const, ...trapCell };
    assert.equal(board.placeTrap(trap), true);
    const placedWall = new Wall('infection-wall-cleared-on-reshuffle', lastSurvivor.id, 1, 1, true);
    board.walls.push(placedWall);

    assert.equal(game.changeMazeLayout(lastSurvivor.id, () => 0.5), true);
    const currentPowerups = [
      ...board.ghostPickups,
      ...board.invisiblePickups,
      ...board.shieldPickups
    ];
    assert.equal(board.ghostPickups.length, 3);
    assert.equal(board.invisiblePickups.length, 3);
    assert.equal(board.shieldPickups.length, 3);
    assert.equal(new Set(currentPowerups.map(({ x, y }) => `${x},${y}`)).size, 9);
    assert.ok(currentPowerups.every(({ x, y }) => !oldPowerupPositions.has(`${x},${y}`)));
    assert.equal(board.walls.includes(placedWall), false);
    assert.deepEqual(board.traps, [trap]);
    game.destroy();
  });

  it('does not allow collecting another infection power-up while one is active', () => {
    const game = createGame();
    const board = game.board as InfectionBoard;
    const pickups = [
      ...board.ghostPickups,
      ...board.invisiblePickups,
      ...board.shieldPickups
    ];
    assert.equal(pickups.length, 9);
    assert.equal(new Set(pickups.map(({ x, y }) => `${x},${y}`)).size, pickups.length);

    for (const pickup of pickups) {
      assert.equal(board.collectInfectionPowerupAt(pickup.x, pickup.y, Math.random, true), null);
    }
    assert.equal(board.ghostPickups.length, 3);
    assert.equal(board.invisiblePickups.length, 3);
    assert.equal(board.shieldPickups.length, 3);
    game.destroy();
  });

  it('grants a 15-second shield that protects a survivor from infection contact', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    const shield = board.shieldPickups[0];
    assert.ok(infected && survivor && shield);

    board.walls = [];
    for (const row of board.grid) {
      for (const cell of row) cell.hasPlayer = null;
    }
    const adjacentCell = shield.x > 1
      ? { x: shield.x - 1, y: shield.y }
      : { x: shield.x + 1, y: shield.y };
    survivor.x = adjacentCell.x;
    survivor.y = adjacentCell.y;
    const infectedCell = [
      { x: shield.x + 1, y: shield.y },
      { x: shield.x - 1, y: shield.y },
      { x: shield.x, y: shield.y + 1 },
      { x: shield.x, y: shield.y - 1 }
    ].find(cell => cell.x > 0 && cell.x < board.size - 1 &&
      cell.y > 0 && cell.y < board.size - 1 &&
      (cell.x !== adjacentCell.x || cell.y !== adjacentCell.y));
    assert.ok(infectedCell);
    infected.x = infectedCell.x;
    infected.y = infectedCell.y;
    for (const player of board.players.values()) {
      board.grid[player.y][player.x].hasPlayer = player.id;
    }

    assert.equal(game.executeMove(survivor.id, shield.x, shield.y), true);
    assert.equal(survivor.mazeShieldActive, true);
    assert.ok(survivor.mazeShieldExpiresAt - Date.now() <= 15_000);
    assert.equal(survivor.isInfected, false);
    game.destroy();
  });

  it('keeps three ghost pickups active and relocates a collected pickup', () => {
    const game = createGame();
    const board = game.board as InfectionBoard;
    assert.equal(board.ghostPickups.length, 3);
    const previousPosition = board.ghostPickups[0];
    assert.ok(previousPosition);

    assert.equal(board.collectInfectionPowerupAt(previousPosition.x, previousPosition.y), 'ghost');
    assert.equal(board.ghostPickups.length, 3);
    assert.ok(board.ghostPickups.every(pickup =>
      pickup.x !== previousPosition.x || pickup.y !== previousPosition.y
    ));
    game.destroy();
  });

  it('gives the Infection ghost power fifteen seconds of wall phasing', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    assert.ok(survivor);
    board.walls = [];
    const pickup = board.getMazeValidMoves(survivor.id)[0];
    assert.ok(pickup);
    board.ghostPickups[0] = { id: 'infection-ghost-duration-test', ...pickup };

    assert.equal(game.executeMove(survivor.id, pickup.x, pickup.y), true);
    assert.ok(survivor.ghostModeExpiresAt >= Date.now() + 14_000);
    assert.ok(survivor.ghostModeExpiresAt <= Date.now() + 15_000);
    game.destroy();
  });

  it('gives the last survivor infected speed and a twenty-second opposite-edge teleport cooldown', () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000 });
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.ok(infected && survivors.length === 2);
    const survivor = survivors[0]!;
    assert.equal(game.surrender(survivors[1]!.id), true);
    board.walls = [];
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    infected.x = 0;
    infected.y = 0;
    survivor.x = Math.floor(board.size / 2);
    survivor.y = Math.floor(board.size / 2);
    board.grid[infected.y]![infected.x]!.hasPlayer = infected.id;
    board.grid[survivor.y]![survivor.x]!.hasPlayer = survivor.id;

    assert.equal(game.getPrivateInfectionState(survivor.id)?.isLastSurvivor, true);
    assert.ok(infected.mazeFrozenUntil >= Date.now() + 4_900);
    assert.ok((game.getPrivateInfectionState(survivor.id)?.lastSurvivorCountdownUntil ?? 0) > Date.now());
    const firstMove = board.getMazeValidMoves(survivor.id)[0];
    assert.ok(firstMove);
    assert.equal(game.executeMove(survivor.id, firstMove.x, firstMove.y), true);
    const secondMove = board.getMazeValidMoves(survivor.id)[0];
    assert.ok(secondMove);
    assert.equal(game.executeMove(survivor.id, secondMove.x, secondMove.y), false);
    mock.timers.tick(80);
    assert.equal(game.executeMove(survivor.id, secondMove.x, secondMove.y), true);

    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    survivor.x = Math.floor(board.size / 2);
    survivor.y = Math.floor(board.size / 2);
    infected.x = 0;
    infected.y = 0;
    board.grid[survivor.y]![survivor.x]!.hasPlayer = survivor.id;
    board.grid[infected.y]![infected.x]!.hasPlayer = infected.id;
    assert.equal(game.useInfectionLastSurvivorTeleport(survivor.id, () => 0.5), true);
    assert.equal(survivor.x, 0);
    assert.equal(
      game.getPrivateInfectionState(survivor.id)?.lastSurvivorTeleportCooldownUntil,
      Date.now() + 20_000
    );
    assert.equal(game.useInfectionLastSurvivorTeleport(survivor.id, () => 0.5), false);
    mock.timers.tick(20_000);
    assert.equal(game.useInfectionLastSurvivorTeleport(survivor.id, () => 0.5), true);
    assert.equal(survivor.x, board.size - 1);
    game.destroy();
    mock.timers.reset();
  });

  it('blocks simultaneous last-survivor powers and applies independent twenty-second cooldowns', () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000 });
    const publicEvents: Array<{ event: string; data: any }> = [];
    const game = createGame(makePlayers(4), (event, data) => publicEvents.push({ event, data }));
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected)!;
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.equal(game.useInfectionLastSurvivorPower(survivors[0]!.id, 'ghost'), false);
    assert.equal(game.useInfectionLastSurvivorPower(infected.id, 'ghost'), false);
    assert.equal(game.surrender(survivors[1]!.id), true);
    assert.equal(game.surrender(survivors[2]!.id), true);
    const survivor = survivors[0]!;

    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'ghost'), true);
    assert.ok(survivor.ghostModeExpiresAt > Date.now());
    assert.equal(
      game.getPrivateInfectionState(survivor.id)?.lastSurvivorPowerCooldowns.ghost,
      Date.now() + 20_000
    );
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'ghost'), false);
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'shield'), false);
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'invisible'), false);
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'teleport'), false);

    survivor.ghostModeExpiresAt = 0;
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'shield'), true);
    assert.equal(survivor.mazeShieldActive, true);
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'invisible'), false);

    survivor.mazeShieldActive = false;
    survivor.mazeShieldExpiresAt = 0;
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'invisible'), true);
    assert.ok(survivor.invisibleUntil > Date.now());
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'teleport'), false);

    survivor.invisibleUntil = 0;
    assert.equal(game.useInfectionLastSurvivorPower(survivor.id, 'teleport', () => 0.5), true);
    const powerEvents = publicEvents.filter(({ event, data }) =>
      event === 'mazePublicEvent' && data.type === 'infection_last_survivor_power_used'
    );
    assert.equal(powerEvents.length, 4);
    assert.ok(powerEvents.every(({ data }) =>
      data.playerId === survivor.id && data.playerName === survivor.username
    ));
    assert.deepEqual(powerEvents.map(({ data }) => data.power), [
      'ghost', 'shield', 'invisible', 'teleport'
    ]);
    const cooldowns = game.getPrivateInfectionState(survivor.id)?.lastSurvivorPowerCooldowns;
    assert.ok(Object.values(cooldowns ?? {}).every(until => until === Date.now() + 20_000));
    game.destroy();
    mock.timers.reset();
  });

  it('prevents infected players from returning to the safe zone', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    assert.ok(infected);

    for (const row of board.grid) {
      for (const cell of row) cell.hasPlayer = null;
    }
    const middle = Math.floor(board.size / 2);
    infected.x = middle - 4;
    infected.y = middle;
    board.grid[infected.y][infected.x].hasPlayer = infected.id;
    board.walls = [];
    const safeZoneCell = { x: middle - 3, y: middle };
    assert.equal(board.isSafeZoneCell(safeZoneCell.x, safeZoneCell.y), true);
    game.startTime = Date.now() - 11_000;
    assert.equal(game.executeMove(infected.id, safeZoneCell.x, safeZoneCell.y), false);
    assert.deepEqual({ x: infected.x, y: infected.y }, { x: middle - 4, y: middle });
    game.destroy();
  });

  it('moves infection portals to new random positions after use', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    const source = board.teleports[0];
    assert.ok(survivor && source);
    const oldPositions = new Set(board.teleports.map(({ x, y }) => `${x},${y}`));
    const oldPortalCount = board.teleports.length;

    for (const row of board.grid) {
      for (const cell of row) cell.hasPlayer = null;
    }
    survivor.x = source.x;
    survivor.y = source.y;
    board.grid[survivor.y][survivor.x].hasPlayer = survivor.id;
    for (const player of board.players.values()) {
      if (player.id === survivor.id) continue;
      board.grid[player.y][player.x].hasPlayer = player.id;
    }

    assert.equal(game.teleportMazePlayer(survivor.id, source.id), true);
    assert.equal(board.teleports.length, oldPortalCount);
    assert.ok(board.teleports.every(({ x, y }) => !oldPositions.has(`${x},${y}`)));
    game.destroy();
  });

  it('allows survivors to place traps and persistent walls, but rejects infected actions', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    assert.ok(infected && survivor);

    const trapCell = Array.from({ length: board.size }, (_, y) =>
      Array.from({ length: board.size }, (_, x) => ({ x, y }))
    ).flat().find(({ x, y }) => board.canPlaceTrap(x, y));
    assert.ok(trapCell);
    assert.equal(game.placeMazeTrap(survivor.id, 'ice', trapCell.x, trapCell.y), true);
    assert.equal(game.getPrivateMazeTrapState(infected.id), null);
    assert.equal(game.getPrivateMazeTrapState(survivor.id)?.traps.length, 1);
    assert.ok((game.getPrivateMazeTrapState(survivor.id)?.cooldowns.ice ?? 0) > 0);

    const otherSurvivor = [...board.players.values()].find(player =>
      !player.isInfected && player.id !== survivor.id
    );
    assert.ok(otherSurvivor);
    const secondTrapCell = Array.from({ length: board.size }, (_, y) =>
      Array.from({ length: board.size }, (_, x) => ({ x, y }))
    ).flat().find(({ x, y }) =>
      (x !== trapCell.x || y !== trapCell.y) && board.canPlaceTrap(x, y)
    );
    assert.ok(secondTrapCell);
    assert.equal(game.placeMazeTrap(otherSurvivor.id, 'ice', secondTrapCell.x, secondTrapCell.y), true);
    assert.equal(game.getPrivateMazeTrapState(otherSurvivor.id)?.traps.length, 2);
    assert.ok((game.getPrivateMazeTrapState(otherSurvivor.id)?.cooldowns.ice ?? 0) > 0);
    assert.equal(game.placeMazeTrap(infected.id, 'teleport', trapCell.x + 1, trapCell.y), false);

    const wallCell = Array.from({ length: board.size - 1 }, (_, y) =>
      Array.from({ length: board.size - 1 }, (_, x) => ({ x, y }))
    ).flat().find(({ x, y }) => board.canPlaceWall(new Wall('candidate', survivor.id, x, y, true)));
    assert.ok(wallCell);
    const initialWallCount = board.walls.length;
    assert.equal(game.placeMazeWall(survivor.id, wallCell.x, wallCell.y, true, 'infection-wall'), true);
    assert.equal(board.walls.length, initialWallCount + 1);
    assert.equal(game.placeMazeWall(infected.id, wallCell.x, wallCell.y + 2, true, 'infected-wall'), false);
    game.destroy();
  });

  it('allows the infected to break an adjacent player-placed wall', () => {
    const events: Array<{ event: string; data: any }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    assert.ok(infected);
    board.walls = [];
    infected.x = 1;
    infected.y = 1;
    const wall = new Wall('infection-test-wall', 'player_1', 1, 1, false);
    assert.equal(board.placeMazeWall(wall), true);

    assert.equal(game.getPrivateMazeRole(infected.id)?.canBreakBlock, true);
    assert.equal(game.breakMazeBlock(infected.id, wall.id), true);
    assert.equal(board.walls.some(candidate => candidate.id === wall.id), false);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'player_broke_wall' &&
      data.playerId === infected.id &&
      data.wallIsHorizontal === false
    ));
    game.destroy();
  });

  it('limits infected wall breaking to once every five seconds', () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000 });
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    assert.ok(infected);
    board.walls = [];
    infected.x = 1;
    infected.y = 1;
    const firstWall = new Wall('infection-cooldown-wall-1', 'player_1', 1, 1, false);
    const secondWall = new Wall('infection-cooldown-wall-2', 'player_1', 1, 1, true);
    board.walls.push(firstWall, secondWall);

    assert.equal(game.breakMazeBlock(infected.id, firstWall.id), true);
    assert.equal(game.getPrivateMazeRole(infected.id)?.wallBreakCooldownUntil, 6_000);
    assert.equal(game.breakMazeBlock(infected.id, secondWall.id), false);
    mock.timers.tick(4_999);
    assert.equal(game.breakMazeBlock(infected.id, secondWall.id), false);
    mock.timers.tick(1);
    assert.equal(game.breakMazeBlock(infected.id, secondWall.id), true);
    game.destroy();
    mock.timers.reset();
  });

  it('allows a trap under the placing survivor but prevents two traps from sharing a cell', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    assert.ok(survivor);

    const trapCell = Array.from({ length: board.size }, (_, y) =>
      Array.from({ length: board.size }, (_, x) => ({ x, y }))
    ).flat().find(({ x, y }) => !board.isSafeZoneCell(x, y) && board.canPlaceTrap(x, y));
    assert.ok(trapCell);
    board.grid[survivor.y][survivor.x].hasPlayer = null;
    survivor.x = trapCell.x;
    survivor.y = trapCell.y;
    board.grid[trapCell.y][trapCell.x].hasPlayer = survivor.id;

    assert.equal(game.placeMazeTrap(survivor.id, 'ice', survivor.x, survivor.y), true);
    assert.equal(game.placeMazeTrap(survivor.id, 'teleport', survivor.x, survivor.y), false);
    assert.equal(board.traps.length, 1);
    game.destroy();
  });

  it('freezes an infected player for ten seconds when they trigger an ice trap', () => {
    const game = createGame();
    game.start();
    game.startTime = Date.now() - 10_000;
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    assert.ok(infected && survivor);

    const trapCell = board.getMazeValidMoves(infected.id).find(({ x, y }) => board.canPlaceTrap(x, y));
    assert.ok(trapCell);
    assert.equal(game.placeMazeTrap(survivor.id, 'ice', trapCell.x, trapCell.y), true);
    assert.equal(game.executeMove(infected.id, trapCell.x, trapCell.y), true);
    assert.ok(infected.mazeFrozenUntil >= Date.now() + 9_000);
    assert.ok(infected.mazeFrozenUntil <= Date.now() + 10_000);
    game.destroy();
  });

  it('lets the last survivor place traps but not walls', () => {
    const privateEvents: Array<{ playerId: string; event: string; data: any }> = [];
    const game = createGame(makePlayers(3));
    game.onPrivateStateChange = (playerId, event, data) =>
      privateEvents.push({ playerId, event, data });
    game.start();
    const board = game.board as InfectionBoard;
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.equal(survivors.length, 2);

    assert.equal(game.surrender(survivors[0].id), true);
    const lastSurvivor = survivors[1];
    assert.equal(game.getPrivateMazeRole(lastSurvivor.id)?.canPlaceWall, false);
    assert.ok(privateEvents.some(({ playerId, event, data }) =>
      playerId === lastSurvivor.id &&
      event === 'mazeActionState' &&
      data.canPlaceWall === false
    ));

    const wallCell = Array.from({ length: board.size - 1 }, (_, y) =>
      Array.from({ length: board.size - 1 }, (_, x) => ({ x, y }))
    ).flat().find(({ x, y }) =>
      !board.isSafeZoneCell(x, y) &&
      board.canPlaceWall(new Wall('candidate', lastSurvivor.id, x, y, true))
    );
    assert.ok(wallCell);
    assert.equal(game.placeMazeWall(lastSurvivor.id, wallCell.x, wallCell.y, true, 'last-survivor-wall'), false);

    const trapCell = Array.from({ length: board.size }, (_, y) =>
      Array.from({ length: board.size }, (_, x) => ({ x, y }))
    ).flat().find(({ x, y }) =>
      !board.isSafeZoneCell(x, y) && board.canPlaceTrap(x, y)
    );
    assert.ok(trapCell);
    board.grid[lastSurvivor.y][lastSurvivor.x].hasPlayer = null;
    lastSurvivor.x = trapCell.x;
    lastSurvivor.y = trapCell.y;
    board.grid[trapCell.y][trapCell.x].hasPlayer = lastSurvivor.id;
    assert.equal(game.placeMazeTrap(lastSurvivor.id, 'ice', lastSurvivor.x, lastSurvivor.y), true);
    game.destroy();
  });

  it('gives the last survivor a twenty-second cooldown for both trap types', () => {
    const game = createGame(makePlayers(3));
    game.start();
    const board = game.board as InfectionBoard;
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.equal(survivors.length, 2);
    assert.equal(game.surrender(survivors[0].id), true);
    const lastSurvivor = survivors[1];

    const validTrapCells = Array.from({ length: board.size }, (_, y) =>
      Array.from({ length: board.size }, (_, x) => ({ x, y }))
    ).flat().filter(({ x, y }) => board.canPlaceTrap(x, y));
    assert.ok(validTrapCells.length >= 2);

    for (const [index, type] of (['ice', 'teleport'] as const).entries()) {
      assert.equal(
        game.placeMazeTrap(lastSurvivor.id, type, validTrapCells[index].x, validTrapCells[index].y),
        true
      );
      const cooldown = game.getPrivateMazeTrapState(lastSurvivor.id)?.cooldowns[type] ?? 0;
      assert.ok(cooldown > 0 && cooldown <= 20);
    }
    game.destroy();
  });

  it('keeps an infection trap when a survivor steps on it, then consumes and announces it for the infected', async () => {
    const events: Array<{ event: string; data: any }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    game.start();
    game.startTime = Date.now() - 11_000;
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.ok(infected && survivors.length === 2);

    board.walls = [];
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    infected.x = 1;
    infected.y = 1;
    survivors[0].x = 2;
    survivors[0].y = 1;
    survivors[1].x = board.size - 2;
    survivors[1].y = board.size - 2;
    for (const player of [infected, ...survivors]) {
      board.grid[player.y][player.x].hasPlayer = player.id;
    }
    const trap = { id: 'infection-ice-notification', type: 'ice' as const, x: 3, y: 1 };
    assert.equal(board.placeTrap(trap), true);

    assert.equal(game.executeMove(survivors[0].id, trap.x, trap.y), true);
    assert.deepEqual(board.traps, [trap]);
    await new Promise(resolve => setTimeout(resolve, 125));
    assert.equal(game.executeMove(survivors[0].id, 4, 1), true);
    assert.deepEqual(board.traps, [trap]);
    await new Promise(resolve => setTimeout(resolve, 125));
    assert.equal(game.executeMove(infected.id, 2, 1), true);
    await new Promise(resolve => setTimeout(resolve, 85));
    assert.equal(game.executeMove(infected.id, trap.x, trap.y), true);

    assert.equal(board.traps.length, 0);
    assert.ok(infected.mazeFrozenUntil >= Date.now() + 9_000);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'infection_trap_triggered' &&
      data.playerId === infected.id &&
      data.playerName === infected.username &&
      data.trapType === 'ice' &&
      data.shielded === false
    ));
    game.destroy();
  });

  it('consumes a teleport trap and sends a shield-block notification without teleporting the infected', () => {
    const events: Array<{ event: string; data: any }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    game.start();
    game.startTime = Date.now() - 11_000;
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    assert.ok(infected);
    board.walls = [];
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    infected.x = 1;
    infected.y = 1;
    board.grid[1][1].hasPlayer = infected.id;
    for (const player of board.players.values()) {
      if (player.id.startsWith('bot_')) continue;
      if (player.id !== infected.id) board.grid[player.y][player.x].hasPlayer = player.id;
    }
    infected.mazeShieldActive = true;
    infected.mazeShieldExpiresAt = Date.now() + 10_000;
    const trap = { id: 'infection-teleport-shield', type: 'teleport' as const, x: 2, y: 1 };
    assert.equal(board.placeTrap(trap), true);

    assert.equal(game.executeMove(infected.id, trap.x, trap.y), true);
    assert.deepEqual({ x: infected.x, y: infected.y }, { x: trap.x, y: trap.y });
    assert.equal(infected.mazeShieldActive, false);
    assert.equal(board.traps.length, 0);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'infection_trap_triggered' &&
      data.playerId === infected.id &&
      data.trapType === 'teleport' &&
      data.shielded === true
    ));
    game.destroy();
  });

  it('teleports an infected player to a board edge and announces the consumed trap', () => {
    const events: Array<{ event: string; data: any }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    game.start();
    game.startTime = Date.now() - 11_000;
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    assert.ok(infected);
    board.walls = [];
    board.teleports = [];
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    infected.x = 1;
    infected.y = 1;
    board.grid[infected.y][infected.x].hasPlayer = infected.id;
    const trap = { id: 'infection-teleport-effect', type: 'teleport' as const, x: 2, y: 1 };
    assert.equal(board.placeTrap(trap), true);

    assert.equal(game.executeMove(infected.id, trap.x, trap.y), true);
    assert.ok(infected.x === 0 || infected.x === board.size - 1 ||
      infected.y === 0 || infected.y === board.size - 1);
    assert.equal(board.traps.length, 0);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'infection_trap_triggered' &&
      data.playerId === infected.id &&
      data.trapType === 'teleport' &&
      data.shielded === false
    ));
    game.destroy();
  });

  it('announces infection, updates the counter and alerts the last survivor', () => {
    const events: Array<{ event: string; data: any }> = [];
    const privateEvents: Array<{ playerId: string; event: string }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    game.onPrivateStateChange = (playerId, event) => privateEvents.push({ playerId, event });
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.ok(infected && survivors.length === 2);

    board.walls = [];
    for (const row of board.grid) {
      for (const cell of row) cell.hasPlayer = null;
    }
    infected.x = 1;
    infected.y = 1;
    survivors[0].x = 3;
    survivors[0].y = 1;
    survivors[1].x = board.size - 2;
    survivors[1].y = board.size - 2;
    for (const player of [infected, ...survivors]) {
      board.grid[player.y][player.x].hasPlayer = player.id;
    }
    game.startTime = Date.now() - 11_000;

    assert.equal(game.executeMove(infected.id, 2, 1), true);
    assert.equal(survivors[0].isInfected, true);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'player_infected' &&
      data.playerName === survivors[0].username
    ));
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.infectedCount, 2);
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.playerCount, 3);
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.isLastSurvivor, true);
    assert.ok((game.getPrivateInfectionState(survivors[1].id)?.lastSurvivorCountdownUntil ?? 0) > Date.now());
    assert.ok(infected.mazeFrozenUntil > Date.now());
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.lastSurvivorTeleportCooldownUntil, 0);
    assert.ok(privateEvents.some(({ playerId, event }) =>
      playerId === survivors[1].id && event === 'infectionLastSurvivor'
    ));
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'infection_last_survivor' &&
      data.playerId === survivors[1].id &&
      data.playerName === survivors[1].username
    ));
    game.destroy();
  });

  it('announces the last survivor when another survivor surrenders', () => {
    const events: Array<{ event: string; data: any }> = [];
    const privateEvents: Array<{ playerId: string; event: string }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    game.onPrivateStateChange = (playerId, event) => privateEvents.push({ playerId, event });
    game.start();
    const survivors = [...game.board.players.values()].filter(player => !player.isInfected);
    assert.equal(survivors.length, 2);

    assert.equal(game.surrender(survivors[0].id), true);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'infection_last_survivor' &&
      data.playerId === survivors[1].id &&
      data.playerName === survivors[1].username
    ));
    assert.ok(privateEvents.some(({ playerId, event }) =>
      playerId === survivors[1].id && event === 'infectionLastSurvivor'
    ));
    game.destroy();
  });

  it('finishes for the infected when the last survivor surrenders', () => {
    const game = createGame();
    game.start();
    const survivor = [...game.board.players.values()].find(player => !player.isInfected);
    assert.ok(survivor);
    for (const otherSurvivor of [...game.board.players.values()].filter(player =>
      !player.isInfected && player.id !== survivor.id
    )) {
      assert.equal(game.surrender(otherSurvivor.id), true);
    }

    assert.equal(game.surrender(survivor.id), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'infected');
    game.destroy();
  });

  it('finishes for survivors when the only infected player surrenders', () => {
    const game = createGame();
    game.start();
    const infected = [...game.board.players.values()].find(player => player.isInfected);
    assert.ok(infected);

    assert.equal(game.surrender(infected.id), true);
    assert.equal(game.state, 'finished');
    assert.equal(game.winner, 'survivors');
    game.destroy();
  });

  it('updates infection counts when a survivor surrenders and the game continues', () => {
    const game = createGame();
    game.start();
    const survivors = [...game.board.players.values()].filter(player => !player.isInfected);
    assert.equal(survivors.length, 2);

    assert.equal(game.surrender(survivors[0].id), true);
    assert.equal(game.state, 'playing');
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.playerCount, 2);
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.infectedCount, 1);
    game.destroy();
  });

  it('infects only orthogonally adjacent survivors without chain infection', async () => {
    const events: Array<{ event: string; data: any }> = [];
    const game = createGame(makePlayers(3), (event, data) => events.push({ event, data }));
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivors = [...board.players.values()].filter(player => !player.isInfected);
    assert.ok(infected && survivors.length === 2);

    board.walls = [];
    for (const row of board.grid) {
      for (const cell of row) cell.hasPlayer = null;
    }
    infected.x = 1;
    infected.y = 1;
    survivors[0].x = 3;
    survivors[0].y = 2;
    survivors[1].x = 4;
    survivors[1].y = 2;
    for (const player of [infected, ...survivors]) {
      board.grid[player.y][player.x].hasPlayer = player.id;
    }
    game.startTime = Date.now() - 11_000;

    assert.equal(game.executeMove(infected.id, 2, 1), true);
    assert.equal(survivors[0].isInfected, false, 'diagonal proximity must not infect');
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(game.executeMove(infected.id, 2, 2), true);
    assert.equal(survivors[0].isInfected, true);
    assert.equal(survivors[1].isInfected, false, 'newly infected players must not cause a same-step chain');
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'player_infected' &&
      data.playerName === survivors[0].username
    ));
    game.destroy();
  });

  it('does not infect an adjacent survivor when a wall separates the players', () => {
    const game = createGame();
    game.start();
    const board = game.board as InfectionBoard;
    const infected = [...board.players.values()].find(player => player.isInfected);
    const survivor = [...board.players.values()].find(player => !player.isInfected);
    const otherSurvivor = [...board.players.values()].find(player =>
      !player.isInfected && player.id !== survivor?.id
    );
    assert.ok(infected && survivor && otherSurvivor);

    board.walls = [];
    for (const row of board.grid) for (const cell of row) cell.hasPlayer = null;
    infected.x = 4;
    infected.y = 4;
    survivor.x = 5;
    survivor.y = 5;
    otherSurvivor.x = board.size - 2;
    otherSurvivor.y = board.size - 2;
    for (const player of [infected, survivor, otherSurvivor]) {
      board.grid[player.y][player.x].hasPlayer = player.id;
    }
    assert.equal(board.placeMazeWall(new Wall('infection-separator', survivor.id, 4, 4, false)), true);
    game.startTime = Date.now() - 11_000;

    assert.equal(game.executeMove(survivor.id, 5, 4), true);
    assert.equal(survivor.isInfected, false);
    game.destroy();
  });
});
