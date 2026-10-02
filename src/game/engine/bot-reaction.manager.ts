import { GameInstance } from './game-instance.js';
import { Player } from './models.js';

export const BOT_QUICK_PHRASES = {
  HURRY_UP: '¡Apúrate!',
  OOPS: '¡Ups!',
  NICE_WALL: '¡Buen muro!',
  DAMN: '¡Demonios!',
  GOOD_JOB: '¡Buen trabajo!',
  WELL_PLAYED: '¡Bien jugado!'
} as const;

export const BOT_EMOJIS = {
  LAUGHING: '😂',
  SILLY: '🤪',
  PARTY: '🎉',
  ANGRY: '😡',
  CRYING: '😢',
  SHOCKED: '😲',
  CLAP: '👏',
  THUMBS_UP: '👍',
  HEART: '❤️',
  HEART_EYES: '😍',
  YAWN: '🥱',
  STOPWATCH: '⏱️',
  SLEEPING: '😴'
} as const;

export const BOT_REACTION_TIMINGS = {
  COOLDOWN_MS: 4500, // 4.5s cooldown so bots react dynamically in 1v1 / vs_ai / FFA
  SLOW_TURN_THRESHOLD_SEC: 8, // 8s threshold for slow turns
  SLOW_TURN_CHECK_INTERVAL_MS: 2500,
  MIN_DELAY_MS: 300,
  MAX_DELAY_MS: 750
} as const;

export const BOT_REACTION_PROBABILITIES = {
  SLOW_TURN_ENEMY: 0.5,
  SLOW_TURN_TEAMMATE: 0.3,
  BOT_BLOCKED_ENEMY: 0.55,
  ENEMY_BLOCKED_BOT: 0.55,
  TEAMMATE_BLOCKED_ENEMY: 0.5,
  ENEMY_NEAR_WIN: 0.45,
  TEAMMATE_NEAR_WIN: 0.45,
  BOT_ADVANCING: 0.35,
  VICTORY_CELEBRATION: 0.8,
  DEFEAT_REACTION: 0.6
} as const;

const PHRASE_GROUPS = {
  TAUNT_ENEMY: [BOT_QUICK_PHRASES.OOPS, BOT_QUICK_PHRASES.NICE_WALL],
  CELEBRATE_TEAM: [BOT_QUICK_PHRASES.NICE_WALL, BOT_QUICK_PHRASES.GOOD_JOB, BOT_QUICK_PHRASES.WELL_PLAYED],
  FRUSTRATED: [BOT_QUICK_PHRASES.DAMN],
  HURRY: [BOT_QUICK_PHRASES.HURRY_UP]
};

const EMOJI_GROUPS = {
  TAUNT_ENEMY: [BOT_EMOJIS.LAUGHING, BOT_EMOJIS.SILLY, BOT_EMOJIS.PARTY],
  CELEBRATE_TEAM: [BOT_EMOJIS.CLAP, BOT_EMOJIS.THUMBS_UP, BOT_EMOJIS.HEART, BOT_EMOJIS.PARTY],
  FRUSTRATED: [BOT_EMOJIS.ANGRY, BOT_EMOJIS.CRYING, BOT_EMOJIS.SHOCKED],
  HURRY_ENEMY: [BOT_EMOJIS.YAWN, BOT_EMOJIS.STOPWATCH, BOT_EMOJIS.SLEEPING],
  HURRY_TEAMMATE: [BOT_EMOJIS.STOPWATCH, BOT_EMOJIS.THUMBS_UP]
};

export class BotReactionManager {
  private game: GameInstance;
  private lastReactionTime: Map<string, number> = new Map(); // botId -> timestamp
  private turnStartTimestamp: number = 0;
  private slowTurnReacted: boolean = false;
  private slowTurnCheckInterval: NodeJS.Timeout | null = null;

  constructor(game: GameInstance) {
    this.game = game;
  }

  public isTeammate(bot: Player, targetPlayer: Player): boolean {
    if (bot.id === targetPlayer.id) return false;
    if (this.game.mode === '2v2' && bot.team !== undefined && targetPlayer.team !== undefined) {
      return bot.team === targetPlayer.team;
    }
    return false;
  }

