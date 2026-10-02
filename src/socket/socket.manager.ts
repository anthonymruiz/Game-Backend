import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server as HttpServer } from 'http';
import { singleton, inject, container } from 'tsyringe';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.config.js';
import { MatchmakingService, GameMode } from '../services/matchmaking.service.js';
import { GameService } from '../services/game.service.js';
import { RoomService, AVAILABLE_COLORS } from '../services/room.service.js';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';

import { UserRole } from '../models/user-role.enum.js';
import { PresenceStatus } from '../models/presence.enum.js';
import { RoomStatus } from '../models/room-status.enum.js';

@singleton()
export class SocketManager {
  public io!: Server;
  private rematchRequests: Map<string, Set<string>> = new Map();
  private lastMatchPlayers: Map<string, any[]> = new Map();

  constructor(
    @inject(MatchmakingService) private matchmakingService: MatchmakingService,
    @inject(GameService) private gameService: GameService,
    @inject(RoomService) private roomService: RoomService
  ) {}
  
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

  private authMiddleware(socket: Socket, next: (err?: any) => void): void {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication error: Token missing'));
    try {
      const decoded: any = jwt.verify(token, ENV.JWT_SECRET);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
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

      // Send available public rooms on connect
      socket.emit('publicRooms', this.roomService.getPublicRooms());

      socket.on('getPublicRooms', () => {
        socket.emit('publicRooms', this.roomService.getPublicRooms());
      });

      socket.on('joinQueue', async (mode: GameMode | string) => {
        try {
          const { SystemSettingsService } = await import('../services/system-settings.service.js');
          const settingsService = container.resolve(SystemSettingsService);
          const settings = await settingsService.getSettings();
          if (settings.maintenanceMode) {
            return socket.emit('error', 'El servidor está en modo mantenimiento. Intenta más tarde.');
          }

          const gameMode: GameMode = (mode as GameMode) || '1v1';
          const publicRooms = this.roomService.getPublicRooms();
          const openRoom = publicRooms.find(r => r.mode === gameMode && r.players.length < r.maxPlayers);

          if (openRoom) {
            const room = this.roomService.joinRoom(openRoom.id, userId, username, isGuest, avatarUrl, provider);
            socket.join(room.id);
            socket.emit('joinedByCodeSuccess', room);
            matchmakingNs.to(room.id).emit('roomUpdated', room);
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());

            if (room.players.length >= room.maxPlayers) {
              room.status = RoomStatus.PLAYING;
              this.lastMatchPlayers.set(room.id, [...room.players]);
              this.gameService.createGame(room.id, room.mode, room.players);
              matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
              matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
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
              provider
            );
            socket.join(room.id);
            socket.emit('roomCreated', room);
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
          }
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('createRoom', async (data: { name: string; mode: GameMode; isPrivate: boolean }) => {
        try {
          const { SystemSettingsService } = await import('../services/system-settings.service.js');
          const settingsService = container.resolve(SystemSettingsService);
          const settings = await settingsService.getSettings();
          if (settings.maintenanceMode) {
            return socket.emit('error', 'El servidor está en modo mantenimiento. Intenta más tarde.');
          }

          const room = this.roomService.createRoom(
            userId,
            username,
            isGuest,
            data.name,
            data.mode,
            data.isPrivate,
            avatarUrl,
            provider
          );
          socket.join(room.id);
          socket.emit('roomCreated', room);
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('createVsAiRoom', () => {
        try {
          const room = this.roomService.createVsAiRoom(userId, username, isGuest);
          socket.join(room.id);
          room.status = RoomStatus.PLAYING;
          this.gameService.createGame(room.id, room.mode, room.players);
          socket.emit('gameStarting', { matchId: room.id });
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('joinCustomRoom', (data: { roomId: string }) => {
        try {
          const room = this.roomService.joinRoom(data.roomId, userId, username, isGuest, avatarUrl, provider);
          socket.join(room.id);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('joinByCode', (data: { code: string }) => {
        try {
          const targetRoom = this.roomService.getRoomByCode(data.code);
          if (!targetRoom) throw new Error('No room found with this code.');
          const room = this.roomService.joinRoom(targetRoom.id, userId, username, isGuest, avatarUrl, provider);
          socket.join(room.id);
          socket.emit('joinedByCodeSuccess', room);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('toggleRoomPrivacy', (data: { roomId: string; isPrivate: boolean }) => {
        try {
          const room = this.roomService.toggleRoomPrivacy(data.roomId, userId, data.isPrivate);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('cancelRoom', (data: { roomId: string }) => {
        try {
          this.roomService.cancelRoom(data.roomId, userId);
          matchmakingNs.to(data.roomId).emit('roomCancelled', { message: 'La partida fue cancelada por el anfitrión.' });
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
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

          // Broadcast 5-second countdown to all players in room
          matchmakingNs.to(room.id).emit('gameStartingCountdown', { matchId: room.id, countdownSeconds: 5 });

          setTimeout(() => {
            room.status = RoomStatus.PLAYING;
            this.lastMatchPlayers.set(room.id, [...room.players]);
            this.gameService.createGame(room.id, room.mode, room.players);
            
            matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
          }, 5000);
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      const handleAddBot = (data: { roomId: string }) => {
        try {
          const room = this.roomService.addBotToCustomRoom(data.roomId, userId);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
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
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      };
      socket.on('removeBotFromRoom', handleRemoveBot);
      socket.on('removeBot', handleRemoveBot);

      socket.on('leaveCustomRoom', (data: { roomId: string }) => {
        const room = this.roomService.leaveRoom(data.roomId, userId);
        if (room) {
          matchmakingNs.to(room.id).emit('roomUpdated', room);
        }
        matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
      });

      socket.on('disconnect', async () => {
        this.updateUserPresence(userId, false, PresenceStatus.OFFLINE);
        
        // Auto-cleanup any unstarted room the user was in
        const publicRooms = this.roomService.getPublicRooms();
        for (const room of publicRooms) {
          if (room.players.some(p => p.id === userId)) {
            const updated = this.roomService.leaveRoom(room.id, userId);
            if (updated) {
              matchmakingNs.to(updated.id).emit('roomUpdated', updated);
            }
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
          }
        }
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
        socket.join(roomId);
        this.updateUserPresence(userId, true, PresenceStatus.PLAYING);
        const game = this.gameService.getGame(roomId);
        if (game) {
          if (game.state === 'finished') {
            socket.emit('gameFinished', { winner: game.winner, alreadyFinished: true });
          } else {
            socket.emit('gameStarted', { currentTurn: game.playersList[game.currentTurnIndex], board: game.board.toDTO(userId) });
          }
        } else {
          socket.emit('gameFinished', { winner: null, alreadyFinished: true });
        }
      });

      socket.on('movePlayer', (data: { roomId: string, x: number, y: number }) => {
        const game = this.gameService.getGame(data.roomId);
        if (game) game.executeMove(userId, data.x, data.y);
      });

      socket.on('placeWall', (data: { roomId: string, x: number, y: number, isHorizontal: boolean }) => {
        const game = this.gameService.getGame(data.roomId);
        if (game) game.executeWall(userId, Math.random().toString(), data.x, data.y, data.isHorizontal);
      });
      
      socket.on('surrender', (data: any) => {
        const roomId = typeof data === 'string' ? data : (data?.roomId || data?.matchId);
        if (roomId) {
          const game = this.gameService.getGame(roomId);
          if (game) {
            game.surrender(userId);
          }
        }
      });

      socket.on('requestRematch', (data: { roomId: string }) => {
        const roomId = data.roomId;
        if (!roomId) return;

        if (!this.rematchRequests.has(roomId)) {
          this.rematchRequests.set(roomId, new Set());
        }
        const requests = this.rematchRequests.get(roomId)!;
        requests.add(userId);

        const room = this.roomService.getRoom(roomId);
        const players = (room && room.players && room.players.length > 0)
          ? room.players
          : (this.lastMatchPlayers.get(roomId) || []);

        gameNs.to(roomId).emit('rematchRequested', { requesterId: userId, requesterName: username, count: requests.size });

        const requiredPlayers = players.length > 0 ? players.length : 2;

        if (requests.size >= requiredPlayers) {
          this.rematchRequests.delete(roomId);

          if (players.length >= 2) {
            const host = players[0];
            const newRoom = this.roomService.createRoom(
              host.id,
              host.username,
              host.isGuest,
              room ? room.name : `Sala de ${host.username}`,
              room ? room.mode : '1v1',
              true
            );
            for (let i = 1; i < players.length; i++) {
              this.roomService.joinRoom(newRoom.id, players[i].id, players[i].username, players[i].isGuest);
            }
            newRoom.status = RoomStatus.PLAYING;
            this.lastMatchPlayers.set(newRoom.id, [...newRoom.players]);
            this.gameService.createGame(newRoom.id, newRoom.mode, newRoom.players);

            gameNs.to(roomId).emit('gameStarting', { matchId: newRoom.id });
            this.io.of('/matchmaking').to(roomId).emit('gameStarting', { matchId: newRoom.id });
          }
        }
      });

      socket.on('cancelRematch', (data: { roomId: string }) => {
        const roomId = data.roomId;
        if (roomId && this.rematchRequests.has(roomId)) {
          this.rematchRequests.delete(roomId);
        }
        gameNs.to(roomId).emit('rematchDeclined', { declinerName: username });
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

      socket.on('emote', (data: { roomId: string, emoteId: string }) => {
        gameNs.to(data.roomId).emit('emote', { sender: username, emoteId: data.emoteId });
      });

      socket.on('send_emote', (data: { roomId: string, emoji: string }) => {
        gameNs.to(data.roomId).emit('emote', { sender: username, emoteId: data.emoji });
      });
    });
  }
}
