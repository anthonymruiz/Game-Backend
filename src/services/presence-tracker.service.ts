import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { singleton } from 'tsyringe';

export interface IUserPresenceSnapshot {
  online: boolean;
  playing: boolean;
}

export interface IUserPresenceChange {
  userId: string;
  presence: IUserPresenceSnapshot;
}

export interface IUserPresenceResult extends IUserPresenceSnapshot {
  changed: boolean;
}

@singleton()
export class PresenceTrackerService {
  private readonly nodeId = randomUUID();
  private readonly localConnectionCounts = new Map<string, number>();
  private readonly localPlayingCounts = new Map<string, number>();
  private readonly userOperationQueues = new Map<string, Promise<unknown>>();
  private readonly client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { reconnectStrategy: false }
  });
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private onPresenceChange?: (userId: string, presence: IUserPresenceSnapshot) => Promise<void>;
  private onPresenceBatchChange?: (changes: IUserPresenceChange[]) => Promise<void>;
  private onClearLegacyPresence?: () => Promise<void>;
  private redisAvailable = false;
  private cleanupInProgress = false;

  private get nodeKey(): string {
    return `presence:node:${this.nodeId}`;
  }

  public async initialize(
    onPresenceChange: (userId: string, presence: IUserPresenceSnapshot) => Promise<void>,
    onPresenceBatchChange: (changes: IUserPresenceChange[]) => Promise<void>,
    onClearLegacyPresence: () => Promise<void>
  ): Promise<boolean> {
    this.onPresenceChange = onPresenceChange;
    this.onPresenceBatchChange = onPresenceBatchChange;
    this.onClearLegacyPresence = onClearLegacyPresence;
    const client = this.client;
    client.on('error', error => console.error('[PresenceTracker] Redis error:', error));

    try {
      await client.connect();
    } catch (error) {
      this.redisAvailable = false;
      if (client.isOpen) {
        try {
          await client.quit();
        } catch (closeError) {
          console.error('[PresenceTracker] Failed to close Redis after connection failure:', closeError);
        }
      }
      console.warn('[PresenceTracker] Redis unavailable; using single-instance in-memory presence tracking.', error);
      return false;
    }

    this.redisAvailable = true;
    const previousNodes = await client.zRangeByScore('presence:nodes', 0, Date.now());
    if (previousNodes.length > 0) await this.cleanupExpiredNodes(previousNodes);
    await this.refreshNodeLease();
    this.heartbeatInterval = setInterval(() => {
      void this.heartbeat();
    }, 15_000);
    this.heartbeatInterval.unref?.();
    console.info(`[PresenceTracker] Redis presence tracking enabled for node ${this.nodeId}.`);
    return true;
  }

  public async connect(userId: string): Promise<IUserPresenceResult> {
    return this.runUserOperation(userId, async () => {
      const previous = await this.getSnapshot(userId);
      const count = this.localConnectionCounts.get(userId) || 0;
      this.localConnectionCounts.set(userId, count + 1);
      if (count === 0 && this.redisAvailable) {
        await this.client!.sAdd(`${this.nodeKey}:online`, userId);
        await this.client!.sAdd(`presence:user:${userId}:nodes`, this.nodeId);
      }
      const current = await this.getSnapshot(userId);
      return { ...current, changed: this.presenceChanged(previous, current) };
    });
  }

  public async setPlaying(userId: string, isPlaying: boolean): Promise<IUserPresenceResult> {
    return this.runUserOperation(userId, () => this.setPlayingInternal(userId, isPlaying));
  }

  public async disconnect(userId: string, wasPlaying: boolean): Promise<IUserPresenceResult> {
    return this.runUserOperation(userId, async () => {
      const previous = await this.getSnapshot(userId);
      if (wasPlaying) await this.setPlayingInternal(userId, false);

      const count = this.localConnectionCounts.get(userId) || 0;
      if (count <= 1) {
        this.localConnectionCounts.delete(userId);
        this.localPlayingCounts.delete(userId);
        if (this.redisAvailable) {
          await this.client!.sRem(`${this.nodeKey}:online`, userId);
          await this.client!.sRem(`${this.nodeKey}:playing`, userId);
          await this.client!.sRem(`presence:user:${userId}:nodes`, this.nodeId);
          await this.client!.sRem(`presence:user:${userId}:playing-nodes`, this.nodeId);
        }
      } else {
        this.localConnectionCounts.set(userId, count - 1);
      }
      const current = await this.getSnapshot(userId);
      return { ...current, changed: this.presenceChanged(previous, current) };
    });
  }

  private async setPlayingInternal(userId: string, isPlaying: boolean): Promise<IUserPresenceResult> {
    const previous = await this.getSnapshot(userId);
    const count = this.localPlayingCounts.get(userId) || 0;
    if (isPlaying) {
      this.localPlayingCounts.set(userId, count + 1);
      if (count === 0 && this.redisAvailable) {
        await this.client!.sAdd(`${this.nodeKey}:playing`, userId);
        await this.client!.sAdd(`presence:user:${userId}:playing-nodes`, this.nodeId);
      }
    } else if (count > 0) {
      if (count === 1) {
        this.localPlayingCounts.delete(userId);
        if (this.redisAvailable) {
          await this.client!.sRem(`${this.nodeKey}:playing`, userId);
          await this.client!.sRem(`presence:user:${userId}:playing-nodes`, this.nodeId);
        }
      } else {
        this.localPlayingCounts.set(userId, count - 1);
      }
    }
    const current = await this.getSnapshot(userId);
    return { ...current, changed: this.presenceChanged(previous, current) };
  }

  private presenceChanged(previous: IUserPresenceSnapshot, current: IUserPresenceSnapshot): boolean {
    return previous.online !== current.online || previous.playing !== current.playing;
  }

  private runUserOperation<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.userOperationQueues.get(userId) || Promise.resolve();
    const current = previous.then(operation, operation);
    this.userOperationQueues.set(userId, current);
    return current.finally(() => {
      if (this.userOperationQueues.get(userId) === current) this.userOperationQueues.delete(userId);
    });
  }

  public async resetLegacyPresenceIfFirstNode(): Promise<void> {
    if (!this.redisAvailable) {
      await this.onClearLegacyPresence?.();
      return;
    }
    const nodes = await this.client!.zRangeByScore('presence:nodes', Date.now(), '+inf');
    if (nodes.length === 1 && nodes[0] === this.nodeId) {
      await this.onClearLegacyPresence?.();
      console.info('[PresenceTracker] Cleared legacy online flags before accepting connections.');
    }
  }

  public async close(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (!this.client.isOpen) return;

    try {
      const onlineUsers = await this.client.sMembers(`${this.nodeKey}:online`);
      const playingUsers = await this.client.sMembers(`${this.nodeKey}:playing`);
      for (const userId of playingUsers) {
        await this.client.sRem(`presence:user:${userId}:playing-nodes`, this.nodeId);
      }
      for (const userId of onlineUsers) {
        await this.client.sRem(`presence:user:${userId}:nodes`, this.nodeId);
        await this.notifyPresenceChange(userId);
      }
      await this.client.zRem('presence:nodes', this.nodeId);
      await this.client.del([`${this.nodeKey}:online`, `${this.nodeKey}:playing`]);
      await this.client.quit();
    } catch (error) {
      console.error('[PresenceTracker] Failed to close presence tracking cleanly:', error);
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      await this.refreshNodeLease();
      const expiredNodes = await this.client!.zRangeByScore('presence:nodes', 0, Date.now());
      if (expiredNodes.length > 0) await this.cleanupExpiredNodes(expiredNodes);
    } catch (error) {
      console.error('[PresenceTracker] Presence heartbeat failed:', error);
    }
  }

  private async refreshNodeLease(): Promise<void> {
    await this.client!.zAdd('presence:nodes', {
      score: Date.now() + 45_000,
      value: this.nodeId
    });
  }

  private async cleanupExpiredNodes(nodeIds: string[]): Promise<void> {
    if (this.cleanupInProgress) return;
    this.cleanupInProgress = true;

    try {
      for (const nodeId of nodeIds) {
        if (nodeId === this.nodeId) continue;
        const nodeKey = `presence:node:${nodeId}`;
        const onlineUsers = await this.client!.sMembers(`${nodeKey}:online`);
        if (onlineUsers.length === 0) {
          await this.client!.zRem('presence:nodes', nodeId);
          await this.client!.del([`${nodeKey}:online`, `${nodeKey}:playing`]);
          continue;
        }

        const changes: IUserPresenceChange[] = [];
        for (let index = 0; index < onlineUsers.length; index += 500) {
          const batch = onlineUsers.slice(index, index + 500);
          const result = await this.client!.eval(
            `local output = {}
             for index = 2, #ARGV do
               local userId = ARGV[index]
               redis.call('SREM', 'presence:user:' .. userId .. ':nodes', ARGV[1])
               redis.call('SREM', 'presence:user:' .. userId .. ':playing-nodes', ARGV[1])
               local online = redis.call('SCARD', 'presence:user:' .. userId .. ':nodes')
               local playing = redis.call('SCARD', 'presence:user:' .. userId .. ':playing-nodes')
               table.insert(output, online)
               table.insert(output, playing)
             end
             return output`,
            { arguments: [nodeId, ...batch] }
          ) as number[];

          batch.forEach((userId, batchIndex) => {
            const online = Number(result[batchIndex * 2]) > 0;
            const playing = online && Number(result[batchIndex * 2 + 1]) > 0;
            changes.push({ userId, presence: { online, playing } });
          });
        }
        await this.onPresenceBatchChange?.(changes);
        await this.client!.del([`${nodeKey}:online`, `${nodeKey}:playing`]);
        await this.client!.zRem('presence:nodes', nodeId);
      }
    } finally {
      this.cleanupInProgress = false;
    }
  }

  private async notifyPresenceChange(userId: string): Promise<void> {
    const presence = await this.getSnapshot(userId);
    await this.onPresenceChange?.(userId, presence);
  }

  private async getSnapshot(userId: string): Promise<IUserPresenceSnapshot> {
    if (!this.redisAvailable) {
      return {
        online: (this.localConnectionCounts.get(userId) || 0) > 0,
        playing: (this.localPlayingCounts.get(userId) || 0) > 0
      };
    }

    const [connections, playingConnections] = await Promise.all([
      this.client!.sCard(`presence:user:${userId}:nodes`),
      this.client!.sCard(`presence:user:${userId}:playing-nodes`)
    ]);
    return { online: connections > 0, playing: playingConnections > 0 };
  }
}
