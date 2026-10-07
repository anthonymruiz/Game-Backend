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
import { ILevelProgressionConfig, LevelProgressionService } from './level-progression.service.js';
import { IRewardsSettings, RewardsSettingsService } from './rewards-settings.service.js';
import { AppDataSource } from '../config/database.config.js';
import { PointPackagePayment, PointPackagePaymentStatus } from '../models/point-package-payment.entity.js';
import { GameService } from './game.service.js';
import { MazeAuditService } from './maze-audit.service.js';
import { MazeMatchAuditState } from '../models/maze-match-audit-state.entity.js';
import { RankTierService } from './rank-tier.service.js';
import { AdminDashboardRepository } from '../repositories/admin-dashboard.repository.js';

interface MazeAdminPlayer {
  id: string;
  username: string;
  role: 'good' | 'impostor';
}

interface MazeAuditSnapshot {
  state?: string;
  winner?: string | null;
  startedAt?: number | null;
  capturedAt?: number;
  players?: MazeAdminPlayer[];
}

@injectable()
export class AdminService {
  private userRepository: UserRepository;
  private matchRepository: MatchHistoryRepository;
  private reportRepository: ReportRepository;
  private gameService: GameService;
  private mazeAuditService: MazeAuditService;
  private dashboardRepository: AdminDashboardRepository;

  constructor() {
    this.userRepository = container.resolve(UserRepository);
    this.matchRepository = container.resolve(MatchHistoryRepository);
    this.reportRepository = container.resolve(ReportRepository);
    this.gameService = container.resolve(GameService);
    this.mazeAuditService = container.resolve(MazeAuditService);
    this.dashboardRepository = container.resolve(AdminDashboardRepository);
  }

  public async getMetrics() {
    const totalUsers = await this.userRepository.countTotal();
    const totalMatches = await this.matchRepository.countTotal();
    const activeMatches = this.gameService.getActiveGameCountsByMode()
      .reduce((total, { count }) => total + count, 0);
    const [onlineUsers, playingUsers] = await Promise.all([
      this.userRepository.countOnline(),
      this.userRepository.countPlaying()
    ]);
    const pendingReports = await this.reportRepository.countPending();

    return {
      totalUsers,
      totalMatches,
      activeMatches,
      onlineUsers,
      playingUsers,
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

  public async getTransactions() {
    const payments = await AppDataSource.getRepository(PointPackagePayment).find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: 100
    });

    return payments.map(payment => ({
      id: payment.id,
      code: `TXN-${payment.id.slice(0, 8).toUpperCase()}`,
      user: {
        id: payment.user.id,
        username: payment.user.username,
        avatarUrl: payment.user.avatarUrl || null
      },
      itemName: payment.packageName,
      category: 'GEM_PACK',
      type: 'GEM_RECHARGE',
      pointsCount: payment.points,
      paymentMethod: 'STRIPE',
      status: this.getTransactionStatus(payment.status),
      createdAt: payment.createdAt
    }));
  }

  private getTransactionStatus(status: PointPackagePaymentStatus): string {
    switch (status) {
      case PointPackagePaymentStatus.PAID: return 'COMPLETED';
      case PointPackagePaymentStatus.PENDING: return 'PENDING';
      case PointPackagePaymentStatus.EXPIRED:
      case PointPackagePaymentStatus.FAILED:
        return 'FAILED';
      default:
        throw new Error(`Unsupported point package payment status: ${status}`);
    }
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
  ): Promise<IPaginatedResult<MatchHistory & { status?: string; mazePlayers?: MazeAdminPlayer[]; mazeWinnerUsername?: string }>> {
    const page = Math.max(1, Number(options?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options?.limit) || 10));
    if (modeFilter && modeFilter !== 'all' && modeFilter !== 'labyrinth') {
      return this.matchRepository.getPaginatedMatches(modeFilter, options);
    }

    const auditStates = await this.mazeAuditService.getLatestMatchStates();
    const matchingMazeMatches = auditStates
      .map(state => this.toMazeAdminMatch(state))
      .filter(match =>
        (!modeFilter || modeFilter === 'all' || modeFilter === 'labyrinth') &&
        (!options?.search || this.matchesSearch(match, options.search))
      );

