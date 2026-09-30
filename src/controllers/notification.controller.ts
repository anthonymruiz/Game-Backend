import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { NotificationService } from '../services/notification.service.js';

@injectable()
export class NotificationController {
  constructor(@inject(NotificationService) private notifService: NotificationService) {}

  public async getAll(req: Request, res: Response) {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const notifications = await this.notifService.getUserNotifications(userId);
    return res.status(200).json({ notifications });
  }

  public async markRead(req: Request, res: Response) {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await this.notifService.markAsRead(userId, req.params.id as string);
    return res.status(200).json({ success: true });
  }

  public async delete(req: Request, res: Response) {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    await this.notifService.deleteNotification(userId, req.params.id as string);
    return res.status(200).json({ success: true });
  }
}
