import { container, singleton } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { In } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { StoreItem, type StoreItemConfiguration } from '../models/store-item.entity.js';
import { UserStoreItem } from '../models/user-store-item.entity.js';
import { User } from '../models/user.entity.js';
import { UserRole } from '../models/user-role.enum.js';
import { Stats } from '../models/stats.entity.js';
import { BadgeService } from './badge.service.js';
import {
  StoreItemCategory,
  StoreItemRarity,
  StoreItemStatus
} from '../models/store-item.enum.js';
import { DEFAULT_STORE_ITEMS } from '../seeds/store-items.seed.js';

export interface IStoreItemInput {
  code?: string;
  configuration: StoreItemConfiguration;
  category: StoreItemCategory;
  rarity: StoreItemRarity;
  pricePoints: number;
  status?: StoreItemStatus;
  icon: string;
  allowColor: boolean;
  sortOrder?: number;
}

export type StoreItemResponse = StoreItem & {
  name: string;
  description: string;
  acquisitionCount: number;
  totalPointsSpent: number;
};

export interface StoreInventoryEntry {
  item: StoreItemResponse;
  quantity: number;
  acquiredAt: Date;
}

@singleton()
export class StoreItemService {
  private seedPromise?: Promise<void>;

  private get repository() {
    return AppDataSource.getRepository(StoreItem);
  }

  public async getItems(includeUnavailable = false): Promise<StoreItemResponse[]> {
    await this.ensureSeeded();
    const items = await this.repository.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    const counts = await AppDataSource.getRepository(UserStoreItem)
      .createQueryBuilder('ownership')
      .select('ownership.storeItemId', 'storeItemId')
      .addSelect('COUNT(ownership.id)', 'count')
      .addSelect('COALESCE(SUM(ownership.pricePointsPaid), 0)', 'totalPointsSpent')
      .groupBy('ownership.storeItemId')
      .getRawMany<{ storeItemId: string; count: string; totalPointsSpent: string }>();
    const statsByItemId = new Map(counts.map(entry => [
      entry.storeItemId,
      { acquisitionCount: Number(entry.count), totalPointsSpent: Number(entry.totalPointsSpent) }
    ]));
    return (includeUnavailable ? items : items.filter(item => item.status === StoreItemStatus.AVAILABLE))
      .map(item => {
        const stats = statsByItemId.get(item.id);
        return this.toResponse(item, stats?.acquisitionCount ?? 0, stats?.totalPointsSpent ?? 0);
      });
  }

  public async getInventory(userId: string): Promise<StoreInventoryEntry[]> {
    const acquisitions = await AppDataSource.getRepository(UserStoreItem).find({
      where: { userId },
      relations: { storeItem: true },
      order: { createdAt: 'DESC' }
    });
    const entries = new Map<string, StoreInventoryEntry>();
    for (const acquisition of acquisitions) {
      const entry = entries.get(acquisition.storeItemId);
      if (entry) {
        entry.quantity += 1;
      } else {
        entries.set(acquisition.storeItemId, {
          item: this.toResponse(acquisition.storeItem, 0, 0),
          quantity: 1,
          acquiredAt: acquisition.createdAt
        });
      }
    }
    return [...entries.values()];
  }

  public async getOwnedItem(userId: string, itemId: string, category: StoreItemCategory): Promise<StoreItem | null> {
    const ownership = await AppDataSource.getRepository(UserStoreItem).findOne({
      where: { userId, storeItemId: itemId },
      relations: { storeItem: true }
    });
    return ownership?.storeItem?.category === category ? ownership.storeItem : null;
  }

