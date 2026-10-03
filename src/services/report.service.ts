import { container, injectable } from 'tsyringe';
import { ReportRepository } from '../repositories/report.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { Report } from '../models/report.entity.js';
import { ReportCategory } from '../models/report-category.enum.js';
import { ReportStatus } from '../models/report-status.enum.js';
import { NotificationService } from './notification.service.js';

@injectable()
export class ReportService {
  private reportRepository: ReportRepository;
  private userRepository: UserRepository;

  constructor() {
    this.reportRepository = container.resolve(ReportRepository);
    this.userRepository = container.resolve(UserRepository);
  }

  public async createReport(
    reporterId: string,
    reportedUserId: string,
    category: ReportCategory,
    details: string,
    matchId?: string,
    language: string = 'es'
  ): Promise<Report> {
    if (reporterId === reportedUserId) {
      throw new Error('You cannot report yourself.');
    }

    const validCategories: ReportCategory[] = [
      ReportCategory.CHEATING,
      ReportCategory.HARASSMENT,
      ReportCategory.INAPPROPRIATE_NAME,
      ReportCategory.OTHER
    ];
    if (!validCategories.includes(category)) {
      throw new Error('Invalid report category.');
    }

    if (!details || typeof details !== 'string' || details.trim().length === 0) {
      throw new Error('Report details/comment is required.');
    }

    const reportedUser = await this.userRepository.findById(reportedUserId);
    if (!reportedUser) {
      throw new Error('Reported user does not exist.');
    }

    return this.reportRepository.createAndSave(reporterId, reportedUserId, category, details.trim(), matchId, language);
  }

  public async updateReportStatus(reportId: string, status: ReportStatus): Promise<Report> {
    const validStatuses: ReportStatus[] = [
      ReportStatus.PENDING,
      ReportStatus.REVIEWED,
      ReportStatus.DISMISSED
    ];
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid report status.');
    }

    const report = await this.reportRepository.findById(reportId);
    if (!report) {
      throw new Error('Report not found.');
    }

    const previousStatus = report.status;
    report.status = status;
    const updatedReport = await this.reportRepository.save(report);

    // If status changed to REVIEWED (Valid report), notify reporter & reported user
    if (status === ReportStatus.REVIEWED && previousStatus !== ReportStatus.REVIEWED) {
      try {
        const notificationService = container.resolve(NotificationService);

        // 1. Notify reporter that their report is in review / action taken
        if (report.reporterId) {
          await notificationService.sendNotification(
            report.reporterId,
            'REPORT_UPDATE',
            'REPORT_REPORTER_TITLE',
            'REPORT_REPORTER_MSG'
          );
        }

        // 2. Notify reported user that they received a report / strike and current strike total
        if (report.reportedUserId) {
          const totalStrikes = await this.reportRepository.countValidForUser(report.reportedUserId);
          await notificationService.sendNotification(
            report.reportedUserId,
            'REPORT_WARNING',
            'REPORTED_USER_TITLE',
            'REPORTED_USER_MSG',
            `${totalStrikes}`
          );
        }
      } catch (err) {
        console.error('Error sending report notification:', err);
      }
    }

    return updatedReport;
  }

  public async getReports(statusFilter?: string, categoryFilter?: string, page: number = 1, limit: number = 20) {
    return this.reportRepository.getPaginatedReports(statusFilter, categoryFilter, { page, limit });
  }

  public async getReportsByUser(userId: string): Promise<Report[]> {
    return this.reportRepository.findByReportedUserId(userId);
  }

  public async deleteReport(reportId: string): Promise<void> {
    const report = await this.reportRepository.findById(reportId);
    if (!report) {
      throw new Error('Report not found.');
    }
    await this.reportRepository.delete(report);
  }
}
