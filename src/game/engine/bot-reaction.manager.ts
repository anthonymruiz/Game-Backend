import { GameInstance } from './game-instance.js';
import { Player } from './models.js';

export const BOT_EMOJIS = {
  LAUGHING: '😂',
  ANGRY: '😡',
  SURPRISED: '😮',
  THUMBS_UP: '👍'
} as const;

export const BOT_REACTION_TIMINGS = {
  COOLDOWN_MS: 4000,
  MIN_DELAY_MS: 300,
  MAX_DELAY_MS: 750
} as const;

type BotEmoji = typeof BOT_EMOJIS[keyof typeof BOT_EMOJIS];

export class BotReactionManager {
  private game: GameInstance;
  private lastReactionTime: Map<string, number> = new Map(); // botId -> timestamp

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

  public onWallPlaced(placerId: string, pathChanges: Map<string, { before: number; after: number }>) {
    const placer = this.game.board.players.get(placerId);
    if (!placer) return;

    const activeBots = this.getActiveBots();
    if (activeBots.length === 0) return;

    for (const bot of activeBots) {
      if (!this.canBotReact(bot.id)) continue;

      if (bot.id === placer.id) {
        const blockedEnemy = Array.from(pathChanges.entries()).some(([targetId, change]) => {
          const target = this.game.board.players.get(targetId);
          return target && this.isEnemy(bot, target) && change.after > change.before;
        });
        if (blockedEnemy) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.LAUGHING, this.getRandomDelay());
        }
        continue;
      }

      if (this.isEnemy(bot, placer)) {
        const blockedBotOrTeammate = Array.from(pathChanges.entries()).some(([targetId, change]) => {
          const target = this.game.board.players.get(targetId);
          return target && (target.id === bot.id || this.isTeammate(bot, target)) && change.after > change.before;
        });
        if (blockedBotOrTeammate) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.ANGRY, this.getRandomDelay());
        }
      } else if (this.isTeammate(bot, placer)) {
        const blockedEnemy = Array.from(pathChanges.entries()).some(([targetId, change]) => {
          const target = this.game.board.players.get(targetId);
          return target && this.isEnemy(bot, target) && change.after > change.before;
        });
        if (blockedEnemy) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.THUMBS_UP, this.getRandomDelay());
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
        if (dist > 0 && dist <= 2) {
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
          this.scheduleBotEmoji(bot, BOT_EMOJIS.ANGRY, this.getRandomDelay());
          break;
        } else if (dist === 3 || dist === 4) {
          this.scheduleBotEmoji(bot, BOT_EMOJIS.SURPRISED, this.getRandomDelay());
          break;
        }
      } else if (this.isTeammate(bot, mover) && dist > 0 && dist <= 3) {
        this.scheduleBotEmoji(bot, BOT_EMOJIS.THUMBS_UP, this.getRandomDelay());
        break;
      }
    }
  }

  public onGameFinished(winnerId: string | null) {
    if (!winnerId) return;

    const winner = this.game.board.players.get(winnerId);
    if (!winner) return;

    const activeBots = this.getActiveBots();
    if (activeBots.length === 0) return;

    for (const bot of activeBots) {
      if (bot.id === winnerId) {
        this.scheduleBotEmoji(bot, BOT_EMOJIS.LAUGHING, this.getRandomDelay());
      } else if (this.isTeammate(bot, winner)) {
        this.scheduleBotEmoji(bot, BOT_EMOJIS.THUMBS_UP, this.getRandomDelay());
      } else {
        this.scheduleBotEmoji(bot, BOT_EMOJIS.ANGRY, this.getRandomDelay());
      }
    }
  }

  public isBotPlayer(player: Player): boolean {
    if (!player) return false;
    return player.id.startsWith('bot_');
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

  private scheduleBotEmoji(bot: Player, emoji: BotEmoji, delayMs: number) {
    const botFactor = this.getBotScalingFactor();
    if (botFactor > 1 && Math.random() > (1 / botFactor)) {
      return;
    }

    this.lastReactionTime.set(bot.id, Date.now() + delayMs);
    setTimeout(() => {
      this.game.onStateChange('emote', {
        sender: bot.username,
        emoteId: emoji
      });
    }, delayMs);
  }
}
