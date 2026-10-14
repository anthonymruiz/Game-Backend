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
import { storeRoutes } from './routes/store.routes.js';
import { broadcastLog } from './utils/logger.utils.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.config.js';
import { ENV } from './config/env.config.js';
import { apiRateLimiter, authRateLimiter } from './middlewares/rate-limit.middleware.js';

import { isAllowedOrigin } from './utils/cors.util.js';

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
    this.expressApp.use(cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS not allowed'));
        }
      },
      credentials: true
    }));

    this.expressApp.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false }));
    this.expressApp.use('/api/store/stripe/webhook', express.raw({ type: 'application/json' }));
    this.expressApp.use(express.json({ limit: '10kb' }));
    this.expressApp.use(express.urlencoded({ extended: true, limit: '10kb' }));

    this.expressApp.use('/api', apiRateLimiter);
    this.expressApp.use('/api/auth', authRateLimiter);
  }

  private initializeRoutes(): void {
    this.expressApp.use('/api/auth', authRouter);
    this.expressApp.use('/api/users', userRoutes);
    this.expressApp.use('/api/store', storeRoutes);
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
      if (err.type === 'entity.too.large' || err.status === 413) {
        res.status(413).json({ error: 'Payload too large. Maximum size is 10kb.' });
        return;
      }
      if (err.message === 'CORS not allowed') {
        res.status(403).json({ error: 'CORS not allowed' });
        return;
      }
      res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
    });
  }
}