  public async purchaseItem(userId: string, itemId: string): Promise<{
    userPoints: number;
    acquisition: UserStoreItem;
    itemName: { en: string; es: string };
  }> {
    const result = await AppDataSource.transaction(async manager => {
      const user = await manager.getRepository(User).createQueryBuilder('user')
        .leftJoinAndSelect('user.stats', 'stats')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!user) throw new Error('USER_NOT_FOUND');
      if (!user.stats) throw new Error('USER_STATS_NOT_FOUND');

      const item = await manager.getRepository(StoreItem).createQueryBuilder('storeItem')
        .where('storeItem.id = :itemId', { itemId })
        .setLock('pessimistic_write')
        .getOne();
      if (!item) throw new Error('STORE_ITEM_NOT_FOUND');
      if (item.status !== StoreItemStatus.AVAILABLE) throw new Error('STORE_ITEM_UNAVAILABLE');
      if (user.stats.points < item.pricePoints) throw new Error('INSUFFICIENT_POINTS');

      user.stats.points -= item.pricePoints;
      await manager.getRepository(Stats).save(user.stats);
      const acquisition = await manager.getRepository(UserStoreItem).save(
        manager.getRepository(UserStoreItem).create({
          userId,
          storeItemId: item.id,
          pricePointsPaid: item.pricePoints
        })
      );
      return {
        userPoints: user.stats.points,
        acquisition,
        itemName: {
          en: item.configuration.en.name,
          es: item.configuration.es.name
        }
      };
    });
    try {
      const badgeService = container.resolve(BadgeService);
      await Promise.all([
        badgeService.recordEvent(userId, 'store_purchase'),
        badgeService.recordEvent(userId, 'store_redeem')
      ]);
    } catch (error) {
      console.error(`Failed to record store badge events for player ${userId}:`, error);
    }
    return result;
  }

  public async searchGiftRecipients(query: string): Promise<Array<Pick<User, 'id' | 'username' | 'email' | 'avatarUrl'>>> {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2 || cleanQuery.length > 50) return [];
    const normalizedQuery = cleanQuery.toLowerCase();
    return AppDataSource.getRepository(User).createQueryBuilder('user')
      .select(['user.id', 'user.username', 'user.email', 'user.avatarUrl'])
      .where('(LOWER(user.username) LIKE :search OR LOWER(user.email) LIKE :search)', {
        search: `%${normalizedQuery}%`
      })
      .andWhere('user.role NOT IN (:...excludedRoles)', {
        excludedRoles: [UserRole.GUEST, UserRole.BANNED]
      })
      .andWhere('(user.provider IS NULL OR user.provider != :guestProvider)', { guestProvider: 'guest' })
      .orderBy(
        `CASE
          WHEN LOWER(user.username) = :normalizedQuery THEN 0
          WHEN LOWER(user.email) = :normalizedQuery THEN 1
          WHEN LOWER(user.username) LIKE :prefix THEN 2
          WHEN LOWER(user.email) LIKE :prefix THEN 3
          WHEN LOWER(user.username) LIKE :search THEN 4
          ELSE 5
        END`,
        'ASC'
      )
      .addOrderBy('user.username', 'ASC')
      .setParameters({ normalizedQuery, prefix: `${normalizedQuery}%` })
      .take(30)
      .getMany();
  }

  public async giftItem(
    giftedByUserId: string,
    recipientUserIds: string[],
    itemId: string
  ): Promise<{
    acquisitions: UserStoreItem[];
    itemName: { en: string; es: string };
    recipients: Array<{ id: string; username: string }>;
  }> {
    const uniqueRecipientIds = [...new Set(recipientUserIds)];
    if (!uniqueRecipientIds.length) throw new Error('INVALID_GIFT_RECIPIENT');
    return AppDataSource.transaction(async manager => {
      const sender = await manager.getRepository(User).findOneBy({ id: giftedByUserId });
      if (!sender || (sender.role !== UserRole.ADMIN && sender.role !== UserRole.SUPERADMIN)) {
        throw new Error('GIFT_SENDER_NOT_ADMIN');
      }
      const recipients = await manager.getRepository(User).find({
        where: { id: In(uniqueRecipientIds) },
        select: { id: true, username: true, role: true, provider: true }
      });
      if (recipients.length !== uniqueRecipientIds.length) throw new Error('GIFT_RECIPIENT_NOT_FOUND');
      if (recipients.some(recipient =>
        recipient.role === UserRole.GUEST ||
        recipient.role === UserRole.BANNED ||
        recipient.provider === 'guest'
      )) {
        throw new Error('GIFT_RECIPIENT_UNAVAILABLE');
      }
      const item = await manager.getRepository(StoreItem).findOneBy({ id: itemId });
      if (!item) throw new Error('STORE_ITEM_NOT_FOUND');

      const acquisitions = await manager.getRepository(UserStoreItem).save(
        recipients.map(recipient => manager.getRepository(UserStoreItem).create({
          userId: recipient.id,
          storeItemId: item.id,
          pricePointsPaid: 0,
          giftedByUserId: sender.id
        }))
      );
      return {
        acquisitions,
        itemName: { en: item.configuration.en.name, es: item.configuration.es.name },
        recipients: recipients.map(({ id, username }) => ({ id, username }))
      };
    });
  }

  public async seedDefaultItems(): Promise<void> {
    await this.ensureSeeded();
  }

  public async updateStatus(id: string, value: unknown): Promise<StoreItemResponse> {
    if (value !== StoreItemStatus.AVAILABLE && value !== StoreItemStatus.UNAVAILABLE) {
      throw new Error('Item status is invalid.');
    }
    const item = await this.repository.findOneBy({ id });
    if (!item) throw new Error('Store item not found.');
    item.status = value;
    const saved = await this.repository.save(item);
    const stats = await this.getAcquisitionStats(id);
    return this.toResponse(saved, stats.acquisitionCount, stats.totalPointsSpent);
  }

  public async createItem(value: unknown): Promise<StoreItemResponse> {
    const input = this.validateItem(value);
    const code = typeof input.code === 'string' && input.code.trim()
      ? input.code.trim()
      : `ITM-${randomUUID().slice(0, 8).toUpperCase()}`;
    if (await this.repository.findOneBy({ code })) throw new Error('Store item code already exists.');
    const saved = await this.repository.save(this.repository.create({ ...input, code }));
    return this.toResponse(saved, 0, 0);
  }

  public async updateItem(id: string, value: unknown): Promise<StoreItemResponse> {
    const item = await this.repository.findOneBy({ id });
    if (!item) throw new Error('Store item not found.');
    const input = this.validateItem(value);
    Object.assign(item, input);
    const saved = await this.repository.save(item);
    const stats = await this.getAcquisitionStats(id);
    return this.toResponse(saved, stats.acquisitionCount, stats.totalPointsSpent);
  }

  private async ensureSeeded(): Promise<void> {
    if (!this.seedPromise) {
      this.seedPromise = this.seedMissingDefaults().catch(error => {
        this.seedPromise = undefined;
        throw error;
      });
    }
    await this.seedPromise;
  }

  private async seedMissingDefaults(): Promise<void> {
    const existing = await this.repository.find({ select: { code: true } });
    const existingCodes = new Set(existing.map(item => item.code));
    const missing = DEFAULT_STORE_ITEMS.filter(item => !existingCodes.has(item.code));
    if (missing.length === 0) return;

    await this.repository.save(missing.map((item, index) => this.repository.create({
      ...item,
      category: item.category as StoreItemCategory,
      rarity: item.rarity as StoreItemRarity,
      status: item.status as StoreItemStatus,
      sortOrder: item.sortOrder ?? existing.length + index
    })));
  }

  private validateItem(value: unknown): IStoreItemInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Store item is invalid.');
    const item = value as Partial<IStoreItemInput>;
    if (!Object.values(StoreItemCategory).includes(item.category as StoreItemCategory)) {
      throw new Error('Store item category is invalid.');
    }
    if (!Object.values(StoreItemRarity).includes(item.rarity as StoreItemRarity)) {
      throw new Error('Store item rarity is invalid.');
    }
    if (item.status !== undefined && !Object.values(StoreItemStatus).includes(item.status)) {
      throw new Error('Store item status is invalid.');
    }
    const pricePoints = Number(item.pricePoints);
    if (!Number.isInteger(pricePoints) || pricePoints < 0 || pricePoints > 1_000_000) {
      throw new Error('Store item price must be an integer between 0 and 1000000.');
    }
    if (typeof item.icon !== 'string' || item.icon.trim().length === 0 || item.icon.length > 120) {
      throw new Error('Store item icon is required and must be at most 120 characters.');
    }
    if (typeof item.allowColor !== 'boolean') throw new Error('Store item allowColor must be a boolean.');
    if (item.code !== undefined && (typeof item.code !== 'string' || !item.code.trim() || item.code.trim().length > 32)) {
      throw new Error('Store item code is invalid.');
    }

    return {
      ...(item.code ? { code: item.code.trim() } : {}),
      configuration: this.validateConfiguration(item.configuration),
      category: item.category as StoreItemCategory,
      rarity: item.rarity as StoreItemRarity,
      pricePoints,
      ...(item.status !== undefined ? { status: item.status } : {}),
      icon: item.icon.trim(),
      allowColor: item.allowColor,
      ...(item.sortOrder !== undefined ? { sortOrder: this.validateInteger(item.sortOrder, 'sortOrder') } : {})
    };
  }

  private validateInteger(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
      throw new Error(`Store item ${field} must be a non-negative integer.`);
    }
    return value;
  }

  private async getAcquisitionStats(itemId: string): Promise<{ acquisitionCount: number; totalPointsSpent: number }> {
    const rawStats = await AppDataSource.getRepository(UserStoreItem)
      .createQueryBuilder('ownership')
      .select('COUNT(ownership.id)', 'acquisitionCount')
      .addSelect('COALESCE(SUM(ownership.pricePointsPaid), 0)', 'totalPointsSpent')
      .where('ownership.storeItemId = :itemId', { itemId })
      .getRawOne<{ acquisitionCount: string; totalPointsSpent: string }>();
    return {
      acquisitionCount: Number(rawStats?.acquisitionCount ?? 0),
      totalPointsSpent: Number(rawStats?.totalPointsSpent ?? 0)
    };
  }

  private validateConfiguration(value: unknown): StoreItemConfiguration {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Store item configuration is invalid.');
    }
    const configuration = value as Partial<StoreItemConfiguration>;
    const validated = {} as StoreItemConfiguration;
    for (const language of ['es', 'en'] as const) {
      const localized = configuration[language];
      if (!localized || typeof localized.name !== 'string' || typeof localized.description !== 'string') {
        throw new Error(`Store item must have a name and description in ${language}.`);
      }
      const name = localized.name.trim();
      const description = localized.description.trim();
      if (!name || name.length > 100) throw new Error(`Store item ${language} name is required and must be at most 100 characters.`);
      if (!description || description.length > 500) throw new Error(`Store item ${language} description is required and must be at most 500 characters.`);
      validated[language] = { name, description };
    }
    return validated;
  }

  private toResponse(item: StoreItem, acquisitionCount: number, totalPointsSpent: number): StoreItemResponse {
    return {
      ...item,
      name: item.configuration.es.name,
      description: item.configuration.es.description,
      acquisitionCount,
      totalPointsSpent
    };
  }
}
