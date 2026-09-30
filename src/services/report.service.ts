import { injectable } from 'tsyringe';
import { ReportRepository } from '../repositories/report.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { Report } from '../models/report.entity.js';
import { ReportCategory } from '../models/report-category.enum.js';
import { ReportStatus } from '../models/report-status.enum.js';

@injectable()
export class ReportService {
  constructor(
    private reportRepository: ReportRepository,
    private userRepository: UserRepository
  ) {}

  public async createReport(
    reporterId: string,
    reportedUserId: string,
    category: ReportCategory,
    details: string
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

    return this.reportRepository.createAndSave(reporterId, reportedUserId, category, details.trim());
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

    report.status = status;
    return this.reportRepository.save(report);
  }
}
