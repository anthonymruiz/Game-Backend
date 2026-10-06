import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { AdminService } from '../services/admin.service.js';
import { ReportService } from '../services/report.service.js';
import { PointPackageService } from '../services/point-package.service.js';
import { RankTierService } from '../services/rank-tier.service.js';

@injectable()
export class AdminController {
  private adminService: AdminService;
  private reportService: ReportService;
  private pointPackageService: PointPackageService;
  private rankTierService: RankTierService;

  constructor() {
    this.adminService = container.resolve(AdminService);
    this.reportService = container.resolve(ReportService);
    this.pointPackageService = container.resolve(PointPackageService);
    this.rankTierService = container.resolve(RankTierService);
  }

  public getRankTiers = async (_req: Request, res: Response): Promise<void> => {
    try {
      const ranks = await this.rankTierService.getRanks();
      res.status(200).json({ ranks });
    } catch (error) {
      console.error('[AdminController] Failed to load rank tiers:', error);
      res.status(500).json({ message: 'Could not load rank tiers.' });
    }
  };

  public replaceRankTiers = async (req: Request, res: Response): Promise<void> => {
    try {
      const ranks = await this.rankTierService.replaceRanks(req.body?.ranks);
      res.status(200).json({ ranks });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update rank tiers.';
      const isValidationError = /^(Ranks must|Rank |Rank keys|Rank emojis|Rank ids)/.test(message);
      if (!isValidationError) console.error('[AdminController] Failed to update rank tiers:', error);
      res.status(isValidationError ? 400 : 500).json({ message });
    }
  };

  public getMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const metrics = await this.adminService.getMetrics();
      res.status(200).json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public getDashboardAnalytics = async (req: Request, res: Response): Promise<void> => {
    const allowedRanges = new Set(['today', '7d', 'month', 'year']);
    const allowedModes = new Set(['all', '1v1', '2v2', '4-FFA', '6-FFA', 'vs_ai', 'labyrinth']);
    if ((req.query.range !== undefined && typeof req.query.range !== 'string') ||
      (req.query.mode !== undefined && typeof req.query.mode !== 'string')) {
      res.status(400).json({ message: 'Dashboard filters must be single values.' });
      return;
    }
    const range = typeof req.query.range === 'string' ? req.query.range : '7d';
    const mode = typeof req.query.mode === 'string' ? req.query.mode : 'all';
    if (!allowedRanges.has(range)) {
      res.status(400).json({ message: 'Invalid dashboard range.' });
      return;
    }
    if (!allowedModes.has(mode)) {
      res.status(400).json({ message: 'Invalid dashboard match mode.' });
      return;
    }
    try {
      const analytics = await this.adminService.getDashboardAnalytics(range, mode);
      res.status(200).json(analytics);
    } catch (error) {
      console.error('[AdminController] Failed to load dashboard analytics:', error);
      res.status(500).json({ message: 'Could not load dashboard analytics.' });
    }
  };

  public getUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUserRole = req.user!.role;
      const roleFilter = req.query.role as string;
      const presenceFilter = req.query.presenceStatus as string;

      const paginationOptions = {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 10,
        search: req.query.search as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'ASC' | 'DESC',
      };

      const result = await this.adminService.getUsers(currentUserRole, roleFilter, presenceFilter, paginationOptions);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public getTransactions = async (_req: Request, res: Response): Promise<void> => {
    try {
      const transactions = await this.adminService.getTransactions();
      res.status(200).json({ transactions });
    } catch (error) {
      console.error('[AdminController] Failed to load transactions:', error);
      res.status(500).json({ message: 'Could not load transactions.' });
    }
  };

  public getReports = async (req: Request, res: Response): Promise<void> => {
    try {
      const statusFilter = req.query.status as string;
      const categoryFilter = req.query.category as string;

      const paginationOptions = {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 10,
        search: req.query.search as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'ASC' | 'DESC',
      };

      const result = await this.adminService.getReports(statusFilter, categoryFilter, paginationOptions);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public updateReportStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { status } = req.body;
      const report = await this.reportService.updateReportStatus(id, status);
      res.status(200).json({ message: 'Report status updated successfully', report });
    } catch (error: any) {
      const statusCode = error.message.includes('not found') ? 404 : 400;
      res.status(statusCode).json({ message: error.message });
    }
  };

