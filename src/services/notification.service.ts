import { singleton, container } from 'tsyringe';
import { MoreThan } from 'typeorm';
import type { EntityManager } from 'typeorm';
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
    REPORT_REPORTER_TITLE: 'Report Update',
    REPORT_REPORTER_MSG: 'Your report has been reviewed by the moderation team. Thank you for helping keep the community safe.',
    REPORTED_USER_TITLE: 'Account Warning',
    REPORTED_USER_MSG: 'You have been reported for violating community rules and have received a strike. Total strikes: {{data}}',
    FRIEND_REQ_TITLE: 'Friend Request',
    FRIEND_REQ_MSG: '{{data}} sent you a friend request.',
    FRIEND_ACC_TITLE: 'Request Accepted',
    FRIEND_ACC_MSG: '{{data}} accepted your friend request.',
    FRIEND_REJ_TITLE: 'Request Declined',
    FRIEND_REJ_MSG: '{{data}} declined your friend request.',
    STORE_ITEM_PURCHASED_TITLE: 'Item purchased',
    STORE_ITEM_PURCHASED_MSG: 'You purchased "{{data}}" from the store.',
    STORE_ITEM_GIFTED_TITLE: 'You received a gift!',
    STORE_ITEM_GIFTED_MSG: 'You received "{{data}}" as a gift.',
    POINTS_GIFTED_TITLE: 'You received points!',
    POINTS_GIFTED_MSG: 'You received {{data}} points as a gift.',
    WEEKLY_REWARD_TITLE: 'Weekly leaderboard reward',
    WEEKLY_REWARD_MSG: 'You finished in {{rank}} in the weekly leaderboard and received {{data}} points.',
    WEEKLY_FIRST_REWARD_MSG: 'You finished 1st in the weekly leaderboard and received {{data}} points, plus the Mystery Gift: {{gift}}.',
    WEEKLY_FIRST_REWARD_NO_GIFT_MSG: 'You finished 1st in the weekly leaderboard and received {{data}} points.'
  },
  es: {
    MATCH_WON_TITLE: '¡Partida Ganada!',
    MATCH_WON_MSG: '¡Felicidades, ganaste la partida!',
    MATCH_LOST_TITLE: 'Partida Perdida',
    MATCH_LOST_MSG: 'Mejor suerte la próxima vez. Perdiste la partida.',
    ADMIN_MSG_TITLE: 'Mensaje del Administrador',
    REPORT_REPORTER_TITLE: 'Actualización de Reporte',
    REPORT_REPORTER_MSG: 'Tu reporte está en revisión y ha sido procesado por el equipo de moderación. Gracias por ayudar a mantener la comunidad segura.',
    REPORTED_USER_TITLE: 'Aviso de Cuenta',
    REPORTED_USER_MSG: 'Has sido reportado por incumplir las normas de la comunidad y se te ha asignado un strike. Total de strikes: {{data}}',
    FRIEND_REQ_TITLE: 'Solicitud de Amistad',
    FRIEND_REQ_MSG: '{{data}} te ha enviado una solicitud de amistad.',
    FRIEND_ACC_TITLE: 'Solicitud Aceptada',
    FRIEND_ACC_MSG: '{{data}} ha aceptado tu solicitud de amistad.',
    FRIEND_REJ_TITLE: 'Solicitud Rechazada',
    FRIEND_REJ_MSG: '{{data}} ha rechazado tu solicitud de amistad.',
    STORE_ITEM_PURCHASED_TITLE: 'Objeto comprado',
    STORE_ITEM_PURCHASED_MSG: 'Has comprado "{{data}}" en la tienda.',
    STORE_ITEM_GIFTED_TITLE: '¡Has recibido un regalo!',
    STORE_ITEM_GIFTED_MSG: 'Te han regalado "{{data}}".',
    POINTS_GIFTED_TITLE: '¡Has recibido puntos!',
    POINTS_GIFTED_MSG: 'Te han regalado {{data}} puntos.',
    WEEKLY_REWARD_TITLE: 'Recompensa de clasificación semanal',
    WEEKLY_REWARD_MSG: 'Terminaste en {{rank}} en la clasificación semanal y recibiste {{data}} puntos.',
    WEEKLY_FIRST_REWARD_MSG: 'Terminaste en 1.er lugar en la clasificación semanal y recibiste {{data}} puntos, además del Mystery Gift: {{gift}}.',
    WEEKLY_FIRST_REWARD_NO_GIFT_MSG: 'Terminaste en 1.er lugar en la clasificación semanal y recibiste {{data}} puntos.'
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

  public async sendNotification(
    userId: string,
    type: string,
    translationKeyTitle: keyof ITranslationKeys,
    translationKeyMsg: keyof ITranslationKeys,
    dynamicData?: string | Partial<Record<SupportedLanguage, string>>
  ): Promise<void> {
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id: userId }, relations: { preferences: true } });
    if (!user) return;

    const lang: SupportedLanguage = (user.preferences?.language as SupportedLanguage) || 'en';
    const dict = TRANSLATIONS[lang] || TRANSLATIONS['en'];
    const localizedData = typeof dynamicData === 'string'
      ? dynamicData
      : dynamicData?.[lang] || dynamicData?.en || '';

    const title = dict[translationKeyTitle] || translationKeyTitle;
    const rawMsg = dict[translationKeyMsg] || translationKeyMsg;
    const message = rawMsg.includes('{{data}}')
      ? rawMsg.replace('{{data}}', localizedData)
      : rawMsg + (localizedData ? ` ${localizedData}` : '');

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

  public async sendCustomNotification(
    userId: string,
    type: string,
    title: Partial<Record<SupportedLanguage, string>>,
    message: Partial<Record<SupportedLanguage, string>>
  ): Promise<void> {
    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { preferences: true }
    });
    if (!user) throw new Error(`Cannot notify missing user ${userId}`);

    const language: SupportedLanguage = user.preferences?.language === 'es' ? 'es' : 'en';
    const notification = new Notification();
    notification.user = user;
    notification.type = type;
    notification.title = title[language] || title.en || '';
    notification.message = message[language] || message.en || '';
    await AppDataSource.getRepository(Notification).save(notification);

    const socketManager = container.resolve(SocketManager);
    if (socketManager.io) {
      socketManager.io.of('/matchmaking').to(userId).emit('newNotification', notification);
    }

    if (user.preferences?.fcmToken && getApps().length > 0) {
      try {
        await getMessaging().send({
          token: user.preferences.fcmToken,
          notification: { title: notification.title, body: notification.message },
          data: { type: notification.type, id: notification.id.toString() }
        });
      } catch (error) {
        console.error('FCM custom notification send failed:', error);
      }
    }
  }

  public async createWeeklyRewardNotification(
    manager: EntityManager,
    userId: string,
    user: User,
    rank: number,
    points: number,
    mysteryGiftName?: Partial<Record<SupportedLanguage, string>>
  ): Promise<{ notification: Notification; userId: string; fcmToken?: string | null }> {
    const language: SupportedLanguage = user.preferences?.language === 'es' ? 'es' : 'en';
    const dictionary = TRANSLATIONS[language];
    const rankLabel = language === 'es'
      ? rank === 2 ? '2.º lugar' : '3.er lugar'
      : rank === 2 ? '2nd place' : '3rd place';
    const message = rank === 1
      ? (mysteryGiftName
          ? dictionary.WEEKLY_FIRST_REWARD_MSG
              .replace('{{data}}', points.toLocaleString(language))
              .replace('{{gift}}', mysteryGiftName[language] || mysteryGiftName.en || '')
          : dictionary.WEEKLY_FIRST_REWARD_NO_GIFT_MSG
              .replace('{{data}}', points.toLocaleString(language)))
      : dictionary.WEEKLY_REWARD_MSG
          .replace('{{rank}}', rankLabel)
          .replace('{{data}}', points.toLocaleString(language));

    const notification = new Notification();
    notification.user = user;
    notification.type = 'WEEKLY_REWARD';
    notification.title = dictionary.WEEKLY_REWARD_TITLE;
    notification.message = message;
    await manager.getRepository(Notification).save(notification);
    return { notification, userId, fcmToken: user.preferences?.fcmToken };
  }

  public async publishWeeklyRewardNotification(
    notification: Notification,
    userId: string,
    fcmToken?: string | null
  ): Promise<void> {
    const socketManager = container.resolve(SocketManager);
    if (socketManager.io) {
      socketManager.io.of('/matchmaking').to(userId).emit('newNotification', notification);
    }

    if (fcmToken && getApps().length > 0) {
      try {
        await getMessaging().send({
          token: fcmToken,
          notification: { title: notification.title, body: notification.message },
          data: { type: notification.type, id: notification.id.toString() }
        });
      } catch (error) {
        console.error('[NotificationService] Weekly reward push notification failed:', error);
      }
    }
  }

  public async getUserNotifications(userId: string): Promise<Notification[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return AppDataSource.getRepository(Notification).find({
      where: { 
        user: { id: userId },
        createdAt: MoreThan(sevenDaysAgo)
      },
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

  public async deleteAllNotifications(userId: string): Promise<void> {
    await AppDataSource.getRepository(Notification).delete({ user: { id: userId } });
  }
}
