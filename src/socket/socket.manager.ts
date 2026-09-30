import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server as HttpServer } from 'http';
import { injectable, singleton, inject } from 'tsyringe';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.config.js';
import { MatchmakingService, GameMode } from '../services/matchmaking.service.js';

@singleton()
export class SocketManager {
  public io!: Server;

  constructor(@inject(MatchmakingService) private matchmakingService: MatchmakingService) {}
  
  public async initialize(httpServer: HttpServer): Promise<void> {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*', 
        methods: ['GET', 'POST']
      }
    });

    const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    this.io.adapter(createAdapter(pubClient, subClient));

    this.setupMiddlewares();
    this.setupNamespaces();
  }

  private setupMiddlewares(): void {
    this.io.use((socket: Socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }
      
      try {
        const decoded = jwt.verify(token, ENV.JWT_SECRET);
        socket.data.user = decoded;
        next();
      } catch (err) {
        next(new Error('Authentication error: Invalid token'));
      }
    });
  }

  private setupNamespaces(): void {
    const matchmakingNs = this.io.of('/matchmaking');
    matchmakingNs.on('connection', (socket: Socket) => {
      const user = socket.data.user;
      console.log(`User ${user.username} connected to Matchmaking`);
      
      socket.join(user.id);

      socket.on('joinQueue', async (mode: GameMode) => {
        try {
          const matchId = await this.matchmakingService.joinQueue(user.id, mode);
          if (matchId) {
            const players = await this.matchmakingService.getMatchPlayers(matchId);
            players.forEach(pId => {
              matchmakingNs.to(pId).emit('matchFound', { matchId });
            });
          } else {
            socket.emit('queueJoined', { mode });
          }
        } catch (error) {
          console.error(error);
          socket.emit('error', 'Failed to join queue');
        }
      });

      socket.on('leaveQueue', async (mode: GameMode) => {
        await this.matchmakingService.leaveQueue(user.id, mode);
        socket.emit('queueLeft', { mode });
      });

      socket.on('disconnect', async () => {
        console.log(`User ${user.username} disconnected from Matchmaking`);
        await this.matchmakingService.leaveQueue(user.id, '1v1');
        await this.matchmakingService.leaveQueue(user.id, '4way');
        await this.matchmakingService.leaveQueue(user.id, '2v2');
      });
    });

    const gameNs = this.io.of('/game');
    gameNs.on('connection', (socket: Socket) => {
      const user = socket.data.user;
      console.log(`User ${user.username} connected to Game Rooms`);
      
      socket.on('joinRoom', (roomId: string) => {
        socket.join(roomId);
        gameNs.to(roomId).emit('message', `User ${user.username} joined room ${roomId}`);
      });
      
      socket.on('chatMessage', (data: { roomId: string, message: string }) => {
        gameNs.to(data.roomId).emit('chatMessage', {
          sender: user.username,
          message: data.message,
          timestamp: new Date()
        });
      });

      socket.on('emote', (data: { roomId: string, emoteId: string }) => {
        gameNs.to(data.roomId).emit('emote', {
          sender: user.username,
          emoteId: data.emoteId
        });
      });
    });
  }
}
