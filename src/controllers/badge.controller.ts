import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { BADGE_CATEGORIES, BADGE_CATEGORY_EVENTS, BADGE_EVENTS } from '../models/badge.enum.js';
import { BadgeService, type IBadgeInput } from '../services/badge.service.js';

@injectable()
export class BadgeController {
  private readonly badgeService = container.resolve(BadgeService);

  public getAdminBadges = async (req: Request, res: Response): Promise<void> => {
    try {
      const badges = await this.badgeService.getAdminBadges({
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        event: typeof req.query.event === 'string' ? req.query.event : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        active: typeof req.query.active === 'string' ? req.query.active : undefined
      });
      res.status(200).json({ badges });
    } catch (error) {
      console.error('Failed to load admin badges:', error);
      res.status(500).json({ error: 'BADGE_LIST_FAILED' });
    }
  };

  public getSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const badgeId = typeof req.query.badgeId === 'string' ? req.query.badgeId : undefined;
      res.status(200).json(await this.badgeService.getAdminSummary(badgeId));
    } catch (error) {
      console.error('Failed to load badge summary:', error);
      res.status(500).json({ error: 'BADGE_SUMMARY_FAILED' });
    }
  };

  public getOptions = (_req: Request, res: Response): void => {
    res.status(200).json({ categories: BADGE_CATEGORIES, eventsByCategory: BADGE_CATEGORY_EVENTS, events: BADGE_EVENTS });
  };

  public create = async (req: Request, res: Response): Promise<void> => {
    try {
      const badge = await this.badgeService.create(req.body as IBadgeInput);
      res.status(201).json({ badge });
    } catch (error) {
      this.respondError(error, res);
    }
  };

  public update = async (req: Request, res: Response): Promise<void> => {
    try {
      const badge = await this.badgeService.update(req.params.id as string, req.body as IBadgeInput);
      res.status(200).json({ badge });
    } catch (error) {
      this.respondError(error, res);
    }
  };

  public delete = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.badgeService.delete(req.params.id as string);
      res.status(204).send();
    } catch (error) {
      this.respondError(error, res);
    }
  };

  public getUserBadges = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.params.userId as string;
      const language = req.query.language === 'es' ? 'es' : 'en';
      res.status(200).json(await this.badgeService.getProfileBadges(userId, language));
    } catch (error) {
      console.error('Failed to load user badges:', error);
      res.status(500).json({ error: 'USER_BADGES_FAILED' });
    }
  };

  private respondError(error: unknown, res: Response): void {
    const code = error instanceof Error ? error.message : 'BADGE_OPERATION_FAILED';
    const validationErrors = new Set([
      'INVALID_BADGE_CATEGORY',
      'INVALID_BADGE_EVENT',
      'BADGE_EVENT_CATEGORY_MISMATCH',
      'INVALID_BADGE_TARGET',
      'INVALID_BADGE_ICON',
      'INVALID_BADGE_LOCALE',
      'BADGE_LOCALE_TOO_LONG',
      'INVALID_BADGE_CODE'
    ]);
    if (code === 'BADGE_NOT_FOUND') {
      res.status(404).json({ error: code });
    } else if (code === 'BADGE_CODE_ALREADY_EXISTS') {
      res.status(409).json({ error: code });
    } else if (validationErrors.has(code)) {
      res.status(400).json({ error: code });
    } else {
      console.error('Badge operation failed:', error);
      res.status(500).json({ error: 'BADGE_OPERATION_FAILED' });
    }
  }
}
