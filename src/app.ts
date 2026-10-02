import 'reflect-metadata';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { injectable } from 'tsyringe';
import authRouter from './routes/auth.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { notificationRoutes } from './routes/notification.routes.js';
import { userRoutes } from './routes/user.routes.js';
import reportRouter from './routes/report.routes.js';
import roomRouter from './routes/room.routes.js';
import { friendRoutes } from './routes/friend.routes.js';
import { broadcastLog } from './utils/logger.utils.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.config.js';

@injectable()
export class App {
  public expressApp: Application;

  constructor() {
    this.expressApp = express();
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    this.expressApp.use(cors());
    this.expressApp.use(helmet({ contentSecurityPolicy: false }));
    this.expressApp.use(express.json());
  }

  private initializeRoutes(): void {
    this.expressApp.use('/api/auth', authRouter);
    this.expressApp.use('/api/users', userRoutes);
    this.expressApp.use('/api/admin', adminRoutes);
    this.expressApp.use('/api/notifications', notificationRoutes);
    this.expressApp.use('/api/reports', reportRouter);
    this.expressApp.use('/api/rooms', roomRouter);
    this.expressApp.use('/api/friends', friendRoutes);
    this.expressApp.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    this.expressApp.get('/health', (req, res) => {
      res.status(200).json({ status: 'OK' });
    });
    this.expressApp.use('/', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }

  private initializeErrorHandling(): void {
    this.expressApp.use((err: any, req: Request, res: Response, next: NextFunction) => {
      broadcastLog('error', `[${req.method}] ${req.url} - ${err.message || 'Unknown Error'}`);
      res.status(500).json({ error: 'Internal Server Error' });
    });
  }
}
