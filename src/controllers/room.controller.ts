import { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { RoomService } from '../services/room.service.js';
import { GameMode } from '../services/matchmaking.service.js';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { RankTierService } from '../services/rank-tier.service.js';

@injectable()
export class RoomController {
  private roomService: RoomService;

  constructor() {
    this.roomService = container.resolve(RoomService);
  }

  public getPublicRooms = async (req: Request, res: Response): Promise<void> => {
    try {
      const rooms = this.roomService.getPublicRooms();
      const userId = req.user?.sub || req.user?.id;
      let eligibleRooms = rooms.filter(room => !room.isRanked);

      if (userId) {
        const rankKey = await this.getUserRankKey(userId, req.user?.role === 'guest');
        eligibleRooms = rooms.filter(room => !room.isRanked || room.rankKey === rankKey);
      }

      res.status(200).json({ rooms: eligibleRooms });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public getRoomByCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;
      const room = this.roomService.getRoomByCode(code as string);
      if (!room) {
        res.status(404).json({ error: 'Room not found with this code.' });
        return;
      }
      res.status(200).json({ room });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public getRoomById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const room = this.roomService.getRoom(id as string);
      if (!room) {
        res.status(404).json({ error: 'Room not found.' });
        return;
      }
      res.status(200).json({ room });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public createRoom = async (req: Request, res: Response): Promise<void> => {
    try {
      const hostId = req.user?.sub || req.user?.id;
      const hostUsername = req.user?.username || 'Host';
      const isGuest = req.user?.role === 'guest' || req.user?.provider === 'guest';
      const { name, mode, isPrivate } = req.body;

      const room = this.roomService.createRoom(
        hostId,
        hostUsername,
        isGuest,
        name || `Sala de ${hostUsername}`,
        (mode as GameMode) || '1v1',
        !!isPrivate
      );

      res.status(201).json({ message: 'Room created successfully.', room });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public joinRoom = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.sub || req.user?.id;
      const username = req.user?.username || 'Player';
      const isGuest = req.user?.role === 'guest' || req.user?.provider === 'guest';
      const { id } = req.params;

      const targetRoom = this.roomService.getRoom(id as string);
      if (!targetRoom) {
        res.status(404).json({ error: 'Room not found.' });
        return;
      }
      await this.assertRankedRoomAccess(userId, isGuest, targetRoom);
      const room = this.roomService.joinRoom(id as string, userId, username, isGuest);
      res.status(200).json({ message: 'Joined room successfully.', room });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public togglePrivacy = async (req: Request, res: Response): Promise<void> => {
    try {
      const hostId = req.user?.sub || req.user?.id;
      const { id } = req.params;
      const { isPrivate } = req.body;

      const room = this.roomService.toggleRoomPrivacy(id as string, hostId, !!isPrivate);
      res.status(200).json({ message: 'Room privacy updated.', room });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  public cancelRoom = async (req: Request, res: Response): Promise<void> => {
    try {
      const hostId = req.user?.sub || req.user?.id;
      const { id } = req.params;

      this.roomService.cancelRoom(id as string, hostId);
      res.status(200).json({ message: 'Room cancelled successfully.' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  };

  private async getUserRankKey(userId: string, isGuest: boolean): Promise<string> {
    const rankTierService = container.resolve(RankTierService);
    if (isGuest || userId.startsWith('guest_')) {
      return (await rankTierService.getRankInfo(0)).rankKey;
    }

    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { stats: true }
    });
    if (!user) throw new Error('No se pudo determinar el rango del usuario.');
    return (await rankTierService.getRankInfo(user.stats?.xp ?? 0)).rankKey;
  }

  private async assertRankedRoomAccess(userId: string, isGuest: boolean, room: ReturnType<RoomService['getRoom']>): Promise<void> {
    if (!room?.isRanked) return;
    const rankKey = await this.getUserRankKey(userId, isGuest);
    if (!room.rankKey || room.rankKey !== rankKey) {
      throw new Error('Solo puedes unirte a partidas ranked de tu mismo rango.');
    }
  }
}
