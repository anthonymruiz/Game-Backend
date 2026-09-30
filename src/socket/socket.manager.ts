import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server as HttpServer } from 'http';
import { singleton, inject } from 'tsyringe';
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

      socket.join(userId);
      this.updateUserPresence(userId, true, PresenceStatus.ONLINE);

      // Send available public rooms on connect
      socket.emit('publicRooms', this.roomService.getPublicRooms());

      socket.on('getPublicRooms', () => {
        socket.emit('publicRooms', this.roomService.getPublicRooms());
      });

      socket.on('joinQueue', (mode: GameMode | string) => {
        try {
          const gameMode: GameMode = (mode as GameMode) || '1v1';
          const publicRooms = this.roomService.getPublicRooms();
          const openRoom = publicRooms.find(r => r.mode === gameMode && r.players.length < r.maxPlayers);

          if (openRoom) {
            const room = this.roomService.joinRoom(openRoom.id, userId, username, isGuest);
            socket.join(room.id);
            socket.emit('joinedByCodeSuccess', room);
            matchmakingNs.to(room.id).emit('roomUpdated', room);
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());

            if (room.players.length >= room.maxPlayers) {
              room.status = RoomStatus.PLAYING;
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
              false
            );
            socket.join(room.id);
            socket.emit('roomCreated', room);
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
          }
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('createRoom', (data: { name: string; mode: GameMode; isPrivate: boolean }) => {
        try {
          const room = this.roomService.createRoom(
            userId,
            username,
            isGuest,
            data.name,
            data.mode,
            data.isPrivate
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
          const room = this.roomService.joinRoom(data.roomId, userId, username, isGuest);
          socket.join(room.id);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());

          if (room.players.length >= room.maxPlayers) {
            room.status = RoomStatus.PLAYING;
            this.gameService.createGame(room.id, room.mode, room.players);
            matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
          }
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('joinByCode', (data: { code: string }) => {
        try {
          const targetRoom = this.roomService.getRoomByCode(data.code);
          if (!targetRoom) throw new Error('No room found with this code.');
          const room = this.roomService.joinRoom(targetRoom.id, userId, username, isGuest);
          socket.join(room.id);
          socket.emit('joinedByCodeSuccess', room);
          matchmakingNs.to(room.id).emit('roomUpdated', room);
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());

          if (room.players.length >= room.maxPlayers) {
            room.status = RoomStatus.PLAYING;
            this.gameService.createGame(room.id, room.mode, room.players);
            matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
            matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
          }
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
          matchmakingNs.to(data.roomId).emit('roomCancelled', { message: 'Lobby was cancelled by the host.' });
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('selectColor', (data: { roomId: string; color: string }) => {
        try {
          const room = this.roomService.selectPlayerColor(data.roomId, userId, data.color);
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
          if (room.players.length < 2) throw new Error('Need at least 2 players to start game');

          room.status = RoomStatus.PLAYING;
          this.gameService.createGame(room.id, room.mode, room.players);
          
          matchmakingNs.to(room.id).emit('gameStarting', { matchId: room.id });
          matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
        } catch (err: any) {
          socket.emit('error', err.message);
        }
      });

      socket.on('leaveCustomRoom', (data: { roomId: string }) => {
        const room = this.roomService.leaveRoom(data.roomId, userId);
        if (room) {
          matchmakingNs.to(room.id).emit('roomUpdated', room);
        }
        matchmakingNs.emit('publicRooms', this.roomService.getPublicRooms());
      });

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
        socket.join(roomId);
        this.updateUserPresence(userId, true, PresenceStatus.PLAYING);
        const game = this.gameService.getGame(roomId);
        if (game) {
          if (game.state === 'finished') {
            socket.emit('gameFinished', { winner: game.winner, alreadyFinished: true });
          } else {
            socket.emit('gameStarted', { currentTurn: game.playersList[game.currentTurnIndex], board: game.board });
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
    });
  }
}
