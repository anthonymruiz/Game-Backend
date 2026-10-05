import { randomUUID } from 'node:crypto';
import { injectable, container } from 'tsyringe';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { Badge, type BadgeLocales } from '../models/badge.entity.js';
import { BadgeEventReceipt } from '../models/badge-event-receipt.entity.js';
import {
  BADGE_CATEGORIES,
  BADGE_CATEGORY_EVENTS,
  BADGE_EVENTS,
  type BadgeCategory,
  type BadgeEvent
} from '../models/badge.enum.js';
import { UserBadge } from '../models/user-badge.entity.js';
import { User } from '../models/user.entity.js';
import { BadgeRepository } from '../repositories/badge.repository.js';

export interface IBadgeInput {
  code?: string;
  category: BadgeCategory;
  event: BadgeEvent;
  target: number;
  icon: string;
  locales: BadgeLocales;
  isActive?: boolean;
}

export interface IBadgeEvent {
  event: BadgeEvent;
  amount?: number;
  operation?: 'increment' | 'max' | 'set';
}

export interface IBadgeUnlockBatch {
  badges: Badge[];
  language: 'es' | 'en';
}

@injectable()
export class BadgeService {
  private readonly badgeRepository: BadgeRepository;

  constructor() {
    this.badgeRepository = container.resolve(BadgeRepository);
  }

  public async getAdminBadges(filters: {
    category?: string;
    event?: string;
    search?: string;
    active?: string;
  } = {}) {
    const query = this.badgeRepository.badges.createQueryBuilder('badge')
      .leftJoin(UserBadge, 'userBadge', 'userBadge.badgeId = badge.id AND userBadge.unlockedAt IS NOT NULL')
      .addSelect('COUNT(DISTINCT userBadge.userId)', 'unlockedUsers')
      .groupBy('badge.id')
      .orderBy('badge.createdAt', 'DESC')
      .addOrderBy('badge.id', 'DESC');

    if (filters.category && BADGE_CATEGORIES.includes(filters.category as BadgeCategory)) {
      query.andWhere('badge.category = :category', { category: filters.category });
    }
    if (filters.event && BADGE_EVENTS.includes(filters.event as BadgeEvent)) {
      query.andWhere('badge.event = :event', { event: filters.event });
    }
    if (filters.active === 'true' || filters.active === 'false') {
      query.andWhere('badge.isActive = :isActive', { isActive: filters.active === 'true' });
    }
    if (filters.search?.trim()) {
      query.andWhere('(badge.code LIKE :search OR CAST(badge.locales AS CHAR) LIKE :search)', {
        search: `%${filters.search.trim()}%`
      });
    }

    const { entities, raw } = await query.getRawAndEntities();
    return entities.map((badge, index) => ({
      ...badge,
      unlockedUsers: Number(raw[index]?.unlockedUsers || 0)
    }));
  }

  public async getAdminSummary(badgeId?: string) {
    const [catalog, totalUsersWithBadges] = await Promise.all([
      this.badgeRepository.getSummary(),
      this.badgeRepository.userBadges.createQueryBuilder('userBadge')
        .select('COUNT(DISTINCT userBadge.userId)', 'count')
        .where('userBadge.unlockedAt IS NOT NULL')
        .getRawOne<{ count: string }>()
    ]);
    const selectedBadgeUsers = badgeId
      ? await this.badgeRepository.countUnlockedUsers(badgeId)
      : 0;
    return {
      ...catalog,
      usersWithBadges: Number(totalUsersWithBadges?.count || 0),
      selectedBadgeUsers
    };
  }

  public async create(input: IBadgeInput): Promise<Badge> {
    this.validateInput(input);
    const code = (input.code || this.toCode(input.locales.en.name)).trim();
    if (await this.badgeRepository.badges.findOneBy({ code })) throw new Error('BADGE_CODE_ALREADY_EXISTS');
    return this.badgeRepository.badges.save(this.badgeRepository.badges.create({
      ...input,
      code,
      isActive: input.isActive ?? true
    }));
  }

