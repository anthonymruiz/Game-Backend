import 'reflect-metadata';
import { container } from 'tsyringe';
import { createServer } from 'http';
import { App } from './app.js';
import { AppDataSource } from './config/database.config.js';
import { ENV } from './config/env.config.js';
import { SocketManager } from './socket/socket.manager.js';
import { RedisService } from './services/redis.service.js';
import { seedSuperAdmin, seedLeaderboardUsers } from './utils/seed.utils.js';

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established successfully.');

    await seedSuperAdmin();
    await seedLeaderboardUsers();

    const redisService = container.resolve(RedisService);
    await redisService.connect();

    const appInstance = container.resolve(App);
    const httpServer = createServer(appInstance.expressApp);

    const socketManager = container.resolve(SocketManager);
    await socketManager.initialize(httpServer);
    
    httpServer.listen(ENV.PORT, () => {
      console.log(`Server and WebSockets are running on port ${ENV.PORT}`);
    });
  } catch (error) {
    console.error('Error during bootstrap:', error);
    process.exit(1);
  }
}

bootstrap();
