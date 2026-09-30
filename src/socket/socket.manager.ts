import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server as HttpServer } from 'http';
import { injectable, singleton } from 'tsyringe';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.config.js';

@singleton()
export class SocketManager {
  public io!: Server;
  
  public async initialize(httpServer: HttpServer): Promise<void> {
    this.io = new Server(httpServer, {
      cors: {
        origin: '*', // We'll restrict this in production
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
    // Matchmaking Namespace
    const matchmakingNs = this.io.of('/matchmaking');
    matchmakingNs.on('connection', (socket: Socket) => {
      console.log(`User ${socket.data.user.username} connected to Matchmaking`);
      
      socket.on('disconnect', () => {
        console.log(`User ${socket.data.user.username} disconnected from Matchmaking`);
      });
    });

    // Game Rooms Namespace
    const gameNs = this.io.of('/game');
    gameNs.on('connection', (socket: Socket) => {
      console.log(`User ${socket.data.user.username} connected to Game Rooms`);
      
      socket.on('joinRoom', (roomId: string) => {
        socket.join(roomId);
        gameNs.to(roomId).emit('message', `User ${socket.data.user.username} joined room ${roomId}`);
      });
    });
  }
}
