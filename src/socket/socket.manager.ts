import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server as HttpServer } from 'http';
import { singleton, inject, container } from 'tsyringe';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.config.js';
import { MatchmakingService, GameMode } from '../services/matchmaking.service.js';
import { GameService } from '../services/game.service.js';
import { RoomService, AVAILABLE_COLORS, IRoom } from '../services/room.service.js';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { RankTierService } from '../services/rank-tier.service.js';

import { UserRole } from '../models/user-role.enum.js';
import { PresenceStatus } from '../models/presence.enum.js';
import { RoomStatus } from '../models/room-status.enum.js';
import { StoreItemCategory } from '../models/store-item.enum.js';
import { StoreItemService } from '../services/store-item.service.js';

@singleton()
export class SocketManager {
  public io!: Server;
  private rematchRequests: Map<string, Set<string>> = new Map();
  private lastMatchPlayers: Map<string, any[]> = new Map();

  constructor(
    @inject(MatchmakingService) private matchmakingService: MatchmakingService,
    @inject(GameService) private gameService: GameService,
    @inject(RoomService) private roomService: RoomService,
    @inject(StoreItemService) private storeItemService: StoreItemService
  ) {}

  private async getUserRankKey(userId: string): Promise<string> {
    const rankTierService = container.resolve(RankTierService);
    if (userId.startsWith('guest_')) {
      return (await rankTierService.getRankInfo(0)).rankKey;
    }

    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: { stats: true }
    });
    if (!user) throw new Error('No se pudo determinar el rango del usuario.');
    return (await rankTierService.getRankInfo(user.stats?.xp ?? 0)).rankKey;
  }

  private async assertRankedRoomAccess(userId: string, room: IRoom): Promise<void> {
    if (!room.isRanked) return;
    const rankKey = await this.getUserRankKey(userId);
    if (!room.rankKey || room.rankKey !== rankKey) {
      throw new Error('Solo puedes unirte a partidas ranked de tu mismo rango.');
    }
  }

  private async sendPublicRoomsToSocket(socket: Socket): Promise<void> {
    const rooms = this.roomService.getPublicRooms();
    const hasRankedRooms = rooms.some(room => room.isRanked);
    const rankKey = hasRankedRooms
      ? await this.getUserRankKey(socket.data.user?.sub || socket.data.user?.id || '')
      : null;
    socket.emit('publicRooms', rooms.filter(room => !room.isRanked || room.rankKey === rankKey));
  }

  private async broadcastPublicRooms(): Promise<void> {
    const namespace = this.io.of('/matchmaking');
    await Promise.all(Array.from(namespace.sockets.values()).map(async socket => {
      try {
        await this.sendPublicRoomsToSocket(socket);
      } catch (error) {
        console.error('Failed to send rank-eligible public rooms:', error);
        socket.emit('error', 'No se pudieron cargar las salas compatibles con tu rango.');
      }
    }));
  }
  
  public async initialize(httpServer: HttpServer): Promise<void> {
    this.io = new Server(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    });

    try {
      const pubClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: { reconnectStrategy: false }
      });
      const subClient = pubClient.duplicate();

      pubClient.on('error', () => {});
      subClient.on('error', () => {});

      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.io.adapter(createAdapter(pubClient, subClient));
      console.log('✅ [SocketManager] Redis adapter connected successfully.');
    } catch (err) {
      console.warn('⚠️ [SocketManager] Redis is not available locally. Running Socket.IO with built-in in-memory adapter.');
    }

    this.gameService.setSocketServer(this.io);

    this.setupMiddlewares();
    this.setupNamespaces();
  }

  private async authMiddleware(socket: Socket, next: (err?: any) => void): Promise<void> {
    const token = socket.handshake.auth?.token;
    const deviceId = socket.handshake.auth?.deviceId || (socket.handshake.headers['x-device-id'] as string);
    if (!token) return next(new Error('Authentication error: Token missing'));
    try {
      const decoded: any = jwt.verify(token, ENV.JWT_SECRET);
      socket.data.user = decoded;
      socket.data.deviceId = deviceId;

      if (decoded.role !== 'guest' && !decoded.id?.startsWith('guest_')) {
        const { DeviceSessionService } = await import('../services/device-session.service.js');
        const deviceSessionService = container.resolve(DeviceSessionService);
        const isValid = await deviceSessionService.isSessionValid(decoded.id, token, deviceId);
        if (!isValid) {
          return next(new Error('SESSION_REVOKED'));
        }

        const currentUser = await AppDataSource.getRepository(User).findOne({
          where: { id: decoded.id },
          select: { id: true, username: true, avatarUrl: true, provider: true }
        });
        if (currentUser) {
          decoded.username = currentUser.username;
          decoded.avatarUrl = currentUser.avatarUrl;
          decoded.provider = currentUser.provider;
        }
      }

      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  }

  public emitSessionRevoked(userId: string, revokedDeviceIds: string[]): void {
    if (!this.io || !userId || !revokedDeviceIds || revokedDeviceIds.length === 0) return;
    const deviceSet = new Set(revokedDeviceIds);

    const namespaces = [this.io.of('/matchmaking'), this.io.of('/game')];
    for (const ns of namespaces) {
      for (const s of ns.sockets.values()) {
        const uId = s.data?.user?.sub || s.data?.user?.id;
        const dId = s.data?.deviceId || s.handshake.auth?.deviceId || (s.handshake.headers['x-device-id'] as string);
        if (uId === userId && (dId ? deviceSet.has(dId) : true)) {
          console.log(`🔌 [SocketManager] Emitting sessionRevoked to socket user ${userId} (device: ${dId})`);
          s.emit('sessionRevoked', { message: 'Tu sesión ha sido cerrada remotamente desde otro dispositivo.' });
          s.disconnect(true);
        }
      }
    }
  }

  public emitNewSessionDetected(userId: string, newDeviceName: string, newDeviceId: string): void {
    if (!this.io || !userId) return;
    const namespaces = [this.io.of('/matchmaking'), this.io.of('/game')];
    for (const ns of namespaces) {
      for (const s of ns.sockets.values()) {
        const uId = s.data?.user?.sub || s.data?.user?.id;
        const dId = s.data?.deviceId || s.handshake.auth?.deviceId || (s.handshake.headers['x-device-id'] as string);
        if (uId === userId && dId && dId !== newDeviceId) {
          console.log(`🔔 [SocketManager] Notifying socket user ${userId} of new session on device: ${newDeviceName}`);
          s.emit('newSessionDetected', { deviceName: newDeviceName });
        }
      }
    }
  }

  private setupMiddlewares(): void {
    this.io.use((socket, next) => this.authMiddleware(socket, next));
  }

  private async updateUserPresence(userId: string, isOnline: boolean, status: PresenceStatus): Promise<void> {
    try {
      if (!userId || userId.startsWith('guest_')) return; // Guests are transient, no DB update
      const userRepo = AppDataSource.getRepository(User);
      await userRepo.update(userId, {
        isOnline,
        presenceStatus: status,
        lastSeen: new Date()
      });
    } catch (err) {
      console.error('Error updating presence:', err);
    }
  }

  private setupNamespaces(): void {
    const authMw = (socket: Socket, next: (err?: any) => void) => this.authMiddleware(socket, next);

    const matchmakingNs = this.io.of('/matchmaking');
    matchmakingNs.use(authMw);
    matchmakingNs.on('connection', (socket: Socket) => {
      const user = socket.data.user;
      if (!user) return;
      const userId = user.sub || user.id;
      const username = user.username || `Guest_${userId.substring(0, 4)}`;
      const isGuest = user.role === UserRole.GUEST || user.provider === 'guest';
      const avatarUrl = user.avatarUrl;
      const provider = user.provider;

      socket.join(userId);
      this.updateUserPresence(userId, true, PresenceStatus.ONLINE);

      // Re-join any active room socket channel the user belongs to and send updated room state
      const userRoom = this.roomService.findRoomByUserId(userId);
      if (userRoom) {
        socket.join(userRoom.id);
        socket.emit('roomUpdated', userRoom);
        socket.emit('myActiveRoom', userRoom);
      } else {
        socket.emit('myActiveRoom', null);
      }

      // Send available public rooms on connect
      void this.sendPublicRoomsToSocket(socket).catch(error => {
        console.error('Failed to load rank-eligible public rooms:', error);
        socket.emit('error', 'No se pudieron cargar las salas compatibles con tu rango.');
      });

      socket.on('getPublicRooms', () => {
        void this.sendPublicRoomsToSocket(socket).catch(error => {
          console.error('Failed to load rank-eligible public rooms:', error);
          socket.emit('error', 'No se pudieron cargar las salas compatibles con tu rango.');
        });
      });

      socket.on('requestActiveRoom', () => {
        const room = this.roomService.findRoomByUserId(userId);
        if (room) socket.join(room.id);
        socket.emit('myActiveRoom', room || null);
      });

      const getUserWins = async (uId: string): Promise<number> => {
        if (!uId || uId.startsWith('guest_')) return 0;
        try {
          const uRepo = AppDataSource.getRepository(User);
          const u = await uRepo.findOneBy({ id: uId });
          return u?.stats?.wins || 0;
        } catch {
          return 0;
        }
      };

      socket.on('joinQueue', async (request: GameMode | string | { mode?: GameMode | string; ranked?: boolean }) => {
        try {
          const { SystemSettingsService } = await import('../services/system-settings.service.js');
          const settingsService = container.resolve(SystemSettingsService);
          const settings = await settingsService.getSettings();
          if (settings.maintenanceMode) {
            return socket.emit('error', 'El servidor está en modo mantenimiento. Intenta más tarde.');
          }

          const gameMode: GameMode = (typeof request === 'object' ? request.mode : request) as GameMode || '1v1';
          const isRanked = typeof request === 'object' && request.ranked === true;
          const rankKey = isRanked ? await this.getUserRankKey(userId) : undefined;
          const openRoom = this.roomService.findQuickMatchRoom(gameMode, isRanked, rankKey);
          const userWins = await getUserWins(userId);

          if (openRoom) {
            await this.assertRankedRoomAccess(userId, openRoom);
            const room = this.roomService.joinRoom(openRoom.id, userId, username, isGuest, avatarUrl, provider, userWins);
            socket.join(room.id);
            socket.emit('joinedByCodeSuccess', room);
            matchmakingNs.to(room.id).emit('roomUpdated', room);
            matchmakingNs.to(room.id).emit('playerJoinedRoom', { userId, username });
            void this.broadcastPublicRooms();

            if (room.isQuickMatch) {
              room.status = RoomStatus.PLAYING;
              this.lastMatchPlayers.set(room.id, [...room.players]);
              this.gameService.createGame(room.id, room.mode, room.players, room.isPrivate, room.name, room.isRanked);
              matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
              void this.broadcastPublicRooms();
            }
          } else {
            const roomName = `Sala de ${username}`;
            const room = this.roomService.createRoom(
              userId,
              username,
              isGuest,
              roomName,
              gameMode,
              false,
              avatarUrl,
              provider,
              userWins,
              true,
              isRanked,
              rankKey
            );
            socket.join(room.id);
            socket.emit('roomCreated', room);
            void this.broadcastPublicRooms();
          }
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('createRoom', async (data: { name: string; mode: GameMode; isPrivate: boolean; isQuickMatch?: boolean; targetInviteUserId?: string }) => {
        try {
          const { SystemSettingsService } = await import('../services/system-settings.service.js');
          const settingsService = container.resolve(SystemSettingsService);
          const settings = await settingsService.getSettings();
          if (settings.maintenanceMode) {
            return socket.emit('error', 'El servidor está en modo mantenimiento. Intenta más tarde.');
          }

          const userWins = await getUserWins(userId);
          const room = this.roomService.createRoom(
            userId,
            username,
            isGuest,
            data.name,
            data.mode,
            data.isPrivate,
            avatarUrl,
            provider,
            userWins,
            data.isQuickMatch || false
          );
          socket.join(room.id);
          socket.emit('roomCreated', room);
          void this.broadcastPublicRooms();

          if (data.targetInviteUserId) {
            matchmakingNs.to(data.targetInviteUserId).emit('gameInviteReceived', {
              inviterUserId: userId,
              inviterUsername: username,
              inviterAvatarUrl: avatarUrl,
              roomId: room.id,
              roomCode: room.code,
              mode: room.mode,
              isPrivate: room.isPrivate
            });
          }
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('sendGameInvite', (data: { targetUserId: string; roomId?: string; roomCode?: string; mode?: string }) => {
        const targetRoom = data.roomCode ? this.roomService.getRoomByCode(data.roomCode) : (data.roomId ? this.roomService.getRoom(data.roomId) : null);
        matchmakingNs.to(data.targetUserId).emit('gameInviteReceived', {
          inviterUserId: userId,
          inviterUsername: username,
          inviterAvatarUrl: avatarUrl,
          roomId: targetRoom?.id || data.roomId,
          roomCode: targetRoom?.code || data.roomCode,
          mode: targetRoom?.mode || data.mode,
          isPrivate: targetRoom?.isPrivate ?? true
        });
      });

      socket.on('declineGameInvite', (data: { inviterUserId: string }) => {
        matchmakingNs.to(data.inviterUserId).emit('gameInviteDeclined', {
          inviteeUserId: userId,
          inviteeUsername: username
        });
      });

      socket.on('createVsAiRoom', async () => {
        try {
          const room = this.roomService.createVsAiRoom(userId, username, isGuest);
          socket.join(room.id);
          room.status = RoomStatus.PLAYING;
          await this.gameService.createGame(room.id, room.mode, room.players, room.isPrivate, room.name, room.isRanked);
          socket.emit('gameStarting', { matchId: room.id });
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('joinCustomRoom', async (data: { roomId: string }) => {
        try {
          const targetRoom = this.roomService.getRoom(data.roomId);
          if (!targetRoom) throw new Error('Room not found');
          await this.assertRankedRoomAccess(userId, targetRoom);
          const userWins = await getUserWins(userId);
          const room = this.roomService.joinRoom(data.roomId, userId, username, isGuest, avatarUrl, provider, userWins);
          socket.join(room.id);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.to(room.id).emit('playerJoinedRoom', { userId, username });
          void this.broadcastPublicRooms();

          if (room.isQuickMatch && room.players.length >= 2) {
            room.status = RoomStatus.PLAYING;
            this.lastMatchPlayers.set(room.id, [...room.players]);
            this.gameService.createGame(room.id, room.mode, room.players, room.isPrivate, room.name, room.isRanked);
            matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
            void this.broadcastPublicRooms();
          }
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('joinByCode', async (data: { code: string }) => {
        try {
          const targetRoom = this.roomService.getRoomByCode(data.code);
          if (!targetRoom) throw new Error('No room found with this code.');
          await this.assertRankedRoomAccess(userId, targetRoom);
          const userWins = await getUserWins(userId);
          const room = this.roomService.joinRoom(targetRoom.id, userId, username, isGuest, avatarUrl, provider, userWins);
          socket.join(room.id);
          socket.emit('joinedByCodeSuccess', room);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.to(room.id).emit('playerJoinedRoom', { userId, username });
          void this.broadcastPublicRooms();

          if (room.isQuickMatch && room.players.length >= 2) {
            room.status = RoomStatus.PLAYING;
            this.lastMatchPlayers.set(room.id, [...room.players]);
            this.gameService.createGame(room.id, room.mode, room.players, room.isPrivate, room.name, room.isRanked);
            matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
            void this.broadcastPublicRooms();
          }
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('chatMessage', (data: { roomId: string; message: string }) => {
        if (data.roomId && data.message) {
          matchmakingNs.to(data.roomId).emit('chatMessage', {
            sender: username,
            senderId: userId,
            message: data.message,
            timestamp: new Date()
          });
        }
      });

      socket.on('toggleRoomPrivacy', (data: { roomId: string; isPrivate: boolean }) => {
        try {
          const room = this.roomService.toggleRoomPrivacy(data.roomId, userId, data.isPrivate);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          void this.broadcastPublicRooms();
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('cancelRoom', (data: { roomId: string }) => {
        try {
          this.roomService.cancelRoom(data.roomId, userId);
          const cancellation = {
            roomId: data.roomId,
            cancelledBy: userId,
            message: 'La partida fue cancelada por el anfitrión.'
          };
          matchmakingNs.to(data.roomId).emit('roomCancelled', cancellation);
          socket.emit('roomCancelled', cancellation);
          socket.emit('myActiveRoom', null);
          void this.broadcastPublicRooms();
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('removeBot', (data: { roomId: string; botId: string }) => {
        try {
          const room = this.roomService.removeBotFromCustomRoom(data.roomId, userId, data.botId);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('selectColor', (data: { roomId: string; color: string; targetUserId?: string }) => {
        try {
          const room = this.roomService.selectPlayerColor(data.roomId, userId, data.color, data.targetUserId);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('selectRoomCosmetic', async (data: { roomId: string; category: string; itemId: string | null }) => {
        try {
          if (data.category !== StoreItemCategory.PAWN_COLOR && data.category !== StoreItemCategory.PAWN_SKIN) {
            throw new Error('Unsupported lobby cosmetic category');
          }
          let cosmeticValue: string | undefined;
          let cosmeticName: { en: string; es: string } | undefined;
          let allowColor = false;
          if (data.itemId) {
            const item = await this.storeItemService.getOwnedItem(userId, data.itemId, data.category as StoreItemCategory);
            if (!item) throw new Error('You do not own this cosmetic');
            if (data.category === StoreItemCategory.PAWN_COLOR) {
              const pawnColors: Record<string, string> = {
                'PWN-101': '#EAB308', 'PWN-102': '#CBD5E1', 'PWN-103': '#C2410C',
                'PWN-104': '#E11D48', 'PWN-105': '#0284C7', 'PWN-106': '#16A34A',
                'PWN-107': '#0F172A', 'PWN-108': '#92400E', 'PWN-109': '#F1F5F9',
                'PWN-110': '#FF2D55', 'PWN-111': '#5AC8FA'
              };
              const code = item.code.trim().toUpperCase();
              cosmeticValue = pawnColors[code];
              if (!cosmeticValue) {
                const colorName = `${item.configuration.es.name} ${item.configuration.en.name}`.toLocaleLowerCase();
                if (colorName.includes('rosa') || colorName.includes('pink')) {
                  cosmeticValue = pawnColors['PWN-110'];
                }
              }
              if (!cosmeticValue) throw new Error('Invalid pawn color item');
            } else {
              cosmeticValue = item.icon;
              cosmeticName = {
                en: item.configuration.en.name,
                es: item.configuration.es.name
              };
              allowColor = item.allowColor;
            }
          }
          const room = this.roomService.setPlayerCosmetic(data.roomId, userId, data.category, data.itemId || null, cosmeticValue, allowColor, cosmeticName);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('switchTeam', (data: { roomId: string }) => {
        try {
          const room = this.roomService.switchTeam(data.roomId, userId);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('startCustomGame', (data: { roomId: string }) => {
        try {
          const room = this.roomService.getRoom(data.roomId);
          if (!room) throw new Error('Room not found');
          if (room.hostId !== userId) throw new Error('Only the room host can start the game');
          if (room.players.length < room.maxPlayers) {
            throw new Error('Todos los cupos de la sala deben estar llenos para iniciar la partida.');
          }
          if (room.players.some(p => !p.color || p.color.trim() === '' || p.color === 'null')) {
            throw new Error('Todos los jugadores deben seleccionar un color válido antes de iniciar.');
          }
          if (room.mode === '2v2') {
            const redCount = room.players.filter(p => p.color && p.color.toUpperCase() === '#FF3B30').length;
            const blueCount = room.players.filter(p => p.color && p.color.toUpperCase() === '#007AFF').length;
            if (redCount !== 2 || blueCount !== 2) {
              throw new Error('En modo 2v2 debe haber exactamente 2 jugadores en el equipo Rojo y 2 en el Azul.');
            }
          }
          if (room.status === RoomStatus.PLAYING) return;

          // Broadcast 3-second countdown to all players in room
          matchmakingNs.to(room.id).emit('gameStartingCountdown', { matchId: room.id, countdownSeconds: 3 });

          setTimeout(() => {
            room.status = RoomStatus.PLAYING;
            this.lastMatchPlayers.set(room.id, [...room.players]);
            this.gameService.createGame(room.id, room.mode, room.players, room.isPrivate, room.name, room.isRanked);
            
            matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
            void this.broadcastPublicRooms();
          }, 3000);
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      const handleAddBot = (data: { roomId: string }) => {
        try {
          const room = this.roomService.addBotToCustomRoom(data.roomId, userId);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          void this.broadcastPublicRooms();
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      };
      socket.on('addBotToRoom', handleAddBot);
      socket.on('addBot', handleAddBot);

      const handleRemoveBot = (data: { roomId: string; botId: string }) => {
        try {
          const room = this.roomService.removeBotFromCustomRoom(data.roomId, userId, data.botId);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          void this.broadcastPublicRooms();
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      };
      socket.on('removeBotFromRoom', handleRemoveBot);
      socket.on('removeBot', handleRemoveBot);

      const handleKickPlayer = (data: { roomId: string; targetPlayerId: string }) => {
        try {
          const room = this.roomService.kickPlayerFromCustomRoom(data.roomId, userId, data.targetPlayerId);

          const roomSockets = matchmakingNs.adapter.rooms.get(data.roomId);
          if (roomSockets) {
            for (const sId of roomSockets) {
              const s = matchmakingNs.sockets.get(sId);
              if (s && (s.data.user?.id === data.targetPlayerId || s.data.user?.sub === data.targetPlayerId || s.id === data.targetPlayerId)) {
                s.leave(data.roomId);
                s.emit('kickedFromRoom', { message: 'Has sido expulsado de la sala por el anfitrión.' });
              }
            }
          }

          matchmakingNs.to(room.id).emit('roomUpdated', room);
          void this.broadcastPublicRooms();
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      };
      socket.on('kickPlayerFromRoom', handleKickPlayer);
      socket.on('kickPlayer', handleKickPlayer);

      const handleLeaveRoom = (data: { roomId: string }) => {
        const room = this.roomService.leaveRoom(data.roomId, userId);
        socket.leave(data.roomId);
        socket.emit('myActiveRoom', null);
        if (room) {
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.to(room.id).emit('playerLeftRoom', { userId, username });
        }
        void this.broadcastPublicRooms();
      };
      socket.on('leaveCustomRoom', handleLeaveRoom);
      socket.on('leaveRoom', handleLeaveRoom);

      socket.on('disconnect', async () => {
        this.updateUserPresence(userId, false, PresenceStatus.OFFLINE);
      });
    });

    const gameNs = this.io.of('/game');
    gameNs.use(authMw);
    gameNs.on('connection', (socket: Socket) => {
      const user = socket.data.user;
      if (!user) return;
      const userId = user.sub || user.id;
      const username = user.username || `Guest_${userId.substring(0, 4)}`;

      socket.on('joinRoom', (roomId: string) => {
        socket.data.currentRoomId = roomId;
        socket.join(roomId);
        this.updateUserPresence(userId, true, PresenceStatus.PLAYING);
        const game = this.gameService.getGame(roomId);
        if (game) {
          if (game.state === 'finished') {
            socket.emit('gameFinished', { winner: game.winner, alreadyFinished: true });
          } else {
            socket.emit('gameStarted', {
              currentTurn: game.playersList[game.currentTurnIndex],
              board: game.board.toDTO(userId),
              turnTimeLimitSeconds: game.turnTimeLimitSeconds,
              turnSecondsRemaining: game.getRemainingTurnSeconds(),
              pendingBoostDecision: game.getPendingBoostDecision()
            });
          }
        } else {
          socket.emit('gameFinished', { winner: null, alreadyFinished: true });
        }
      });

      socket.on('movePlayer', (data: { roomId: string, x: number, y: number }) => {
        const game = this.gameService.getGame(data.roomId);
        if (game) {
          if (!game.playersList.includes(userId)) {
            socket.emit('error', 'Los espectadores no pueden realizar movimientos.');
            return;
          }
          game.executeMove(userId, data.x, data.y);
        }
      });

      socket.on('placeWall', (data: { roomId: string, x: number, y: number, isHorizontal: boolean }) => {
        const game = this.gameService.getGame(data.roomId);
        if (game) {
          if (!game.playersList.includes(userId)) {
            socket.emit('error', 'Los espectadores no pueden colocar muros.');
            return;
          }
          game.executeWall(userId, Math.random().toString(), data.x, data.y, data.isHorizontal);
        }
      });

      socket.on('useKillerItem', (data: { roomId: string, targetPlayerId: string }) => {
        const game = this.gameService.getGame(data.roomId);
        if (game) {
          game.executeKillerItem(userId, data.targetPlayerId);
        }
      });

      socket.on('useExchangeItem', (data: { roomId: string, targetPlayerId: string }) => {
        const game = this.gameService.getGame(data.roomId);
        if (game) {
          game.executeExchangeItem(userId, data.targetPlayerId);
        }
      });
      
      socket.on('surrender', (data: any) => {
        const roomId = typeof data === 'string' ? data : (data?.roomId || data?.matchId);
        if (roomId) {
          const game = this.gameService.getGame(roomId);
          if (game) {
            if (!game.playersList.includes(userId)) {
              socket.emit('error', 'Los espectadores no pueden rendirse.');
              return;
            }
            if (data?.abandonBotGame === true && game.hasBots()) {
              game.abandon();
            } else {
              game.surrender(userId);
            }
          }
        }
      });

      socket.on('requestRematch', (data: { roomId: string }) => {
        try {
          const roomId = data.roomId;
          if (!roomId) return;

          if (!this.rematchRequests.has(roomId)) {
            this.rematchRequests.set(roomId, new Set());
          }
          const requests = this.rematchRequests.get(roomId)!;
          requests.add(userId);

          const room = this.roomService.getRoom(roomId);
          const rawPlayers = (room && room.players && room.players.length > 0)
            ? room.players
            : (this.lastMatchPlayers.get(roomId) || []);

          // Deduplicate players list
          const uniquePlayersMap = new Map<string, any>();
          for (const p of rawPlayers) {
            if (p && p.id && !uniquePlayersMap.has(p.id)) {
              uniquePlayersMap.set(p.id, p);
            }
          }
          const players = Array.from(uniquePlayersMap.values());

          gameNs.to(roomId).emit('rematchRequested', { requesterId: userId, requesterName: username, count: requests.size });

          // A rematch ALWAYS requires at least 2 players to accept
          const requiredPlayers = Math.max(2, players.length);

          if (requests.size >= requiredPlayers) {
            this.rematchRequests.delete(roomId);

            if (players.length >= 2) {
              const targetMode: GameMode = (room ? room.mode : '1v1');
              const host = players[0];

              if (targetMode === '1v1') {
                // For 1v1 rematches: NEVER create a lobby room in RoomService. Start match directly!
                const newMatchId = `match_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                this.lastMatchPlayers.set(newMatchId, [...players]);
                this.gameService.createGame(newMatchId, '1v1', players, true, room ? room.name : `Revancha de ${host.username}`);

                gameNs.to(roomId).emit('gameStarting', { matchId: newMatchId });
                this.io.of('/matchmaking').to(roomId).emit('gameStarting', { matchId: newMatchId });

                const playerIds = new Set(players.map(p => p.id));
                for (const s of gameNs.sockets.values()) {
                  const uId = s.data?.user?.sub || s.data?.user?.id;
                  if (uId && playerIds.has(uId)) {
                    s.emit('gameStarting', { matchId: newMatchId });
                  }
                }
                for (const s of matchmakingNs.sockets.values()) {
                  const uId = s.data?.user?.sub || s.data?.user?.id;
                  if (uId && playerIds.has(uId)) {
                    s.emit('gameStarting', { matchId: newMatchId });
                  }
                }
              } else {
                // Group modes rematch
                const newRoom = this.roomService.createRoom(
                  host.id,
                  host.username,
                  host.isGuest,
                  room ? room.name : `Sala de ${host.username}`,
                  targetMode,
                  true,
                  host.avatarUrl,
                  host.provider,
                  host.wins || 0
                );
                const humanPlayers = players.filter(p => p && p.id && !p.id.startsWith('bot_'));
                for (let i = 1; i < humanPlayers.length; i++) {
                  try {
                    this.roomService.joinRoom(
                      newRoom.id,
                      humanPlayers[i].id,
                      humanPlayers[i].username,
                      humanPlayers[i].isGuest,
                      humanPlayers[i].avatarUrl,
                      humanPlayers[i].provider,
                      humanPlayers[i].wins || 0
                    );
                  } catch (joinErr) {
                    console.warn(`Could not join player ${humanPlayers[i].id} to rematch room:`, joinErr);
                  }
                }
                newRoom.status = RoomStatus.PLAYING;
                this.lastMatchPlayers.set(newRoom.id, [...newRoom.players]);
                this.gameService.createGame(newRoom.id, newRoom.mode, newRoom.players, newRoom.isPrivate, newRoom.name);

                gameNs.to(roomId).emit('gameStarting', { matchId: newRoom.id });
                this.io.of('/matchmaking').to(roomId).emit('gameStarting', { matchId: newRoom.id });

                const playerIds = new Set(players.map(p => p.id));
                for (const s of gameNs.sockets.values()) {
                  const uId = s.data?.user?.sub || s.data?.user?.id;
                  if (uId && playerIds.has(uId)) {
                    s.emit('gameStarting', { matchId: newRoom.id });
                  }
                }
                for (const s of matchmakingNs.sockets.values()) {
                  const uId = s.data?.user?.sub || s.data?.user?.id;
                  if (uId && playerIds.has(uId)) {
                    s.emit('gameStarting', { matchId: newRoom.id });
                  }
                }
              }
            }
          }
        } catch (rematchError) {
          console.error('Error handling requestRematch:', rematchError);
        }
      });

      socket.on('cancelRematch', (data: { roomId: string }) => {
        const roomId = data.roomId;
        if (roomId && this.rematchRequests.has(roomId)) {
          this.rematchRequests.delete(roomId);
        }
        gameNs.to(roomId).emit('rematchDeclined', { declinerName: username });

        // Ensure active room state is cleared for all players on rematch cancellation
        const lastPlayers = (roomId ? this.lastMatchPlayers.get(roomId) : []) || [];
        for (const p of lastPlayers) {
          if (p && p.id && !p.id.startsWith('bot_')) {
            matchmakingNs.to(p.id).emit('myActiveRoom', null);
          }
        }
        matchmakingNs.to(userId).emit('myActiveRoom', null);
      });

      socket.on('chatMessage', (data: { roomId: string, message: string }) => {
        gameNs.to(data.roomId).emit('chatMessage', { sender: username, message: data.message, timestamp: new Date() });
      });

      socket.on('sendQuickChat', (data: { roomId: string, messageId: string }) => {
        gameNs.to(data.roomId).emit('quickChat', {
          sender: username,
          senderId: userId,
          messageId: data.messageId,
          timestamp: new Date()
        });
      });

      const handleEmote = async (roomId: string, emoteId: string): Promise<void> => {
        try {
          const game = this.gameService.getGame(roomId);
          if (!game || !game.playersList.includes(userId)) throw new Error('Only players in this game can react');
          const defaults = ['👍', '😂', '😮', '😡'];
          let displayedEmote = emoteId;
          if (!defaults.includes(emoteId)) {
            const item = await this.storeItemService.getOwnedItem(userId, emoteId, StoreItemCategory.EXCLUSIVE_EMOTES);
            if (!item) throw new Error('You do not own this reaction');
            displayedEmote = item.icon;
          }
          gameNs.to(roomId).emit('emote', { sender: username, emoteId: displayedEmote });
          game.onBadgeEvent(userId, 'emote_sent');
        } catch (error: any) {
          if (error.message === 'Only players in this game can react' || error.message === 'You do not own this reaction') {
            socket.emit('error', error.message);
            return;
          }
          console.error('Failed to validate game reaction:', error);
          socket.emit('error', 'Could not send reaction');
        }
      };
      socket.on('emote', (data: { roomId: string; emoteId: string }) => {
        if (typeof data?.roomId === 'string' && typeof data?.emoteId === 'string') {
          void handleEmote(data.roomId, data.emoteId);
        }
      });

      socket.on('selectMatchCosmetic', async (data: { roomId: string; category: string; itemId: string | null }) => {
        try {
          if (data.category !== StoreItemCategory.MOVEMENT_TRAIL && data.category !== StoreItemCategory.WALL_EFFECT) {
            throw new Error('Unsupported in-game cosmetic category');
          }
          const game = this.gameService.getGame(data.roomId);
          if (!game || !game.playersList.includes(userId)) throw new Error('Player not found in game');
          const item = data.itemId
            ? await this.storeItemService.getOwnedItem(userId, data.itemId, data.category as StoreItemCategory)
            : null;
          if (data.itemId && !item) throw new Error('You do not own this cosmetic');
          game.setPlayerCosmetic(userId, data.category, data.itemId || null, item?.icon);
          const player = game.board.players.get(userId)!;
          gameNs.to(data.roomId).emit('playerCosmeticsUpdated', {
            playerId: userId,
            movementTrailId: player.movementTrailId,
            movementTrailIcon: player.movementTrailIcon,
            wallEffectId: player.wallEffectId,
            wallEffectIcon: player.wallEffectIcon
          });
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('send_emote', (data: { roomId: string, emoji: string }) => {
        if (typeof data?.roomId === 'string' && typeof data?.emoji === 'string') {
          void handleEmote(data.roomId, data.emoji);
        }
      });

      socket.on('disconnect', () => {
        const activeGame = this.gameService.getGameByPlayerId(userId);
        if (activeGame && activeGame.state === 'playing') {
          if (activeGame.hasBots()) {
            activeGame.abandon();
          } else {
            activeGame.surrender(userId);
          }
        }
        const roomId = socket.data?.currentRoomId;
        if (roomId && this.rematchRequests.has(roomId)) {
          this.rematchRequests.delete(roomId);
          gameNs.to(roomId).emit('rematchDeclined', { declinerName: username });
        }
      });
    });
  }
}
