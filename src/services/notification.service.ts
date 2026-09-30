import { singleton, container } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { Notification } from '../models/notification.entity.js';
import { User } from '../models/user.entity.js';
import { SocketManager } from '../socket/socket.manager.js';

const TRANSLATIONS: any = {
  en: {
    MATCH_WON_TITLE: 'Match Won!',
    MATCH_WON_MSG: 'Congratulations, you won the match!',
    MATCH_LOST_TITLE: 'Match Lost',
    MATCH_LOST_MSG: 'Better luck next time. You lost the match.',
    ADMIN_MSG_TITLE: 'Message from Admin',
  },
  es: {
    MATCH_WON_TITLE: '¡Partida Ganada!',
    MATCH_WON_MSG: '¡Felicidades, ganaste la partida!',
    MATCH_LOST_TITLE: 'Partida Perdida',
    MATCH_LOST_MSG: 'Mejor suerte la próxima vez. Perdiste la partida.',
    ADMIN_MSG_TITLE: 'Mensaje del Administrador',
  }
};

@singleton()
export class NotificationService {
  constructor() {
    this.startCleanupCron();
  }

  private startCleanupCron() {
    setInterval(async () => {
      try {
        const repo = AppDataSource.getRepository(Notification);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        await repo.createQueryBuilder()
          .delete()
          .from(Notification)
          .where('createdAt < :date', { date: sevenDaysAgo })
          .execute();
      } catch (err) {
        console.error('Error cleaning up notifications', err);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  public async sendNotification(userId: string, type: string, translationKeyTitle: string, translationKeyMsg: string, dynamicData?: string): Promise<void> {
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId }, relations: ['preferences'] });
    if (!user) return;

    const lang = user.preferences?.language || 'en';
    const dict = TRANSLATIONS[lang] || TRANSLATIONS['en'];

    const title = dict[translationKeyTitle] || translationKeyTitle;
    const message = (dict[translationKeyMsg] || translationKeyMsg) + (dynamicData ? ` ${dynamicData}` : '');

    const repo = AppDataSource.getRepository(Notification);
    const notif = new Notification();
    notif.user = user;
    notif.type = type;
    notif.title = title;
    notif.message = message;
    
    await repo.save(notif);

    const socketManager = container.resolve(SocketManager);
    socketManager.io.of('/matchmaking').to(userId).emit('newNotification', notif);
  }

  public async getUserNotifications(userId: string): Promise<Notification[]> {
    return AppDataSource.getRepository(Notification).find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' }
    });
  }

  public async markAsRead(userId: string, notifId: string): Promise<void> {
    await AppDataSource.getRepository(Notification).update(
      { id: notifId, user: { id: userId } },
      { isRead: true }
    );
  }

  public async deleteNotification(userId: string, notifId: string): Promise<void> {
    await AppDataSource.getRepository(Notification).delete({ id: notifId, user: { id: userId } });
  }
}
