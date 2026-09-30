import { injectable } from 'tsyringe';
import { UserRepository } from '../repositories/user.repository.js';
import { MatchHistoryRepository } from '../repositories/match-history.repository.js';
import { ReportRepository } from '../repositories/report.repository.js';
import { SystemSettingsService, ISystemSettings } from './system-settings.service.js';
import { User } from '../models/user.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Report } from '../models/report.entity.js';
import { IPaginatedResult, IPaginationOptions } from '../utils/pagination.util.js';

import { UserRole } from '../models/user-role.enum.js';

@injectable()
export class AdminService {
  constructor(
    private userRepository: UserRepository,
    private matchRepository: MatchHistoryRepository,
    private reportRepository: ReportRepository,
    private systemSettingsService: SystemSettingsService
  ) {}

  public async getMetrics() {
    const totalUsers = await this.userRepository.countTotal();
    const totalMatches = await this.matchRepository.countTotal();
    const onlineUsers = await this.userRepository.countOnline();
    const pendingReports = await this.reportRepository.countPending();

    return {
      totalUsers,
      totalMatches,
      onlineUsers,
      pendingReports
    };
  }

  public async getUsers(
    currentUserRole: string,
    filterRole?: string,
    filterPresence?: string,
    options?: IPaginationOptions
  ): Promise<IPaginatedResult<User>> {
    return this.userRepository.getPaginatedUsers(currentUserRole, filterRole, filterPresence, options);
  }

  public async getReports(
    statusFilter?: string,
    categoryFilter?: string,
    options?: IPaginationOptions
  ): Promise<IPaginatedResult<Report>> {
    return this.reportRepository.getPaginatedReports(statusFilter, categoryFilter, options);
  }

  public async getMatches(
    modeFilter?: string,
    options?: IPaginationOptions
  ): Promise<IPaginatedResult<MatchHistory>> {
    return this.matchRepository.getPaginatedMatches(modeFilter, options);
  }

  public getSystemSettings(): ISystemSettings {
    return this.systemSettingsService.getSettings();
  }

  public updateSystemSettings(newSettings: Partial<ISystemSettings>): ISystemSettings {
    return this.systemSettingsService.updateSettings(newSettings);
  }

  public async banUser(targetUserId: string): Promise<User> {
    const targetUser = await this.userRepository.findById(targetUserId);
    if (!targetUser) {
      throw new Error('User not found.');
    }

    if (targetUser.role === UserRole.SUPERADMIN || targetUser.role === UserRole.ADMIN) {
      throw new Error('Cannot ban admins or superadmins.');
    }

    targetUser.role = UserRole.BANNED;
    return this.userRepository.save(targetUser);
  }

  public async unbanUser(targetUserId: string): Promise<User> {
    const targetUser = await this.userRepository.findById(targetUserId);
    if (!targetUser) {
      throw new Error('User not found.');
    }

    if (targetUser.role === UserRole.BANNED) {
      targetUser.role = UserRole.USER;
      return this.userRepository.save(targetUser);
    }

    return targetUser;
  }

  public async promoteToAdmin(currentUserId: string, currentUserRole: string, targetUserId: string): Promise<User> {
    if (currentUserRole !== UserRole.SUPERADMIN) {
      throw new Error('Only superadmin can promote users to admin.');
    }

    const targetUser = await this.userRepository.findById(targetUserId);
    if (!targetUser) {
      throw new Error('User not found.');
    }

    targetUser.role = UserRole.ADMIN;
    return this.userRepository.save(targetUser);
  }

  public async getActiveUsers(): Promise<User[]> {
    return this.userRepository.findActiveUsers();
  }

  public async getUserReports(targetUserId: string) {
    return this.reportRepository.findByReportedUserId(targetUserId);
  }
}
