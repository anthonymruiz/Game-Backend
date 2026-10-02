import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { ReportService } from '../services/report.service.js';

@injectable()
export class ReportController {
  private reportService: ReportService;

  constructor() {
    this.reportService = container.resolve(ReportService);
  }

  public createReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const reporterId = req.user?.sub || req.user?.id;
      if (!reporterId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { reportedUserId, category, details } = req.body;
      const report = await this.reportService.createReport(reporterId, reportedUserId, category, details);

      res.status(201).json({ message: 'Report submitted successfully.', report, reportId: report.id });
    } catch (error: any) {
      console.error('[ReportController] createReport error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  public updateReportStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const report = await this.reportService.updateReportStatus(id as string, status);
      res.status(200).json({ message: 'Report status updated.', report });
    } catch (error: any) {
      const statusCode = error.message.includes('not found') ? 404 : 400;
      res.status(statusCode).json({ error: error.message });
    }
  };

  public getReports = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, category, page, limit } = req.query;
      const reports = await this.reportService.getReports(
        status as string,
        category as string,
        page ? parseInt(page as string, 10) : 1,
        limit ? parseInt(limit as string, 10) : 20
      );
      res.status(200).json(reports);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public getReportsByUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const reports = await this.reportService.getReportsByUser(userId as string);
      res.status(200).json({ reports });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public deleteReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await this.reportService.deleteReport(id as string);
      res.status(200).json({ message: 'Report deleted successfully.' });
    } catch (error: any) {
      const statusCode = error.message.includes('not found') ? 404 : 400;
      res.status(statusCode).json({ error: error.message });
    }
  };
}
