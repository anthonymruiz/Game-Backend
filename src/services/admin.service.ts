import { injectable, container } from 'tsyringe';
import { UserRepository } from '../repositories/user.repository.js';
import { MatchHistoryRepository } from '../repositories/match-history.repository.js';
import { ReportRepository } from '../repositories/report.repository.js';
import { SystemSettingsService, ISystemSettings } from './system-settings.service.js';
import { User } from '../models/user.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Report } from '../models/report.entity.js';
import { IPaginatedResult, IPaginationOptions } from '../utils/pagination.util.js';

import { UserRole } from '../models/user-role.enum.js';
import { SocketManager } from '../socket/socket.manager.js';
import { NotificationService } from './notification.service.js';

@injectable()
export class AdminService {
  private userRepository: UserRepository;
  private matchRepository: MatchHistoryRepository;
  private reportRepository: ReportRepository;

  constructor() {
    this.userRepository = container.resolve(UserRepository);
    this.matchRepository = container.resolve(MatchHistoryRepository);
    this.reportRepository = container.resolve(ReportRepository);
  }

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

  public async getSystemSettings(): Promise<ISystemSettings> {
    const service = container.resolve(SystemSettingsService);
    return service.getSettings();
  }

  public async updateSystemSettings(newSettings: Partial<ISystemSettings>): Promise<ISystemSettings> {
    const service = container.resolve(SystemSettingsService);
    return service.updateSettings(newSettings);
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
    if (currentUserRole !== UserRole.SUPERADMIN && currentUserRole !== 'superadmin') {
      throw new Error('Only superadmin can promote users to admin.');
    }
    return this.updateUserRole(targetUserId, UserRole.ADMIN);
  }

  public async getActiveUsers(): Promise<User[]> {
    return this.userRepository.findActiveUsers();
  }

  public async updateUserRole(targetUserId: string, newRole: UserRole): Promise<User> {
    const targetUser = await this.userRepository.findById(targetUserId);
    if (!targetUser) {
      throw new Error('User not found.');
    }
    const oldRole = targetUser.role;
    targetUser.role = newRole;
    const savedUser = await this.userRepository.save(targetUser);

    if (oldRole !== newRole) {
      try {
        const socketManager = container.resolve(SocketManager);
        if (socketManager.io) {
          socketManager.io.of('/matchmaking').to(targetUserId).emit('userRoleUpdated', {
            userId: targetUserId,
            newRole: newRole,
            oldRole: oldRole
          });
        }
      } catch (err) {
        console.error('Error emitting userRoleUpdated socket event:', err);
      }

      try {
        const notifService = container.resolve(NotificationService);
        const isPromoted = (newRole === UserRole.ADMIN || newRole === UserRole.SUPERADMIN);
        const titleEn = isPromoted ? 'Role Promoted' : 'Role Updated';
        const titleEs = isPromoted ? 'Rol Promovido' : 'Rol Actualizado';
        const msgEn = isPromoted 
          ? 'Congratulations! You have been granted Administrator permissions.' 
          : 'Your Administrator role has been removed.';
        const msgEs = isPromoted 
          ? '¡Felicidades! Ahora tienes permisos de Administrador.' 
          : 'Tu rol de Administrador ha sido removido.';

        // Create notification
        const userRepo = this.userRepository;
        const u = await userRepo.findById(targetUserId);
        if (u) {
          const lang = u.preferences?.language || 'es';
          const notifTitle = lang === 'en' ? titleEn : titleEs;
          const notifMsg = lang === 'en' ? msgEn : msgEs;
          
          const repo = (await import('../config/database.config.js')).AppDataSource.getRepository((await import('../models/notification.entity.js')).Notification);
          const notif = new ((await import('../models/notification.entity.js')).Notification)();
          notif.user = u;
          notif.type = 'ROLE_UPDATED';
          notif.title = notifTitle;
          notif.message = notifMsg;
          const savedNotif = await repo.save(notif);

          const socketManager = container.resolve(SocketManager);
          if (socketManager.io) {
            socketManager.io.of('/matchmaking').to(targetUserId).emit('newNotification', savedNotif);
          }
        }
      } catch (err) {
        console.error('Error sending role update notification:', err);
      }
    }

    return savedUser;
  }

  public async getUserReports(targetUserId: string) {
    return this.reportRepository.findByReportedUserId(targetUserId);
  }
}
