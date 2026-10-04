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
  ANGRY: '😡',
  SURPRISED: '😮',
  THUMBS_UP: '👍'
} as const;

export const BOT_REACTION_TIMINGS = {
  COOLDOWN_MS: 4000,
  SLOW_TURN_THRESHOLD_SEC: 8,
  SLOW_TURN_CHECK_INTERVAL_MS: 2500,
  MIN_DELAY_MS: 300,
  MAX_DELAY_MS: 750
} as const;

export const BOT_REACTION_PROBABILITIES = {
  SLOW_TURN_ENEMY: 0.6,
  SLOW_TURN_TEAMMATE: 0.3,
  BOT_BLOCKED_ENEMY: 0.7,   // High chance to laugh when bot blocks enemy
  ENEMY_BLOCKED_BOT: 0.7,   // High chance to be angry when enemy blocks bot
  TEAMMATE_BLOCKED_ENEMY: 0.6,
  ENEMY_NEAR_WIN: 0.7,      // Angry when enemy is 1-2 steps from win
  TEAMMATE_NEAR_WIN: 0.6,
  BOT_ADVANCING: 0.6,       // Laughing when bot is 1-2 steps from win
  VICTORY_CELEBRATION: 0.85,
  DEFEAT_REACTION: 0.85
} as const;

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
          const emoji = Math.random() < 0.6 ? BOT_EMOJIS.SURPRISED : BOT_EMOJIS.THUMBS_UP;
          this.scheduleBotEmoji(bot, emoji, this.getRandomDelay());
        }
      } else if (teammateBots.length > 0 && Math.random() < BOT_REACTION_PROBABILITIES.SLOW_TURN_TEAMMATE) {
        const bot = this.getRandomBot(teammateBots);
        if (bot && this.canBotReact(bot.id)) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.THUMBS_UP, this.getRandomDelay());
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
      // Bot placed wall -> Laugh if it blocked/trapped an enemy!
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
        this.scheduleBotEmoji(bot, BOT_EMOJIS.LAUGHING, this.getRandomDelay());
      }
    } else {
      // Human placed wall -> Be angry if it blocked the bot!
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
            this.scheduleBotEmoji(bot, BOT_EMOJIS.ANGRY, this.getRandomDelay());
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
            this.scheduleBotEmoji(bot, BOT_EMOJIS.THUMBS_UP, this.getRandomDelay());
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
        // If bot is 1-2 steps from winning, laugh (knows it will win)!
        if (dist > 0 && dist <= 2 && Math.random() < BOT_REACTION_PROBABILITIES.BOT_ADVANCING) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.LAUGHING, this.getRandomDelay());
        }
      }
      return;
    }

    for (const bot of activeBots) {
      if (bot.id === moverId) continue;
      if (!this.canBotReact(bot.id)) continue;

      const dist = this.game.board.getShortestPathLength(mover.x, mover.y, mover.targetY, mover.targetX, mover.id);

      if (this.isEnemy(bot, mover)) {
        if (dist > 0 && dist <= 2) {
          // Enemy is 1-2 steps from winning -> Angry (bot is losing)!
          if (Math.random() < BOT_REACTION_PROBABILITIES.ENEMY_NEAR_WIN) {
            this.scheduleBotEmoji(bot, BOT_EMOJIS.ANGRY, this.getRandomDelay());
            break;
          }
        } else if (dist === 3 || dist === 4) {
          // Enemy makes big progress -> Surprised!
          if (Math.random() < 0.4) {
            this.scheduleBotEmoji(bot, BOT_EMOJIS.SURPRISED, this.getRandomDelay());
            break;
          }
        }
      } else if (this.isTeammate(bot, mover) && dist > 0 && dist <= 3) {
        if (Math.random() < BOT_REACTION_PROBABILITIES.TEAMMATE_NEAR_WIN) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.THUMBS_UP, this.getRandomDelay());
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
        // Bot or teammate won -> Laugh or Thumbs Up!
        if (Math.random() < BOT_REACTION_PROBABILITIES.VICTORY_CELEBRATION) {
          const emoji = Math.random() < 0.5 ? BOT_EMOJIS.LAUGHING : BOT_EMOJIS.THUMBS_UP;
          this.scheduleBotEmoji(bot, emoji, this.getRandomDelay());
        }
      } else {
        // Bot lost -> Angry!
        if (Math.random() < BOT_REACTION_PROBABILITIES.DEFEAT_REACTION) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.ANGRY, this.getRandomDelay());
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

  private getBotScalingFactor(): number {
    const activeBots = this.getActiveBots();
    return Math.max(1, activeBots.length);
  }

  private getRandomDelay(): number {
    const min = BOT_REACTION_TIMINGS.MIN_DELAY_MS;
    const max = BOT_REACTION_TIMINGS.MAX_DELAY_MS;
    const baseDelay = min + Math.random() * (max - min);
    return baseDelay * this.getBotScalingFactor();
  }

  private canBotReact(botId: string): boolean {
    const last = this.lastReactionTime.get(botId) || 0;
    const now = Date.now();
    const effectiveCooldown = BOT_REACTION_TIMINGS.COOLDOWN_MS * this.getBotScalingFactor();
    return (now - last) >= effectiveCooldown;
  }

  private scheduleBotEmoji(bot: Player, emoji: string, delayMs: number) {
    const botFactor = this.getBotScalingFactor();
    if (botFactor > 1 && Math.random() > (1 / botFactor)) {
      return;
    }
    this.lastReactionTime.set(bot.id, Date.now() + delayMs);
    setTimeout(() => {
      const allowedFinishEmojis: string[] = [
        BOT_EMOJIS.LAUGHING,
        BOT_EMOJIS.THUMBS_UP,
        BOT_EMOJIS.ANGRY
      ];
      if (this.game.state !== 'playing' && !allowedFinishEmojis.includes(emoji)) return;

      this.game.onStateChange('emote', {
        sender: bot.username,
        emoteId: emoji
      });
    }, delayMs);
  }

  public stop() {
    if (this.slowTurnCheckInterval) {
      clearInterval(this.slowTurnCheckInterval);
      this.slowTurnCheckInterval = null;
    }
  }
}
