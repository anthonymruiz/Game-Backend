import { Request, Response } from 'express';
import { injectable, inject } from 'tsyringe';
import { NotificationService } from '../services/notification.service.js';

@injectable()
export class NotificationController {
  constructor(@inject(NotificationService) private notifService: NotificationService) {}

  public async getAll(req: Request, res: Response) {
    const user = req.user!;
    const list = await this.notifService.getUserNotifications(user.id);
    return res.status(200).json(list);
  }

  public async markRead(req: Request, res: Response) {
    const user = req.user!;
    await this.notifService.markAsRead(user.id, req.params.id);
    return res.status(200).json({ success: true });
  }

  public async delete(req: Request, res: Response) {
    const user = req.user!;
    await this.notifService.deleteNotification(user.id, req.params.id);
    return res.status(200).json({ success: true });
  }
}
