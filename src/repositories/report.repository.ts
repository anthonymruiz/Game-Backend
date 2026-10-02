import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Report, ReportCategory, ReportStatus } from '../models/report.entity.js';
import { AppDataSource } from '../config/database.config.js';
import { paginateQueryBuilder, IPaginationOptions, IPaginatedResult } from '../utils/pagination.util.js';

@injectable()
export class ReportRepository {
  private get ormRepository(): Repository<Report> {
    return AppDataSource.getRepository(Report);
  }

  public async createAndSave(reporterId: string, reportedUserId: string, category: ReportCategory, details: string): Promise<Report> {
    const report = new Report();
    report.reporterId = reporterId;
    report.reportedUserId = reportedUserId;
    report.category = category;
    report.details = details;
    report.status = ReportStatus.PENDING;
    return this.ormRepository.save(report);
  }

  public async findById(id: string): Promise<Report | null> {
    return this.ormRepository.findOne({ where: { id } });
  }

  public async findByReportedUserId(reportedUserId: string): Promise<Report[]> {
    return this.ormRepository.find({
      where: { reportedUserId },
      relations: { reporter: true },
      select: {
        id: true,
        category: true,
        details: true,
        status: true,
        createdAt: true,
        reporter: {
          id: true,
          username: true
        }
      },
      order: { createdAt: 'DESC' }
    });
  }

  public async getPaginatedReports(
    statusFilter?: string,
    categoryFilter?: string,
    options?: IPaginationOptions
  ): Promise<IPaginatedResult<Report>> {
    const queryBuilder = this.ormRepository.createQueryBuilder('report')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('report.reportedUser', 'reportedUser')
      .select([
        'report.id',
        'report.category',
        'report.details',
        'report.status',
        'report.createdAt',
        'reporter.id',
        'reporter.username',
        'reportedUser.id',
        'reportedUser.username',
        'reportedUser.role'
      ]);

    if (statusFilter && statusFilter !== 'all') {
      queryBuilder.andWhere('report.status = :status', { status: statusFilter });
    }

    if (categoryFilter && categoryFilter !== 'all') {
      queryBuilder.andWhere('report.category = :category', { category: categoryFilter });
    }

    return paginateQueryBuilder(queryBuilder, {
      page: options?.page || 1,
      limit: options?.limit || 10,
      search: options?.search,
      searchFields: ['reporter.username', 'reportedUser.username', 'report.details'],
      sortBy: options?.sortBy ? `report.${options.sortBy}` : 'report.createdAt',
      sortOrder: options?.sortOrder || 'DESC'
    });
  }

  public async countPending(): Promise<number> {
    return this.ormRepository.count({ where: { status: ReportStatus.PENDING } });
  }

  public async save(report: Report): Promise<Report> {
    return this.ormRepository.save(report);
  }

  public async delete(report: Report): Promise<void> {
    await this.ormRepository.remove(report);
  }
}