  public deleteReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      await this.reportService.deleteReport(id);
      res.status(200).json({ message: 'Report deleted successfully' });
    } catch (error: any) {
      const statusCode = error.message.includes('not found') ? 404 : 400;
      res.status(statusCode).json({ message: error.message });
    }
  };

  public getMatches = async (req: Request, res: Response): Promise<void> => {
    try {
      const modeFilter = req.query.mode as string;

      const paginationOptions = {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 10,
        search: req.query.search as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'ASC' | 'DESC',
      };

      const result = await this.adminService.getMatches(modeFilter, paginationOptions);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public getMatchModeDistribution = async (_req: Request, res: Response): Promise<void> => {
    try {
      const modes = await this.adminService.getMatchModeDistribution();
      res.status(200).json({ modes });
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public getMatchSummary = async (_req: Request, res: Response): Promise<void> => {
    try {
      const summary = await this.adminService.getMatchSummary();
      res.status(200).json(summary);
    } catch (error: any) {
      console.error('[AdminController] Failed to load match summary:', error);
      res.status(500).json({ message: error.message || 'Could not load match summary.' });
    }
  };

  public getLevelProgressionConfig = async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = await this.adminService.getLevelProgressionConfig();
      res.status(200).json({ config });
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public updateLevelProgressionConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = await this.adminService.updateLevelProgressionConfig(req.body);
      res.status(200).json({ message: 'Level progression configuration updated successfully', config });
    } catch (error: any) {
      const message = error.message || 'Internal server error';
      const isValidationError = message.includes('must be');
      res.status(isValidationError ? 400 : 500).json({ message });
    }
  };

  public getRewardsSettings = async (_req: Request, res: Response): Promise<void> => {
    try {
      const config = await this.adminService.getRewardsSettings();
      res.status(200).json({ config });
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public updateRewardsSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const config = await this.adminService.updateRewardsSettings(req.body);
      res.status(200).json({ message: 'Rewards settings updated successfully', config });
    } catch (error: any) {
      const message = error.message || 'Internal server error';
      res.status(message.includes('must be') ? 400 : 500).json({ message });
    }
  };

  public getSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = await this.adminService.getSystemSettings();
      res.status(200).json({ settings });
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public updateSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const updated = await this.adminService.updateSystemSettings(req.body);
      res.status(200).json({ message: 'Settings updated successfully', settings: updated });
    } catch (error: any) {
      const msg = error.message || '';
      const isValidationError = msg.includes('must be') || msg.includes('between') || msg.includes('at least') || msg.includes('invalid');
      const status = isValidationError ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  };

  public getPointPackages = async (req: Request, res: Response): Promise<void> => {
    try {
      const packages = await this.pointPackageService.getPackages(true);
      res.status(200).json({ packages });
    } catch (error) {
      console.error('[AdminController] Failed to load point packages:', error);
      res.status(500).json({ message: 'Could not load point packages.' });
    }
  };

  public updatePointPackages = async (req: Request, res: Response): Promise<void> => {
    try {
      const packages = await this.pointPackageService.replacePackages(req.body?.packages);
      res.status(200).json({ packages });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update point packages.';
      const isValidationError = message.startsWith('Package ') || message.startsWith('packages must') || message === 'Package ids must be unique.';
      res.status(isValidationError ? 400 : 500).json({ message });
    }
  };

  public banUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      await this.adminService.banUser(id);
      res.status(200).json({ message: 'User banned successfully' });
    } catch (error: any) {
      const status = error.message.includes('not found') ? 404 : error.message.includes('Cannot ban') ? 403 : 400;
      res.status(status).json({ message: error.message });
    }
  };

  public unbanUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      await this.adminService.unbanUser(id);
      res.status(200).json({ message: 'User unbanned successfully' });
    } catch (error: any) {
      const status = error.message.includes('not found') ? 404 : 400;
      res.status(status).json({ message: error.message });
    }
  };

  public updateUserRole = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUserRole = req.user!.role;
      if (currentUserRole !== 'superadmin' && currentUserRole !== 'SUPERADMIN') {
        res.status(403).json({ message: 'Only superadmin can change user roles.' });
        return;
      }
      const targetUserId = req.params.id as string;
      const { role } = req.body;
      await this.adminService.updateUserRole(targetUserId, role);
      res.status(200).json({ message: 'User role updated successfully' });
    } catch (error: any) {
      const status = error.message.includes('not found') ? 404 : 400;
      res.status(status).json({ message: error.message });
    }
  };

  public createAdmin = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentUserId = req.user!.sub || req.user!.id;
      const currentUserRole = req.user!.role;
      const { id } = req.body;

      await this.adminService.promoteToAdmin(currentUserId, currentUserRole, id);
      res.status(200).json({ message: 'User promoted to admin' });
    } catch (error: any) {
      const status = error.message.includes('Only superadmin') ? 403 : error.message.includes('not found') ? 404 : 400;
      res.status(status).json({ message: error.message });
    }
  };

  public getActiveUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const activeUsers = await this.adminService.getActiveUsers();
      res.status(200).json(activeUsers);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public getUserReports = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.params.userId as string;
      const reports = await this.adminService.getUserReports(userId);
      res.status(200).json(reports);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };
}
