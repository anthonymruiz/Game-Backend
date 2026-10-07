import { describe, it } from 'node:test';
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
    const bots = [...board.players.values()].filter(player => player.id.startsWith('bot_'));
    assert.equal(bots.length, 2);
    assert.ok(bots.every(bot => board.isSafeZoneCell(bot.x, bot.y)));

    const bot = bots[0];
    const start = { x: bot.x, y: bot.y };
    assert.equal(game.executeMove(bot.id, bot.x + 1, bot.y), false);
    assert.deepEqual({ x: bot.x, y: bot.y }, start);
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
    assert.equal(survivorView.players[survivor.id].isInvisible, true);
    assert.ok(survivorView.ghostPickups.length >= 10);
    assert.ok(survivorView.invisiblePickups.length > 0);
    assert.equal(infectedState.rescueStatus.capturedPlayers.includes(survivor.id), false);
    assert.equal(survivorState.rescueStatus.capturedPlayers.includes(survivor.id), true);
    assert.equal(game.canViewerSeeInfectionPlayer(infected.id, survivor.id), false);
    assert.equal(game.canViewerSeeInfectionPlayer(survivor.id, survivor.id), true);
    game.destroy();
  });

  it('allows survivors to place traps and temporary walls, but rejects infected actions', () => {
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
    game.startTime = Date.now() - 6_000;

    assert.equal(game.executeMove(infected.id, 2, 1), true);
    assert.equal(survivors[0].isInfected, true);
    assert.ok(events.some(({ event, data }) =>
      event === 'mazePublicEvent' &&
      data.type === 'player_infected' &&
      data.playerName === survivors[0].username
    ));
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.infectedCount, 2);
    assert.equal(game.getPrivateInfectionState(survivors[1].id)?.playerCount, 3);
    assert.ok(privateEvents.some(({ playerId, event }) =>
      playerId === survivors[1].id && event === 'infectionLastSurvivor'
    ));
    game.destroy();
  });
});
