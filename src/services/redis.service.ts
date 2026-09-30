import { createClient } from 'redis';
import { singleton } from 'tsyringe';

export type RedisClientType = ReturnType<typeof createClient>;

@singleton()
export class RedisService {
  private client: RedisClientType;

  constructor() {
    this.client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    this.client.on('error', (err) => console.error('Redis Client Error', err));
  }

  public async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
      console.log('Redis connected for operations');
    }
  }

  public getClient(): RedisClientType {
    return this.client;
  }
}
