import { injectable, container } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { RewardsSettings } from '../models/rewards-settings.entity.js';
import { Stats } from '../models/stats.entity.js';
import { StoreItem } from '../models/store-item.entity.js';
import { User } from '../models/user.entity.js';
import { UserStoreItem } from '../models/user-store-item.entity.js';
import { WeeklyRewardPayout } from '../models/weekly-reward-payout.entity.js';
import { UserRepository } from '../repositories/user.repository.js';
import { getMostRecentCompletedUtcWeekStart, getUtcWeekRange } from '../utils/utc-week.util.js';
import { BadgeService, type IBadgeUnlockBatch } from './badge.service.js';
import { NotificationService } from './notification.service.js';

@injectable()
export class WeeklyRewardsService {
  public async getCurrentWeek(): Promise<{ start: string; end: string }> {
    const { start, end } = getUtcWeekRange(new Date());
    return { start: start.toISOString(), end: end.toISOString() };
  }

  public async payMostRecentCompletedWeek(now = new Date()): Promise<boolean> {
    const weekStart = getMostRecentCompletedUtcWeekStart(now);
    const { end: weekEnd } = getUtcWeekRange(weekStart);
    const notificationService = container.resolve(NotificationService);

    const deliveries = await AppDataSource.transaction(async manager => {
      const settings = await manager.getRepository(RewardsSettings).findOne({
        where: { singletonKey: 1 },
        lock: { mode: 'pessimistic_write' }
      });
      if (!settings) throw new Error('REWARDS_CONFIGURATION_NOT_FOUND');

      const payoutRepository = manager.getRepository(WeeklyRewardPayout);
      if (await payoutRepository.findOneBy({ weekStart: weekStart.toISOString().slice(0, 10) })) return null;

      const giftItem = settings.weeklyMysteryGiftItemId
        ? await manager.getRepository(StoreItem).findOneBy({ id: settings.weeklyMysteryGiftItemId })
        : null;
      if (settings.weeklyMysteryGiftItemId && !giftItem) throw new Error('WEEKLY_MYSTERY_GIFT_NOT_FOUND');

      const winners = await container.resolve(UserRepository).getTopPlayersByWins(
        3,
        undefined,
        undefined,
        weekStart,
        weekEnd
      );
      const prizes = [
        settings.weeklyFirstPlacePoints,
        settings.weeklySecondPlacePoints,
        settings.weeklyThirdPlacePoints
      ];
      const notificationDeliveries: Array<{
        notification: import('../models/notification.entity.js').Notification;
        userId: string;
        fcmToken?: string | null;
      }> = [];
      const badgeDeliveries: Array<{ userId: string; unlocks: IBadgeUnlockBatch }> = [];
      const [firstWinner, secondWinner, thirdWinner] = winners;
      const payout = payoutRepository.create({
        weekStart: weekStart.toISOString().slice(0, 10),
        firstPlaceUserId: firstWinner?.userId ?? null,
        secondPlaceUserId: secondWinner?.userId ?? null,
        thirdPlaceUserId: thirdWinner?.userId ?? null
      });
      await payoutRepository.save(payout);

      for (const [index, winner] of winners.entries()) {
        const user = await manager.getRepository(User).findOne({
          where: { id: winner.userId },
          relations: { stats: true, preferences: true }
        });
        if (!user?.stats) throw new Error(`WEEKLY_REWARD_USER_STATS_NOT_FOUND:${winner.userId}`);
        user.stats.points += prizes[index];
        await manager.getRepository(Stats).save(user.stats);
        if (index === 0 && giftItem) {
          await manager.getRepository(UserStoreItem).save(
            manager.getRepository(UserStoreItem).create({
              userId: user.id,
              storeItemId: giftItem.id,
              pricePointsPaid: 0
            })
          );
        }
        notificationDeliveries.push(await notificationService.createWeeklyRewardNotification(
          manager,
          user.id,
          user,
          index + 1,
          prizes[index],
          index === 0 && giftItem
            ? { en: giftItem.configuration.en.name, es: giftItem.configuration.es.name }
            : undefined
        ));
        const placementEvent = ([
          'weekly_first_place',
          'weekly_second_place',
          'weekly_third_place'
        ] as const)[index];
        if (!placementEvent) throw new Error(`WEEKLY_REWARD_PLACEMENT_EVENT_NOT_FOUND:${index + 1}`);
        const unlocks = await container.resolve(BadgeService).recordEventsInTransaction(
          manager,
          user.id,
          [{ event: placementEvent }]
        );
        badgeDeliveries.push({ userId: user.id, unlocks });
      }
      return { notificationDeliveries, badgeDeliveries };
    });

    if (deliveries === null) return false;
    for (const delivery of deliveries.notificationDeliveries) {
      try {
        await notificationService.publishWeeklyRewardNotification(
          delivery.notification,
          delivery.userId,
          delivery.fcmToken
        );
      } catch (error) {
        console.error(`[WeeklyRewards] Could not publish notification to ${delivery.userId}:`, error);
      }
    }
    for (const delivery of deliveries.badgeDeliveries) {
      try {
        await container.resolve(BadgeService).notifyUnlockedBadges(delivery.userId, delivery.unlocks);
      } catch (error) {
        console.error(`[WeeklyRewards] Could not publish badge notification to ${delivery.userId}:`, error);
      }
    }
    return true;
  }
}

export function startWeeklyRewardsScheduler(): void {
  let lastError: string | null = null;
  const run = async (): Promise<void> => {
    try {
      const distributed = await container.resolve(WeeklyRewardsService).payMostRecentCompletedWeek();
      if (distributed) console.info('[WeeklyRewards] Distributed weekly rewards.');
      lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) {
        console.error('[WeeklyRewards] Could not distribute weekly rewards:', error);
        lastError = message;
      }
    }
  };
  void run();
  setInterval(() => void run(), 60_000);
}