  public async update(id: string, input: IBadgeInput): Promise<Badge> {
    this.validateInput(input);
    const badge = await this.badgeRepository.badges.findOneBy({ id });
    if (!badge) throw new Error('BADGE_NOT_FOUND');

    if (input.code && input.code !== badge.code) {
      const duplicate = await this.badgeRepository.badges.findOneBy({ code: input.code });
      if (duplicate) throw new Error('BADGE_CODE_ALREADY_EXISTS');
      badge.code = input.code;
    }

    const ruleChanged = badge.event !== input.event || badge.target !== input.target;
    badge.category = input.category;
    badge.event = input.event;
    badge.target = input.target;
    badge.icon = input.icon;
    badge.locales = input.locales;
    badge.isActive = input.isActive ?? badge.isActive;
    const saved = await this.badgeRepository.badges.save(badge);
    if (ruleChanged) {
      await this.badgeRepository.userBadges.createQueryBuilder()
        .update(UserBadge)
        .set({ progress: 0 })
        .where('badgeId = :badgeId AND unlockedAt IS NULL', { badgeId: id })
        .execute();
    }
    return saved;
  }

  public async delete(id: string): Promise<void> {
    const result = await this.badgeRepository.badges.delete(id);
    if (!result.affected) throw new Error('BADGE_NOT_FOUND');
  }

  public async getProfileBadges(userId: string, language: 'es' | 'en') {
    const [badges, userBadges] = await Promise.all([
      this.badgeRepository.list(),
      this.badgeRepository.listForUser(userId)
    ]);
    const earnedById = new Map(userBadges.map(userBadge => [userBadge.badgeId, userBadge]));
    const activeBadges = badges.filter(badge => badge.isActive || earnedById.has(badge.id));
    const items = activeBadges.map(badge => {
      const userBadge = earnedById.get(badge.id);
      const locale = badge.locales[language] || badge.locales.en;
      return {
        id: badge.id,
        code: badge.code,
        category: badge.category,
        icon: badge.icon,
        name: locale.name,
        motto: locale.motto,
        description: locale.description,
        target: badge.target,
        progress: Math.min(userBadge?.progress ?? 0, badge.target),
        unlockedAt: userBadge?.unlockedAt ?? null
      };
    });
    items.sort((a, b) => {
      if (!a.unlockedAt) return b.unlockedAt ? 1 : 0;
      if (!b.unlockedAt) return -1;
      return new Date(a.unlockedAt).getTime() - new Date(b.unlockedAt).getTime() ||
        a.code.localeCompare(b.code);
    });
    const earnedCount = items.filter(badge => badge.unlockedAt !== null).length;
    return {
      earnedCount,
      totalCount: items.length,
      remainingCount: Math.max(0, items.length - earnedCount),
      items
    };
  }

  public async recordEvent(
    userId: string,
    event: BadgeEvent,
    amount = 1,
    operation: IBadgeEvent['operation'] = 'increment'
  ): Promise<void> {
    await this.recordEvents(userId, [{ event, amount, operation }]);
  }

  public async recordEvents(userId: string, events: IBadgeEvent[]): Promise<void> {
    if (!events.length) return;
    const result = await AppDataSource.transaction(manager =>
      this.recordEventsInTransaction(manager, userId, events)
    );
    await this.notifyUnlockedBadges(userId, result);
  }

  public async recordEventOnce(
    userId: string,
    event: BadgeEvent,
    sourceId: string
  ): Promise<void> {
    if (!sourceId.trim() || sourceId.length > 128) throw new Error('INVALID_BADGE_EVENT_SOURCE');
    const result = await AppDataSource.transaction(manager =>
      this.recordEventsInTransaction(
        manager,
        userId,
        [{ event }],
        { event, sourceId }
      )
    );
    await this.notifyUnlockedBadges(userId, result);
  }

