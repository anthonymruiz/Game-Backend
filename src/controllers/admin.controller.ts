import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { AdminService } from '../services/admin.service.js';

@injectable()
export class AdminController {
  private adminService: AdminService;

  constructor() {
    this.adminService = container.resolve(AdminService);
  }

  public getMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const metrics = await this.adminService.getMetrics();
      res.status(200).json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
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

  public getSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = this.adminService.getSystemSettings();
      res.status(200).json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  };

  public updateSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const updated = this.adminService.updateSystemSettings(req.body);
      res.status(200).json({ message: 'Settings updated successfully', settings: updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Internal server error' });
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