  public isEnemy(bot: Player, targetPlayer: Player): boolean {
    if (bot.id === targetPlayer.id) return false;
    return !this.isTeammate(bot, targetPlayer);
  }

  public onTurnStarted(currentTurnPlayerId: string) {
    this.turnStartTimestamp = Date.now();
    this.slowTurnReacted = false;

    if (this.slowTurnCheckInterval) {
      clearInterval(this.slowTurnCheckInterval);
      this.slowTurnCheckInterval = null;
    }

    if (currentTurnPlayerId) {
      this.slowTurnCheckInterval = setInterval(() => {
        this.checkSlowTurn(currentTurnPlayerId);
      }, BOT_REACTION_TIMINGS.SLOW_TURN_CHECK_INTERVAL_MS);
    }
  }

  private checkSlowTurn(currentPlayerId: string) {
    if (this.game.state !== 'playing' || this.slowTurnReacted) return;
    if (this.game.getCurrentPlayer() !== currentPlayerId) return;

    const elapsedSeconds = (Date.now() - this.turnStartTimestamp) / 1000;
    const currentPlayer = this.game.board.players.get(currentPlayerId);
    if (!currentPlayer) return;

    const activeBots = this.getActiveBots();
    if (activeBots.length === 0) return;

    if (elapsedSeconds >= BOT_REACTION_TIMINGS.SLOW_TURN_THRESHOLD_SEC) {
      this.slowTurnReacted = true;

      const enemyBots = activeBots.filter(b => this.isEnemy(b, currentPlayer));
      const teammateBots = activeBots.filter(b => this.isTeammate(b, currentPlayer));

      if (enemyBots.length > 0 && Math.random() < BOT_REACTION_PROBABILITIES.SLOW_TURN_ENEMY) {
        const bot = this.getRandomBot(enemyBots);
        if (bot && this.canBotReact(bot.id)) {
          const isPhrase = Math.random() < 0.7;
          const text = isPhrase 
            ? BOT_QUICK_PHRASES.HURRY_UP 
            : this.getRandomItem(EMOJI_GROUPS.HURRY_ENEMY);
          this.scheduleBotReaction(bot, text, !isPhrase, this.getRandomDelay());
        }
      } else if (teammateBots.length > 0 && Math.random() < BOT_REACTION_PROBABILITIES.SLOW_TURN_TEAMMATE) {
        const bot = this.getRandomBot(teammateBots);
        if (bot && this.canBotReact(bot.id)) {
          const text = Math.random() < 0.5 ? BOT_QUICK_PHRASES.HURRY_UP : BOT_EMOJIS.STOPWATCH;
          this.scheduleBotReaction(bot, text, text === BOT_EMOJIS.STOPWATCH, this.getRandomDelay());
        }
      }
    }
  }

