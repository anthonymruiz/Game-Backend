import 'reflect-metadata';
import { AppDataSource } from '../config/database.config.js';
import { seedSuperAdmin, seedLeaderboardUsers } from '../utils/seed.utils.js';

async function runSeed() {
  try {
    console.log('[SEED SCRIPT] Initializing database connection...');
    await AppDataSource.initialize();
    await seedSuperAdmin();
    await seedLeaderboardUsers();
    console.log('[SEED SCRIPT] Seeding completed successfully.');
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('[SEED SCRIPT] Error during seeding:', error);
    process.exit(1);
  }
}

runSeed();
