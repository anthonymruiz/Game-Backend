import { singleton, inject } from 'tsyringe';
import { RedisService } from './redis.service.js';
import { v4 as uuidv4 } from 'uuid';

export type GameMode = '1v1' | '2v2' | '4-FFA' | '6-FFA' | 'vs_ai' | 'labyrinth';

export const GAME_MODES = {
  MODE_1V1: '1v1' as GameMode,
  MODE_2V2: '2v2' as GameMode,
  MODE_4FFA: '4-FFA' as GameMode,
  MODE_6FFA: '6-FFA' as GameMode,
  MODE_VS_AI: 'vs_ai' as GameMode,
  MODE_LABYRINTH: 'labyrinth' as GameMode
} as const;

export const GROUP_GAME_MODES: ReadonlySet<GameMode> = new Set([
  GAME_MODES.MODE_2V2,
  GAME_MODES.MODE_4FFA,
  GAME_MODES.MODE_6FFA,
  GAME_MODES.MODE_LABYRINTH
]);

@singleton()
export class MatchmakingService {
  constructor(@inject(RedisService) private redisService: RedisService) {}

  public async joinQueue(userId: string, mode: GameMode): Promise<string | null> {
    const client = this.redisService.getClient();
    const queueKey = `queue:${mode}`;

    const existing = await client.lRange(queueKey, 0, -1);
    if (!existing.includes(userId)) {
      await client.rPush(queueKey, userId);
    }

    let requiredPlayers = 2;
    if (mode === '2v2' || mode === '4-FFA') requiredPlayers = 4;
    if (mode === '6-FFA') requiredPlayers = 6;

    const currentLen = await client.lLen(queueKey);

    if (currentLen >= requiredPlayers) {
      const players: string[] = [];
      for (let i = 0; i < requiredPlayers; i++) {
        const p = await client.lPop(queueKey);
        if (p) players.push(p);
      }
      
      const matchId = uuidv4();
      await client.hSet(`match:${matchId}`, {
        mode,
        players: JSON.stringify(players),
        status: 'starting'
      });
      await client.expire(`match:${matchId}`, 3600);
      
      return matchId;
    }

    return null;
  }

  public async leaveQueue(userId: string, mode: GameMode): Promise<void> {
    const client = this.redisService.getClient();
    const queueKey = `queue:${mode}`;
    await client.lRem(queueKey, 0, userId);
  }
  
  public async getMatchPlayers(matchId: string): Promise<string[]> {
    const client = this.redisService.getClient();
    const data = await client.hGet(`match:${matchId}`, 'players');
    if (data) return JSON.parse(data);
    return [];
  }
}
