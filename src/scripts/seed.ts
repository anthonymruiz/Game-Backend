import 'reflect-metadata';
import { AppDataSource } from '../config/database.config.js';
import { seedSuperAdmin, seedLeaderboardUsers, seedLevelProgressionConfig, seedRankTiers } from '../utils/seed.utils.js';
import { StoreItemService } from '../services/store-item.service.js';
import { container } from 'tsyringe';

async function runSeed() {
  try {
    console.log('[SEED SCRIPT] Initializing database connection...');
    await AppDataSource.initialize();
    await seedSuperAdmin();
    await seedLevelProgressionConfig();
    await seedRankTiers();
    await seedLeaderboardUsers();
    await container.resolve(StoreItemService).seedDefaultItems();
    console.log('[SEED SCRIPT] Seeding completed successfully.');
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('[SEED SCRIPT] Error during seeding:', error);
    process.exit(1);
  }
}

runSeed();
