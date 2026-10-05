import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GameInstance } from '../game/engine/game-instance.js';
import { IRoomPlayer } from '../services/room.service.js';
import { BOT_EMOJIS, BOT_REACTION_TIMINGS } from '../game/engine/bot-reaction.manager.js';
import { GameMode } from '../services/matchmaking.service.js';
import { GAME_INSTANCE_TEST_OPTIONS } from './game-instance-test-options.js';

async function captureBotReactions(
  action: (game: GameInstance) => void,
  mode: GameMode = '1v1',
  players: IRoomPlayer[] = [
    { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30' },
    { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#007AFF' }
  ],
  randomValue = 0
): Promise<{ sender: string; emoteId: string }[]> {
  const reactions: { sender: string; emoteId: string }[] = [];
  const game = new GameInstance(`test_reactions_${Date.now()}`, mode, players, (event, data) => {
    if (event === 'emote') reactions.push(data);
  }, GAME_INSTANCE_TEST_OPTIONS);
  const originalRandom = Math.random;
  game.state = 'playing';
  Math.random = () => randomValue;

  try {
    action(game);
    const botCount = players.filter(player => player.id.startsWith('bot_')).length;
    const minDelay = BOT_REACTION_TIMINGS.MIN_DELAY_MS * Math.max(1, botCount);
    await new Promise(resolve => setTimeout(resolve, minDelay + 50));
    return reactions;
  } finally {
    Math.random = originalRandom;
    game.destroy();
  }
}

function createFfaPlayers(playerCount: 4 | 6): IRoomPlayer[] {
  return Array.from({ length: playerCount }, (_, index) => ({
    id: index === 0 ? 'user_1' : `bot_${index}`,
    username: index === 0 ? 'Player 1' : `BOT ${index}`,
    isGuest: index !== 0,
    color: ['#FF3B30', '#007AFF', '#34C759', '#FFCC00', '#AF52DE', '#F97316'][index]
  }));
}

describe('13 - Bot Reactions and Emotes Algorithm Tests', () => {

  it('1v1 Mode: Bot identifies opponent as ENEMY and has no teammates', () => {
    const players: IRoomPlayer[] = [
      { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30' },
      { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#007AFF' }
    ];

    const game = new GameInstance('test_1v1_reactions', '1v1', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    const p1 = game.board.players.get('user_1')!;
    const bot = game.board.players.get('bot_red')!;

    p1.username = 'Maria';
    assert.strictEqual(game.botReactionManager.isBotPlayer(p1), false);
    assert.strictEqual(game.botReactionManager.isBotPlayer(bot), true);
    assert.strictEqual(game.botReactionManager.isTeammate(bot, p1), false);
    assert.strictEqual(game.botReactionManager.isEnemy(bot, p1), true);
    game.destroy();
  });

  it('2v2 Mode: Bot identifies team partner as TEAMMATE and opponents as ENEMIES', () => {
    const players: IRoomPlayer[] = [
      { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#FF3B30', team: 1 },
      { id: 'user_2', username: 'Player 2', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'bot_blue', username: 'BOT - Azul', isGuest: true, color: '#007AFF', team: 2 }
    ];

    const game = new GameInstance('test_2v2_reactions', '2v2', players, () => {}, GAME_INSTANCE_TEST_OPTIONS);
    const p1 = game.board.players.get('user_1')!;
    const botRed = game.board.players.get('bot_red')!;
    const p2 = game.board.players.get('user_2')!;
    const botBlue = game.board.players.get('bot_blue')!;

    // Bot Red team assertions
    assert.strictEqual(game.botReactionManager.isTeammate(botRed, p1), true);
    assert.strictEqual(game.botReactionManager.isEnemy(botRed, p1), false);
    assert.strictEqual(game.botReactionManager.isEnemy(botRed, p2), true);
    assert.strictEqual(game.botReactionManager.isEnemy(botRed, botBlue), true);

    // Bot Blue team assertions
    assert.strictEqual(game.botReactionManager.isTeammate(botBlue, p2), true);
    assert.strictEqual(game.botReactionManager.isEnemy(botBlue, p1), true);

    game.destroy();
  });

  it('4-FFA and 6-FFA treat every other player, including bots, as an enemy', () => {
    for (const [mode, count] of [['4-FFA', 4], ['6-FFA', 6]] as const) {
      const game = new GameInstance(`test_${mode}_reactions`, mode, createFfaPlayers(count), () => {}, GAME_INSTANCE_TEST_OPTIONS);
      const bot = game.board.players.get('bot_1')!;
      const human = game.board.players.get('user_1')!;
      const otherBot = game.board.players.get('bot_2')!;

      assert.strictEqual(game.botReactionManager.isTeammate(bot, human), false);
      assert.strictEqual(game.botReactionManager.isEnemy(bot, human), true);
      assert.strictEqual(game.botReactionManager.isTeammate(bot, otherBot), false);
      assert.strictEqual(game.botReactionManager.isEnemy(bot, otherBot), true);
      game.destroy();
    }
  });

  it('The same laugh/anger wall logic works in 1v1, 2v2, 4-FFA and 6-FFA', async () => {
    const scenarios: { mode: GameMode; players: IRoomPlayer[]; placerId: string; targetId: string }[] = [
      {
        mode: '1v1',
        players: [
          { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30' },
          { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#007AFF' }
        ],
        placerId: 'bot_red',
        targetId: 'user_1'
      },
      {
        mode: '2v2',
        players: [
          { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30', team: 1 },
          { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#FF3B30', team: 1 },
          { id: 'user_2', username: 'Player 2', isGuest: false, color: '#007AFF', team: 2 },
          { id: 'bot_blue', username: 'BOT - Azul', isGuest: true, color: '#007AFF', team: 2 }
        ],
        placerId: 'bot_red',
        targetId: 'user_2'
      },
      { mode: '4-FFA', players: createFfaPlayers(4), placerId: 'bot_1', targetId: 'bot_2' },
      { mode: '6-FFA', players: createFfaPlayers(6), placerId: 'bot_1', targetId: 'bot_5' }
    ];

    for (const scenario of scenarios) {
      const laugh = await captureBotReactions(game => {
        game.botReactionManager.onWallPlaced(scenario.placerId, new Map([
          [scenario.targetId, { before: 8, after: 9 }]
        ]));
      }, scenario.mode, scenario.players);
      assert.ok(laugh.some(reaction =>
        reaction.sender === scenario.players.find(player => player.id === scenario.placerId)?.username
        && reaction.emoteId === BOT_EMOJIS.LAUGHING
      ), `${scenario.mode} placer bot should laugh when it blocks a rival`);

      const anger = await captureBotReactions(game => {
        game.botReactionManager.onWallPlaced(scenario.targetId, new Map([
          [scenario.placerId, { before: 8, after: 9 }]
        ]));
      }, scenario.mode, scenario.players);
      assert.ok(anger.some(reaction =>
        reaction.sender === scenario.players.find(player => player.id === scenario.placerId)?.username
        && reaction.emoteId === BOT_EMOJIS.ANGRY
      ), `${scenario.mode} affected bot should get angry when a rival blocks it`);
    }
  });

  it('Bot laughs only when its wall makes an enemy path longer', async () => {
    const noBlock = await captureBotReactions(game => {
      game.botReactionManager.onWallPlaced('bot_red', new Map([
        ['user_1', { before: 8, after: 8 }],
        ['bot_red', { before: 8, after: 8 }]
      ]));
    });
    assert.deepStrictEqual(noBlock, []);

    const blocked = await captureBotReactions(game => {
      game.botReactionManager.onWallPlaced('bot_red', new Map([
        ['user_1', { before: 8, after: 9 }],
        ['bot_red', { before: 8, after: 8 }]
      ]));
    });
    assert.deepStrictEqual(blocked.map(reaction => reaction.emoteId), [BOT_EMOJIS.LAUGHING]);
  });

  it('Bot gets angry only when an enemy wall makes its path longer', async () => {
    const noBlock = await captureBotReactions(game => {
      game.botReactionManager.onWallPlaced('user_1', new Map([
        ['user_1', { before: 8, after: 8 }],
        ['bot_red', { before: 8, after: 8 }]
      ]));
    });
    assert.deepStrictEqual(noBlock, []);

    const blocked = await captureBotReactions(game => {
      game.botReactionManager.onWallPlaced('user_1', new Map([
        ['user_1', { before: 8, after: 8 }],
        ['bot_red', { before: 8, after: 9 }]
      ]));
    });
    assert.deepStrictEqual(blocked.map(reaction => reaction.emoteId), [BOT_EMOJIS.ANGRY]);
  });

  it('Bot laughs when one or two moves from victory and gets angry when an enemy is', async () => {
    const botNearWin = await captureBotReactions(game => {
      const bot = game.board.players.get('bot_red')!;
      game.board.grid[bot.y][bot.x].hasPlayer = null;
      bot.y = 7;
      game.board.grid[bot.y][bot.x].hasPlayer = bot.id;
      game.botReactionManager.onPlayerMoved(bot.id, bot.x, bot.y);
    });
    assert.deepStrictEqual(botNearWin.map(reaction => reaction.emoteId), [BOT_EMOJIS.LAUGHING]);

    const enemyNearWin = await captureBotReactions(game => {
      const enemy = game.board.players.get('user_1')!;
      game.board.grid[enemy.y][enemy.x].hasPlayer = null;
      enemy.y = 1;
      game.board.grid[enemy.y][enemy.x].hasPlayer = enemy.id;
      game.botReactionManager.onPlayerMoved(enemy.id, enemy.x, enemy.y);
    });
    assert.deepStrictEqual(enemyNearWin.map(reaction => reaction.emoteId), [BOT_EMOJIS.ANGRY]);
  });

  it('Bot uses only the four shown reactions for match outcomes', async () => {
    const reactions = await captureBotReactions(game => {
      game.botReactionManager.onGameFinished('user_1');
    });
    assert.deepStrictEqual(reactions.map(reaction => reaction.emoteId), [BOT_EMOJIS.ANGRY]);
    const allowedEmojis: string[] = Object.values(BOT_EMOJIS);
    assert.ok(reactions.every(reaction => allowedEmojis.includes(reaction.emoteId)));

    const botVictory = await captureBotReactions(game => {
      game.botReactionManager.onGameFinished('bot_red');
    });
    assert.deepStrictEqual(botVictory.map(reaction => reaction.emoteId), [BOT_EMOJIS.LAUGHING]);
  });

  it('A bot teammate uses thumbs up when its team wins', async () => {
    const reactions = await captureBotReactions(game => {
      game.botReactionManager.onGameFinished('user_1');
    }, '2v2', [
      { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#FF3B30', team: 1 },
      { id: 'user_2', username: 'Player 2', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'bot_blue', username: 'BOT - Azul', isGuest: true, color: '#007AFF', team: 2 }
    ]);
    assert.deepStrictEqual(reactions.map(reaction => reaction.emoteId), [BOT_EMOJIS.THUMBS_UP, BOT_EMOJIS.ANGRY]);
  });

  it('A 2v2 bot cheers a teammate wall that blocks an enemy, but is angry when an enemy blocks its teammate', async () => {
    const players: IRoomPlayer[] = [
      { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30', team: 1 },
      { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#FF3B30', team: 1 },
      { id: 'user_2', username: 'Player 2', isGuest: false, color: '#007AFF', team: 2 },
      { id: 'bot_blue', username: 'BOT - Azul', isGuest: true, color: '#007AFF', team: 2 }
    ];
    const teammateWall = await captureBotReactions(game => {
      game.botReactionManager.onWallPlaced('user_1', new Map([
        ['user_2', { before: 8, after: 9 }]
      ]));
    }, '2v2', players);
    assert.deepStrictEqual(teammateWall.map(reaction => reaction.emoteId), [BOT_EMOJIS.THUMBS_UP, BOT_EMOJIS.ANGRY]);

    const enemyWall = await captureBotReactions(game => {
      game.botReactionManager.onWallPlaced('user_2', new Map([
        ['user_1', { before: 8, after: 9 }]
      ]));
    }, '2v2', players);
    assert.deepStrictEqual(enemyWall.map(reaction => reaction.emoteId), [BOT_EMOJIS.ANGRY, BOT_EMOJIS.THUMBS_UP]);
  });

  it('Scales delay and suppresses reactions in a six-player game with five bots', async () => {
    const players = createFfaPlayers(6);
    const reactions = await captureBotReactions(game => {
      game.botReactionManager.onGameFinished('user_1');
    }, '6-FFA', players, 0.99);
    assert.deepStrictEqual(reactions, []);
  });
});
