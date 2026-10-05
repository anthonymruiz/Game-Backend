import 'reflect-metadata';
import { AppDataSource } from '../config/database.config.js';
import { seedSuperAdmin, seedLeaderboardUsers, seedLevelProgressionConfig, seedRankTiers, seedRewardsSettings } from '../utils/seed.utils.js';
import { StoreItemService } from '../services/store-item.service.js';
import { container } from 'tsyringe';
import { seedBadges } from '../seeds/badges.seed.js';

async function runSeed() {
  try {
    console.log('[SEED SCRIPT] Initializing database connection...');
    await AppDataSource.initialize();
    await seedSuperAdmin();
    await seedLevelProgressionConfig();
    await seedRewardsSettings();
    await seedRankTiers();
    await seedLeaderboardUsers();
    await container.resolve(StoreItemService).seedDefaultItems();
    await seedBadges();
    console.log('[SEED SCRIPT] Seeding completed successfully.');
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('[SEED SCRIPT] Error during seeding:', error);
    process.exit(1);
  }
}

runSeed();