    const start = (page - 1) * limit;
    const normalStart = modeFilter === 'labyrinth'
      ? 0
      : Math.max(0, start - matchingMazeMatches.length);
    const normalWindow = modeFilter === 'labyrinth'
      ? undefined
      : await this.matchRepository.getMatchesWindow(
        'all',
        options,
        normalStart,
        start + limit - normalStart
      );
    const normalMatches = normalWindow?.data ?? [];
    const combined = [...normalMatches, ...matchingMazeMatches]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    const totalItems = modeFilter === 'labyrinth'
      ? matchingMazeMatches.length
      : (normalWindow?.totalItems ?? 0) + matchingMazeMatches.length;
    const data = combined.slice(start - normalStart, start - normalStart + limit);

    return {
      data,
      meta: {
        totalItems,
        itemCount: data.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page
      }
    };
  }

  public async getMatchModeDistribution(): Promise<{ mode: string; count: number }[]> {
    const [distribution, mazeMatchCount] = await Promise.all([
      this.matchRepository.getModeDistribution(),
      this.mazeAuditService.countFinishedMatches()
    ]);
    return [...distribution, ...(mazeMatchCount ? [{ mode: 'labyrinth', count: mazeMatchCount }] : [])];
  }

  public async getDashboardAnalytics(range: string, mode: string): Promise<{
    totalMatches: number;
    userGrowth: { label: string; count: number }[];
    topRedeemedItems: { id: string; icon: string; name: { es: string; en: string }; count: number }[];
    usersByRank: { key: string; name: { es: string; en: string }; emoji: string; count: number }[];
    matchesByMode: { mode: string; count: number }[];
  }> {
    const rangeFilter = range as 'today' | '7d' | 'month' | 'year';
    const [matchesByMode, userGrowth, topRedeemedItems, usersByRank] = await Promise.all([
      this.getMatchModeDistribution(),
      this.getUserGrowth(rangeFilter),
      this.dashboardRepository.getTopRedeemedItems(),
      this.getUsersByRank()
    ]);

    const selectedModes = mode === 'all'
      ? matchesByMode
      : matchesByMode.filter(item => this.normalizeDashboardMode(item.mode) === this.normalizeDashboardMode(mode));

    return {
      totalMatches: selectedModes.reduce((total, item) => total + item.count, 0),
      userGrowth,
      topRedeemedItems: topRedeemedItems.map(item => ({
        id: item.id,
        icon: item.icon,
        name: {
          es: item.configuration.es.name,
          en: item.configuration.en.name
        },
        count: item.count
      })),
      usersByRank,
      matchesByMode
    };
  }

  private async getUserGrowth(range: 'today' | '7d' | 'month' | 'year'): Promise<{ label: string; count: number }[]> {
    const now = new Date();
    const start = new Date(now);
    if (range === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (range === 'month') {
      const dayOfMonth = start.getDate();
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      start.setDate(Math.min(dayOfMonth, lastDayOfMonth));
      start.setHours(0, 0, 0, 0);
    } else if (range === 'year') {
      start.setDate(1);
      start.setMonth(start.getMonth() - 11);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    }

    const isToday = range === 'today';
    const isYear = range === 'year';
    const rows = await this.dashboardRepository.getUserGrowth(range, start, now);
    const counts = new Map(rows.map(row => [row.bucket, row.count]));
    if (isToday) {
      return Array.from({ length: now.getHours() + 1 }, (_, hour) => ({
        label: `${String(hour).padStart(2, '0')}:00`,
        count: counts.get(String(hour)) ?? 0
      }));
    }
    if (isYear) {
      return Array.from({ length: 12 }, (_, index) => {
        const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return { label: key, count: counts.get(key) ?? 0 };
      });
    }

    const dailyPoints: { label: string; count: number }[] = [];
    for (const date = new Date(start); date <= now; date.setDate(date.getDate() + 1)) {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      dailyPoints.push({ label: key, count: counts.get(key) ?? 0 });
    }
    return dailyPoints;
  }

  private async getUsersByRank(): Promise<{ key: string; name: { es: string; en: string }; emoji: string; count: number }[]> {
    const ranks = await container.resolve(RankTierService).getRanks();
    const rows = await this.dashboardRepository.getUsersByRank(ranks);
    const counts = new Map(rows.map(row => [row.key, row.count]));
    return ranks.map(rank => ({
      key: rank.key,
      name: {
        es: rank.configuration.es.name,
        en: rank.configuration.en.name
      },
      emoji: rank.emoji,
      count: counts.get(rank.key) ?? 0
    }));
  }

  private normalizeDashboardMode(mode: string): string {
    const normalized = mode.toLowerCase();
    if (normalized === '4way') return '4-ffa';
    if (normalized === '6way') return '6-ffa';
    return normalized;
  }

  public async getMatchSummary(): Promise<{
    totalMatches: number;
    activeMatches: number;
    matchesByMode: { mode: string; count: number }[];
    archivedMatchesByMode: { mode: string; count: number }[];
  }> {
    const [storedMatchCount, storedMatchesByMode, finishedMazeMatchCount] = await Promise.all([
      this.matchRepository.getTotalDistinctMatchCount(),
      this.matchRepository.getModeDistribution(),
      this.mazeAuditService.countFinishedMatches()
    ]);
    const archivedMatchesByMode = [
      ...storedMatchesByMode,
      ...(finishedMazeMatchCount ? [{ mode: 'labyrinth', count: finishedMazeMatchCount }] : [])
    ];
    const activeMatchesByMode = this.gameService.getActiveGameCountsByMode();
    const matchesByModeCounts = new Map(archivedMatchesByMode.map(({ mode, count }) => [mode, count]));
    for (const { mode, count } of activeMatchesByMode) {
      matchesByModeCounts.set(mode, (matchesByModeCounts.get(mode) ?? 0) + count);
    }
    const activeMatches = activeMatchesByMode.reduce((total, { count }) => total + count, 0);

    return {
      totalMatches: storedMatchCount + finishedMazeMatchCount + activeMatches,
      activeMatches,
      matchesByMode: [...matchesByModeCounts].map(([mode, count]) => ({ mode, count })),
      archivedMatchesByMode
    };
  }

  private async getFinishedMazeMatches(): Promise<(MatchHistory & { status?: string; mazePlayers?: MazeAdminPlayer[]; mazeWinnerUsername?: string })[]> {
    const states = await this.mazeAuditService.getLatestMatchStates();
    return states
      .map(state => this.toMazeAdminMatch(state))
      .filter(match => match.status === 'finished');
  }

  private toMazeAdminMatch(state: MazeMatchAuditState): MatchHistory & {
    status?: string;
    mazePlayers?: MazeAdminPlayer[];
    mazeWinnerUsername?: string;
  } {
    const snapshot = state.snapshot as MazeAuditSnapshot;
    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const host = players[0];
    const winner = players.find(player => player.id === snapshot.winner);
    const createdAt = new Date(Number(snapshot.startedAt) || Number(snapshot.capturedAt) || state.createdAt.getTime());
    return Object.assign(new MatchHistory(), {
      id: state.id,
      matchId: state.matchId,
      mode: 'labyrinth',
      result: snapshot.state === 'playing' ? 'active' : (snapshot.winner === host?.id ? 'win' : 'loss'),
      status: snapshot.state === 'playing' ? 'playing' : 'finished',
      userId: host?.id ?? '',
      user: host ? { id: host.id, username: host.username, avatarUrl: null } : undefined,
      opponentUsername: players.slice(1).map(player => player.username).join(', '),
      durationSeconds: snapshot.startedAt
        ? Math.max(0, Math.round(((Number(snapshot.capturedAt) || createdAt.getTime()) - Number(snapshot.startedAt)) / 1000))
        : undefined,
      createdAt,
      mazePlayers: players,
      mazeWinnerUsername: winner?.username
    });
  }

  private matchesSearch(match: MatchHistory, search: string): boolean {
    const term = search.trim().toLowerCase();
    return !term || [match.matchId, match.user?.username, match.opponentUsername]
      .some(value => value?.toLowerCase().includes(term));
  }

  public async getLevelProgressionConfig(): Promise<ILevelProgressionConfig> {
    return container.resolve(LevelProgressionService).getConfiguration();
  }

  public async updateLevelProgressionConfig(
    config: Partial<ILevelProgressionConfig>
  ): Promise<ILevelProgressionConfig> {
    return container.resolve(LevelProgressionService).updateConfiguration(config);
  }

  public async getRewardsSettings(): Promise<IRewardsSettings> {
    return container.resolve(RewardsSettingsService).getConfiguration();
  }

  public async updateRewardsSettings(config: Partial<IRewardsSettings>): Promise<IRewardsSettings> {
    return container.resolve(RewardsSettingsService).updateConfiguration(config);
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

    if (targetUser.role === UserRole.SUPERADMIN || targetUser.role === UserRole.ADMIN || targetUser.role === ('superadmin' as any)) {
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
    if (newRole !== UserRole.USER && newRole !== UserRole.ADMIN) {
      throw new Error('Only user and admin roles can be assigned.');
    }

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
        const isPromoted = newRole === UserRole.ADMIN;
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