  public async recordEventsInTransaction(
    manager: EntityManager,
    userId: string,
    events: IBadgeEvent[],
    receipt?: { event: BadgeEvent; sourceId: string }
  ): Promise<IBadgeUnlockBatch> {
    const user = await manager.getRepository(User).createQueryBuilder('user')
      .leftJoinAndSelect('user.preferences', 'preferences')
      .where('user.id = :userId', { userId })
      .setLock('pessimistic_write')
      .getOne();
    if (!user) return { badges: [], language: 'en' };
    const language = user.preferences?.language === 'es' ? 'es' : 'en';

    if (receipt) {
      const receiptRepository = manager.getRepository(BadgeEventReceipt);
      const existingReceipt = await receiptRepository.findOneBy({
        userId,
        event: receipt.event,
        sourceId: receipt.sourceId
      });
      if (existingReceipt) return { badges: [], language };
      await receiptRepository.save(receiptRepository.create({
        userId,
        event: receipt.event,
        sourceId: receipt.sourceId
      }));
    }

    const newlyUnlocked: Badge[] = [];
    const badgeRepository = manager.getRepository(Badge);
    const userBadgeRepository = manager.getRepository(UserBadge);
    for (const activity of events) {
      const amount = activity.amount ?? 1;
      if (!Number.isFinite(amount) || amount < 0) throw new Error('INVALID_BADGE_EVENT_AMOUNT');
      const badges = await badgeRepository.find({
        where: { event: activity.event, isActive: true }
      });
      for (const badge of badges) {
        let userBadge = await userBadgeRepository.findOne({
          where: { userId, badgeId: badge.id }
        });
        if (!userBadge) {
          userBadge = userBadgeRepository.create({
            userId,
            badgeId: badge.id,
            progress: 0,
            unlockedAt: null
          });
        }
        if (userBadge.unlockedAt) continue;

        switch (activity.operation ?? 'increment') {
          case 'increment':
            userBadge.progress += amount;
            break;
          case 'max':
            userBadge.progress = Math.max(userBadge.progress, amount);
            break;
          case 'set':
            userBadge.progress = amount;
            break;
        }

        if (userBadge.progress >= badge.target) {
          userBadge.progress = badge.target;
          userBadge.unlockedAt = new Date();
          newlyUnlocked.push(badge);
        }
        await userBadgeRepository.save(userBadge);
      }
    }
    return { badges: newlyUnlocked, language };
  }

  public async notifyUnlockedBadges(userId: string, result: IBadgeUnlockBatch): Promise<void> {
    if (!result.badges.length) return;
    const { NotificationService } = await import('./notification.service.js');
    const notificationService = container.resolve(NotificationService);
    for (const badge of result.badges) {
      const locale = badge.locales[result.language];
      await notificationService.sendCustomNotification(
        userId,
        'BADGE_UNLOCKED',
        { es: `¡Insignia desbloqueada! ${badge.icon}`, en: `Badge unlocked! ${badge.icon}` },
        { es: `${locale.name}: ${locale.motto}`, en: `${locale.name}: ${locale.motto}` }
      );
    }
  }

  public async resetEventProgress(userId: string, event: BadgeEvent): Promise<void> {
    const badges = await this.badgeRepository.badges.find({ where: { event } });
    if (!badges.length) return;
    await this.badgeRepository.userBadges.createQueryBuilder()
      .update(UserBadge)
      .set({ progress: 0 })
      .where('userId = :userId AND badgeId IN (:...badgeIds) AND unlockedAt IS NULL', {
        userId,
        badgeIds: badges.map(badge => badge.id)
      })
      .execute();
  }

  private validateInput(input: IBadgeInput): void {
    if (!BADGE_CATEGORIES.includes(input.category)) throw new Error('INVALID_BADGE_CATEGORY');
    if (!BADGE_EVENTS.includes(input.event)) throw new Error('INVALID_BADGE_EVENT');
    if (!BADGE_CATEGORY_EVENTS[input.category].includes(input.event)) {
      throw new Error('BADGE_EVENT_CATEGORY_MISMATCH');
    }
    if (!Number.isInteger(input.target) || input.target < 1 || input.target > 1_000_000) {
      throw new Error('INVALID_BADGE_TARGET');
    }
    if (!input.icon?.trim() || input.icon.length > 16) throw new Error('INVALID_BADGE_ICON');
    for (const language of ['es', 'en'] as const) {
      const locale = input.locales?.[language];
      if (!locale || !locale.name?.trim() || !locale.motto?.trim() || !locale.description?.trim()) {
        throw new Error('INVALID_BADGE_LOCALE');
      }
      if (locale.name.length > 100 || locale.motto.length > 180 || locale.description.length > 240) {
        throw new Error('BADGE_LOCALE_TOO_LONG');
      }
    }
    if (input.code && !/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(input.code)) {
      throw new Error('INVALID_BADGE_CODE');
    }
  }

  private toCode(value: string): string {
    const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    return `${slug || 'badge'}-${randomUUID().slice(0, 8)}`;
  }
}
