import { singleton, container } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { Notification } from '../models/notification.entity.js';
import { User } from '../models/user.entity.js';
import { SocketManager } from '../socket/socket.manager.js';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { SupportedLanguage, ITranslations, ITranslationKeys } from '../types/language.type.js';

try {
  if (process.env.FIREBASE_CONFIG) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_CONFIG))
    });
    console.log('Firebase Admin initialized for Mobile Push Notifications.');
  }
} catch (e) {
  console.log('Firebase config not found. Mobile background pushes disabled.');
}

const TRANSLATIONS: ITranslations = {
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
    const timer = setInterval(async () => {
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
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  public async sendNotification(userId: string, type: string, translationKeyTitle: keyof ITranslationKeys, translationKeyMsg: keyof ITranslationKeys, dynamicData?: string): Promise<void> {
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId }, relations: { preferences: true } });
    if (!user) return;

    const lang: SupportedLanguage = (user.preferences?.language as SupportedLanguage) || 'en';
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
    if (socketManager.io) {
      socketManager.io.of('/matchmaking').to(userId).emit('newNotification', notif);
    }

    // Send via FCM if they have a token (Background Mobile Push)
    if (user.preferences?.fcmToken && getApps().length > 0) {
      try {
        await getMessaging().send({
          token: user.preferences.fcmToken,
          notification: {
            title: notif.title,
            body: notif.message,
          },
          data: {
            type: notif.type,
            id: notif.id.toString()
          }
        });
      } catch (fcmError) {
        console.error('FCM send failed:', fcmError);
      }
    }
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
