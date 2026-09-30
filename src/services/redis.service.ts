import { createClient } from 'redis';
import { singleton } from 'tsyringe';

export type RedisClientType = ReturnType<typeof createClient>;

@singleton()
export class RedisService {
  private client: RedisClientType;

  constructor() {
    this.client = createClient({ 
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: false
      }
    });
    this.client.on('error', () => {
      // Suppress continuous reconnect error logs
    });
  }

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      try {
        await this.client.connect();
        console.log('✅ [Redis] Connected successfully.');
      } catch (err: any) {
        console.warn('⚠️ [Redis] Redis server is not running locally. Running in memory fallback mode.');
      }
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }
}