  public onWallPlaced(placerId: string, pathChanges: Map<string, { before: number; after: number }>) {
    const placer = this.game.board.players.get(placerId);
    if (!placer) return;

    const activeBots = this.getActiveBots();
    if (activeBots.length === 0) return;

    const isPlacerBot = this.isBotPlayer(placer);

    if (isPlacerBot) {
      // Bot placed wall
      const bot = placer;
      let lengthenedEnemy = false;

      for (const [targetId, change] of pathChanges.entries()) {
        const targetPlayer = this.game.board.players.get(targetId);
        if (targetPlayer && this.isEnemy(bot, targetPlayer) && change.after > change.before) {
          lengthenedEnemy = true;
          break;
        }
      }

      if ((lengthenedEnemy || this.game.mode === 'vs_ai' || this.game.mode === '1v1') && this.canBotReact(bot.id) && Math.random() < BOT_REACTION_PROBABILITIES.BOT_BLOCKED_ENEMY) {
        const isPhrase = Math.random() < 0.5;
        const text = isPhrase 
          ? this.getRandomItem(PHRASE_GROUPS.TAUNT_ENEMY)
          : this.getRandomItem(EMOJI_GROUPS.TAUNT_ENEMY);

        this.scheduleBotReaction(bot, text, !isPhrase, this.getRandomDelay());
      }
    } else {
      // Human placed wall
      for (const bot of activeBots) {
        if (!this.canBotReact(bot.id)) continue;

        const botPathChange = pathChanges.get(bot.id);
        const placerIsEnemy = this.isEnemy(bot, placer);
        const placerIsTeammate = this.isTeammate(bot, placer);

        if (placerIsEnemy) {
          let blockedBotOrTeammate = (botPathChange && botPathChange.after > botPathChange.before);
          if (!blockedBotOrTeammate) {
            for (const [tId, change] of pathChanges.entries()) {
              const tPlayer = this.game.board.players.get(tId);
              if (tPlayer && this.isTeammate(bot, tPlayer) && change.after > change.before) {
                blockedBotOrTeammate = true;
                break;
              }
            }
          }

          if ((blockedBotOrTeammate || Math.random() < 0.3) && Math.random() < BOT_REACTION_PROBABILITIES.ENEMY_BLOCKED_BOT) {
            const isPhrase = Math.random() < 0.5;
            const text = isPhrase 
              ? BOT_QUICK_PHRASES.DAMN 
              : this.getRandomItem(EMOJI_GROUPS.FRUSTRATED);

            this.scheduleBotReaction(bot, text, !isPhrase, this.getRandomDelay());
            break;
          }
        } else if (placerIsTeammate) {
          let teammateBlockedEnemy = false;
          for (const [tId, change] of pathChanges.entries()) {
            const tPlayer = this.game.board.players.get(tId);
            if (tPlayer && this.isEnemy(bot, tPlayer) && change.after > change.before) {
              teammateBlockedEnemy = true;
              break;
            }
          }

          if (teammateBlockedEnemy && Math.random() < BOT_REACTION_PROBABILITIES.TEAMMATE_BLOCKED_ENEMY) {
            const isPhrase = Math.random() < 0.5;
            const text = isPhrase 
              ? this.getRandomItem(PHRASE_GROUPS.CELEBRATE_TEAM)
              : this.getRandomItem(EMOJI_GROUPS.CELEBRATE_TEAM);

            this.scheduleBotReaction(bot, text, !isPhrase, this.getRandomDelay());
            break;
          }
        }
      }
    }
  }

  public onPlayerMoved(moverId: string, newX: number, newY: number) {
    const mover = this.game.board.players.get(moverId);
    if (!mover) return;

    const activeBots = this.getActiveBots();
    if (activeBots.length === 0) return;

    const isMoverBot = this.isBotPlayer(mover);

    if (isMoverBot) {
      // Bot itself moved!
      const bot = mover;
      if (this.canBotReact(bot.id)) {
        const dist = this.game.board.getShortestPathLength(bot.x, bot.y, bot.targetY, bot.targetX, bot.id);
        if (dist > 0 && dist <= 3 && Math.random() < BOT_REACTION_PROBABILITIES.BOT_ADVANCING) {
          const isPhrase = Math.random() < 0.5;
          const text = isPhrase 
            ? this.getRandomItem(PHRASE_GROUPS.TAUNT_ENEMY)
            : this.getRandomItem(EMOJI_GROUPS.TAUNT_ENEMY);

          this.scheduleBotReaction(bot, text, !isPhrase, this.getRandomDelay());
        }
      }
      return;
    }

    for (const bot of activeBots) {
      if (bot.id === moverId) continue;
      if (!this.canBotReact(bot.id)) continue;

      const dist = this.game.board.getShortestPathLength(mover.x, mover.y, mover.targetY, mover.targetX, mover.id);

      if (this.isEnemy(bot, mover) && dist > 0 && dist <= 2) {
        if (Math.random() < BOT_REACTION_PROBABILITIES.ENEMY_NEAR_WIN) {
          const text = Math.random() < 0.5 ? BOT_QUICK_PHRASES.DAMN : BOT_EMOJIS.SHOCKED;
          this.scheduleBotReaction(bot, text, text === BOT_EMOJIS.SHOCKED, this.getRandomDelay());
          break;
        }
      } else if (this.isTeammate(bot, mover) && dist > 0 && dist <= 3) {
        if (Math.random() < BOT_REACTION_PROBABILITIES.TEAMMATE_NEAR_WIN) {
          const isPhrase = Math.random() < 0.5;
          const text = isPhrase
            ? this.getRandomItem([BOT_QUICK_PHRASES.GOOD_JOB, BOT_QUICK_PHRASES.WELL_PLAYED])
            : this.getRandomItem([BOT_EMOJIS.CLAP, BOT_EMOJIS.THUMBS_UP, BOT_EMOJIS.PARTY]);

          this.scheduleBotReaction(bot, text, !isPhrase, this.getRandomDelay());
          break;
        }
      }
    }
  }

