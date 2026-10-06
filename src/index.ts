import 'reflect-metadata';
import { container } from 'tsyringe';
import { createServer } from 'http';
import { App } from './app.js';
import { AppDataSource } from './config/database.config.js';
import { ENV } from './config/env.config.js';
import { SocketManager } from './socket/socket.manager.js';
import { RedisService } from './services/redis.service.js';
import { startWeeklyRewardsScheduler } from './services/weekly-rewards.service.js';
import { seedSuperAdmin, seedLeaderboardUsers, seedSystemSettings, seedReports, seedMatchHistory, seedLevelProgressionConfig, seedRankTiers, seedRewardsSettings } from './utils/seed.utils.js';
import { seedBadges } from './seeds/badges.seed.js';

process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

async function bootstrap() {
  try {
    const runStartupStage = async (name: string, action: () => Promise<unknown>): Promise<void> => {
      const startedAt = Date.now();
      await action();
      console.log(`[BOOT] ${name} completed in ${Date.now() - startedAt}ms.`);
    };

    await runStartupStage('Database initialization and schema synchronization', () => AppDataSource.initialize());
    console.log('Database connection established successfully.');

    await runStartupStage('User seeds', async () => {
      await seedSuperAdmin();
      await seedLeaderboardUsers();
    });
    await runStartupStage('Configuration seeds', () => Promise.all([
      seedLevelProgressionConfig(),
      seedRewardsSettings(),
      seedRankTiers(),
      seedSystemSettings()
    ]));
    await runStartupStage('Sample data and badge seeds', () => Promise.all([
      seedReports(),
      seedMatchHistory(),
      seedBadges()
    ]));
    startWeeklyRewardsScheduler();

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
