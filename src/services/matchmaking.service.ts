import { singleton, inject } from 'tsyringe';
import { RedisService } from './redis.service.js';
import { v4 as uuidv4 } from 'uuid';

export type GameMode = '1v1' | '2v2' | '4way' | '4-FFA' | '6-FFA' | '6-3v3' | 'vs_ai';

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
    if (mode === '2v2' || mode === '4way' || mode === '4-FFA') requiredPlayers = 4;
    if (mode === '6-FFA' || mode === '6-3v3') requiredPlayers = 6;

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
