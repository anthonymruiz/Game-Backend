import { singleton, container } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { Friendship } from '../models/friendship.entity.js';
import { FriendshipStatus } from '../models/friendship-status.enum.js';
import { User } from '../models/user.entity.js';
import { PresenceStatus } from '../models/presence.enum.js';
import { Notification } from '../models/notification.entity.js';
import { SocketManager } from '../socket/socket.manager.js';
import { NotificationService } from './notification.service.js';
import { getLevelProgress, LevelProgressionService } from './level-progression.service.js';
import { BadgeService } from './badge.service.js';

@singleton()
export class FriendService {
  private get repo() {
    return AppDataSource.getRepository(Friendship);
  }

  private get userRepo() {
    return AppDataSource.getRepository(User);
  }

  public async sendRequest(requesterId: string, addresseeId: string): Promise<Friendship> {
    if (requesterId === addresseeId) {
      throw new Error('No puedes enviarte una solicitud a ti mismo');
    }

    const addressee = await this.userRepo.findOne({ where: { id: addresseeId } });
    if (!addressee) {
      throw new Error('Usuario destinatario no encontrado');
    }

    const requester = await this.userRepo.findOne({ where: { id: requesterId } });
    if (!requester) {
      throw new Error('Usuario solicitante no encontrado');
    }

    const existing = await this.repo.findOne({
      where: [
        { requester: { id: requesterId }, addressee: { id: addresseeId } },
        { requester: { id: addresseeId }, addressee: { id: requesterId } }
      ],
      relations: { requester: true, addressee: true }
    });

    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        throw new Error('Ya son amigos');
      }
      if (existing.status === FriendshipStatus.PENDING) {
        throw new Error('Ya hay una solicitud de amistad pendiente');
      }
      existing.requester = requester;
      existing.addressee = addressee;
      existing.status = FriendshipStatus.PENDING;
      await this.repo.save(existing);
      await this.notifyRequest(requester, addressee, existing.id);
      return existing;
    }

    const friendship = new Friendship();
    friendship.requester = requester;
    friendship.addressee = addressee;
    friendship.status = FriendshipStatus.PENDING;

    await this.repo.save(friendship);
    await this.notifyRequest(requester, addressee, friendship.id);
    return friendship;
  }

  private async notifyRequest(requester: User, addressee: User, friendshipId: string) {
    try {
      const notifService = container.resolve(NotificationService);
      await notifService.sendNotification(
        addressee.id,
        'FRIEND_REQUEST',
        'FRIEND_REQ_TITLE',
        'FRIEND_REQ_MSG',
        requester.username
      );

      const socketManager = container.resolve(SocketManager);
      if (socketManager.io) {
        socketManager.io.of('/matchmaking').to(addressee.id).emit('friend:request_received', {
          id: friendshipId,
          type: 'FRIEND_REQUEST',
          requester: {
            id: requester.id,
            username: requester.username,
            avatarUrl: requester.avatarUrl
          },
          createdAt: new Date()
        });
      }
    } catch (err) {
      console.error('Error sending friend request notification:', err);
    }
  }

  public async acceptRequest(userId: string, friendshipId: string): Promise<Friendship> {
    const friendship = await this.repo.findOne({
      where: { id: friendshipId, addressee: { id: userId }, status: FriendshipStatus.PENDING },
      relations: { requester: true, addressee: true }
    });

    if (!friendship) {
      throw new Error('Solicitud de amistad no encontrada o ya procesada');
    }

    friendship.status = FriendshipStatus.ACCEPTED;
    await this.repo.save(friendship);

    try {
      const badgeService = container.resolve(BadgeService);
      await Promise.all([
        badgeService.recordEvent(friendship.requester.id, 'friend_added'),
        badgeService.recordEvent(friendship.addressee.id, 'friend_added')
      ]);
    } catch (error) {
      console.error(`Failed to record friend badges for friendship ${friendship.id}:`, error);
    }

    try {
      const notifService = container.resolve(NotificationService);
      await notifService.sendNotification(
        friendship.requester.id,
        'FRIEND_ACCEPTED',
        'FRIEND_ACC_TITLE',
        'FRIEND_ACC_MSG',
        friendship.addressee.username
      );

      const socketManager = container.resolve(SocketManager);
      if (socketManager.io) {
        socketManager.io.of('/matchmaking').to(friendship.requester.id).emit('friend:request_accepted', {
          friendshipId: friendship.id,
          friend: {
            id: friendship.addressee.id,
            username: friendship.addressee.username,
            avatarUrl: friendship.addressee.avatarUrl
          }
        });
      }
    } catch (e) {
      console.error('Error sending friend request accept notification:', e);
    }

    return friendship;
  }

  public async rejectRequest(userId: string, friendshipId: string): Promise<void> {
    const friendship = await this.repo.findOne({
      where: { id: friendshipId },
      relations: { requester: true, addressee: true }
    });

    if (!friendship) return;
    if (friendship.addressee.id !== userId && friendship.requester.id !== userId) {
      throw new Error('No tienes permiso para esta acción');
    }

    const otherUser = friendship.requester.id === userId ? friendship.addressee : friendship.requester;
    const cancellingUser = friendship.requester.id === userId ? friendship.requester : friendship.addressee;

    await this.repo.remove(friendship);

    try {
      const notifService = container.resolve(NotificationService);
      await notifService.sendNotification(
        otherUser.id,
        'FRIEND_REJECTED',
        'FRIEND_REJ_TITLE',
        'FRIEND_REJ_MSG',
        cancellingUser.username
      );

      const socketManager = container.resolve(SocketManager);
      if (socketManager.io) {
        socketManager.io.of('/matchmaking').to(otherUser.id).emit('friend:request_cancelled', {
          friendshipId: friendshipId,
          cancelledByUserId: userId
        });
        socketManager.io.of('/matchmaking').to(userId).emit('friend:request_cancelled', {
          friendshipId: friendshipId,
          cancelledByUserId: userId
        });
      }
    } catch (e) {
      console.error('Error emitting friend:request_cancelled socket/notification:', e);
    }
  }

  public async removeFriend(userId: string, friendId: string): Promise<void> {
    const friendship = await this.repo.findOne({
      where: [
        { requester: { id: userId }, addressee: { id: friendId }, status: FriendshipStatus.ACCEPTED },
        { requester: { id: friendId }, addressee: { id: userId }, status: FriendshipStatus.ACCEPTED }
      ]
    });

    if (friendship) {
      await this.repo.remove(friendship);
      try {
        const socketManager = container.resolve(SocketManager);
        if (socketManager.io) {
          socketManager.io.of('/matchmaking').to(friendId).emit('friend:removed', {
            removedByUserId: userId
          });
        }
      } catch (e) {}
    }
  }

  public async getFriends(userId: string) {
    const progressionConfig = await container.resolve(LevelProgressionService).getConfiguration();
    const friendships = await this.repo.find({
      where: [
        { requester: { id: userId }, status: FriendshipStatus.ACCEPTED },
        { addressee: { id: userId }, status: FriendshipStatus.ACCEPTED }
      ],
      relations: {
        requester: { stats: true },
        addressee: { stats: true }
      }
    });

    let gameService: any = null;
    try {
      const { GameService } = await import('./game.service.js');
      gameService = container.resolve(GameService);
    } catch (e) {}

    return friendships.map(f => {
      const friend = f.requester.id === userId ? f.addressee : f.requester;
      const wins = friend.stats?.wins || 0;
      const totalGames = friend.stats?.totalGames || 0;
      const losses = friend.stats?.losses || Math.max(0, totalGames - wins);
      const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
      const points = friend.stats?.points || 0;
      const xp = friend.stats?.xp || 0;
      const level = getLevelProgress(xp, progressionConfig).level;

      const activeGame = gameService ? gameService.getGameByPlayerId(friend.id) : null;
      const isCurrentlyPlaying = !!activeGame && activeGame.state === 'playing';

      return {
        friendshipId: f.id,
        id: friend.id,
        username: friend.username,
        avatarUrl: friend.avatarUrl,
        isOnline: friend.isOnline,
        presenceStatus: isCurrentlyPlaying ? PresenceStatus.PLAYING : (friend.presenceStatus === PresenceStatus.PLAYING ? PresenceStatus.ONLINE : friend.presenceStatus),
        activeMatchId: isCurrentlyPlaying ? activeGame.id : null,
        lastSeen: friend.lastSeen,
        stats: {
          totalGames,
          wins,
          losses,
          winRate,
          points,
          xp,
          level
        }
      };
    });
  }

  public async getRequests(userId: string) {
    const received = await this.repo.find({
      where: { addressee: { id: userId }, status: FriendshipStatus.PENDING },
      relations: { requester: { stats: true } }
    });

    const sent = await this.repo.find({
      where: { requester: { id: userId }, status: FriendshipStatus.PENDING },
      relations: { addressee: { stats: true } }
    });

    return {
      received: received.map(f => ({
        friendshipId: f.id,
        user: {
          id: f.requester.id,
          username: f.requester.username,
          avatarUrl: f.requester.avatarUrl,
          wins: f.requester.stats?.wins || 0
        },
        createdAt: f.createdAt
      })),
      sent: sent.map(f => ({
        friendshipId: f.id,
        user: {
          id: f.addressee.id,
          username: f.addressee.username,
          avatarUrl: f.addressee.avatarUrl,
          wins: f.addressee.stats?.wins || 0
        },
        createdAt: f.createdAt
      }))
    };
  }

  public async getFriendshipStatus(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      return { status: 'SELF' };
    }

    const friendship = await this.repo.findOne({
      where: [
        { requester: { id: userId }, addressee: { id: targetUserId } },
        { requester: { id: targetUserId }, addressee: { id: userId } }
      ],
      relations: { requester: true, addressee: true }
    });

    if (!friendship) {
      return { status: 'NONE' };
    }

    if (friendship.status === FriendshipStatus.ACCEPTED) {
      return { status: 'ACCEPTED', friendshipId: friendship.id };
    }

    if (friendship.status === FriendshipStatus.PENDING) {
      if (friendship.requester.id === userId) {
        return { status: 'PENDING_SENT', friendshipId: friendship.id };
      } else {
        return { status: 'PENDING_RECEIVED', friendshipId: friendship.id };
      }
    }

    return { status: 'NONE' };
  }

  public async getPendingCount(userId: string): Promise<number> {
    return this.repo.count({
      where: { addressee: { id: userId }, status: FriendshipStatus.PENDING }
    });
  }

  public async searchUsers(userId: string, query: string) {
    if (!query || !query.trim()) return [];
    const cleanQuery = query.trim();

    const users = await this.userRepo.createQueryBuilder('user')
      .leftJoinAndSelect('user.stats', 'stats')
      .where('LOWER(user.username) LIKE :query', { query: `%${cleanQuery.toLowerCase()}%` })
      .andWhere('user.id != :userId', { userId })
      .take(50)
      .getMany();

    const results = await Promise.all(
      users.map(async (u) => {
        const friendship = await this.getFriendshipStatus(userId, u.id);
        return {
          id: u.id,
          username: u.username,
          avatarUrl: u.avatarUrl,
          isOnline: u.isOnline,
          wins: u.stats?.wins || 0,
          xp: u.stats?.xp || 0,
          totalGames: u.stats?.totalGames || 0,
          status: friendship.status,
          friendshipId: friendship.friendshipId
        };
      })
    );

    return results;
  }
}
