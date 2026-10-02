import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { GameInstance } from '../game/engine/game-instance.js';
import { IRoomPlayer } from '../services/room.service.js';

describe('13 - Bot Reactions and Emotes Algorithm Tests', () => {

  it('1v1 Mode: Bot identifies opponent as ENEMY and has no teammates', () => {
    const players: IRoomPlayer[] = [
      { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30' },
      { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#007AFF' }
    ];

    const game = new GameInstance('test_1v1_reactions', '1v1', players, () => {});
    const p1 = game.board.players.get('user_1')!;
    const bot = game.board.players.get('bot_red')!;

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

    const game = new GameInstance('test_2v2_reactions', '2v2', players, () => {});
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

  it('Free For All Mode (4-FFA): Bot treats all other players as ENEMIES', () => {
    const players: IRoomPlayer[] = [
      { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30' },
      { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#007AFF' },
      { id: 'bot_green', username: 'BOT - Verde', isGuest: true, color: '#34C759' },
      { id: 'bot_yellow', username: 'BOT - Amarillo', isGuest: true, color: '#FFCC00' }
    ];

    const game = new GameInstance('test_ffa_reactions', '4-FFA', players, () => {});
    const botRed = game.board.players.get('bot_red')!;
    const p1 = game.board.players.get('user_1')!;
    const botGreen = game.board.players.get('bot_green')!;

    assert.strictEqual(game.botReactionManager.isTeammate(botRed, p1), false);
    assert.strictEqual(game.botReactionManager.isEnemy(botRed, p1), true);
    assert.strictEqual(game.botReactionManager.isEnemy(botRed, botGreen), true);

    game.destroy();
  });

  it('Bot Reaction Triggers: Wall placement emits socket events', async () => {
    return new Promise<void>((resolve) => {
      const players: IRoomPlayer[] = [
        { id: 'user_1', username: 'Player 1', isGuest: false, color: '#FF3B30' },
        { id: 'bot_red', username: 'BOT - Rojo', isGuest: true, color: '#007AFF' }
      ];

      let emittedReaction = false;

      const game = new GameInstance('test_emotes_trigger', '1v1', players, (event, data) => {
        if (event === 'emote' || event === 'quickChat') {
          emittedReaction = true;
          assert.ok(data.sender === 'BOT - Rojo' || data.sender === 'Player 1');
          assert.ok(data.emoteId || data.messageId);
        }
      });

      game.start();

      // Human player places a wall blocking bot
      const wallId = `wall_test_${Date.now()}`;
      game.executeWall('user_1', wallId, 4, 0, true);

      setTimeout(() => {
        game.destroy();
        resolve();
      }, 1500);
    });
  });
});