  public onGameFinished(winnerId: string | null) {
    this.stop();
    if (!winnerId) return;

    const winner = this.game.board.players.get(winnerId);
    if (!winner) return;

    const activeBots = this.getActiveBots();
    if (activeBots.length === 0) return;

    for (const bot of activeBots) {
      if (bot.id === winnerId || this.isTeammate(bot, winner)) {
        if (Math.random() < BOT_REACTION_PROBABILITIES.VICTORY_CELEBRATION) {
          const isPhrase = Math.random() < 0.5;
          const text = isPhrase 
            ? this.getRandomItem([BOT_QUICK_PHRASES.WELL_PLAYED, BOT_QUICK_PHRASES.GOOD_JOB])
            : this.getRandomItem(EMOJI_GROUPS.CELEBRATE_TEAM);

          this.scheduleBotReaction(bot, text, !isPhrase, this.getRandomDelay());
        }
      } else {
        if (Math.random() < BOT_REACTION_PROBABILITIES.DEFEAT_REACTION) {
          const text = Math.random() < 0.5 ? BOT_QUICK_PHRASES.WELL_PLAYED : BOT_QUICK_PHRASES.DAMN;
          this.scheduleBotReaction(bot, text, false, this.getRandomDelay());
        }
      }
    }
  }

  public isBotPlayer(player: Player): boolean {
    if (!player) return false;
    const id = player.id || '';
    const username = (player.username || '').toLowerCase();
    return id.startsWith('bot_') || username.includes('bot') || username.includes('ia');
  }

  private getActiveBots(): Player[] {
    const bots: Player[] = [];
    for (const player of this.game.board.players.values()) {
      if (this.isBotPlayer(player)) {
        bots.push(player);
      }
    }
    return bots;
  }

  private getRandomBot(bots: Player[]): Player | null {
    if (bots.length === 0) return null;
    return bots[Math.floor(Math.random() * bots.length)];
  }

  private getRandomItem<T>(items: readonly T[] | T[]): T {
    return items[Math.floor(Math.random() * items.length)];
  }

  private getRandomDelay(): number {
    const min = BOT_REACTION_TIMINGS.MIN_DELAY_MS;
    const max = BOT_REACTION_TIMINGS.MAX_DELAY_MS;
    return min + Math.random() * (max - min);
  }

  private canBotReact(botId: string): boolean {
    const last = this.lastReactionTime.get(botId) || 0;
    const now = Date.now();
    return (now - last) >= BOT_REACTION_TIMINGS.COOLDOWN_MS;
  }

  private scheduleBotReaction(bot: Player, text: string, isEmoji: boolean, delayMs: number) {
    this.lastReactionTime.set(bot.id, Date.now() + delayMs);
    setTimeout(() => {
      const allowedFinishPhrases: string[] = [
        BOT_QUICK_PHRASES.WELL_PLAYED,
        BOT_QUICK_PHRASES.GOOD_JOB,
        BOT_EMOJIS.CLAP,
        BOT_EMOJIS.PARTY
      ];
      if (this.game.state !== 'playing' && !allowedFinishPhrases.includes(text)) return;

      if (isEmoji) {
        this.game.onStateChange('emote', {
          sender: bot.username,
          emoteId: text
        });
      } else {
        this.game.onStateChange('quickChat', {
          sender: bot.username,
          senderId: bot.id,
          messageId: text,
          timestamp: new Date()
        });
      }
    }, delayMs);
  }

  public stop() {
    if (this.slowTurnCheckInterval) {
      clearInterval(this.slowTurnCheckInterval);
      this.slowTurnCheckInterval = null;
    }
  }
}
