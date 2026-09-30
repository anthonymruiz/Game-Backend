import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';
import { UserRole } from '../models/user-role.enum.js';

export async function seedSuperAdmin(): Promise<void> {
  try {
    const userRepo = AppDataSource.getRepository(User);
    
    // Check if superAdmin user "admin" already exists
    const existingAdmin = await userRepo.findOne({
      where: [{ username: 'admin' }, { role: UserRole.SUPERADMIN }]
    });

    if (!existingAdmin) {
      console.log('[SEED] Creating default superAdmin user ("admin" / "admin")...');
      
      const hashedPassword = await bcrypt.hash('admin', 10);
      
      const superAdmin = new User();
      superAdmin.username = 'admin';
      superAdmin.email = 'admin@gamename.com';
      superAdmin.password = hashedPassword;
      superAdmin.role = UserRole.SUPERADMIN;
      superAdmin.provider = 'local';
      superAdmin.hasUsernameSet = true;
      superAdmin.preferences = new Preferences();
      superAdmin.stats = new Stats();

      await userRepo.save(superAdmin);
      console.log('[SEED] Default SuperAdmin created successfully!');
    } else {
      console.log('[SEED] SuperAdmin already exists.');
    }
  } catch (error) {
    console.error('[SEED] Error seeding SuperAdmin:', error);
  }
}

export async function seedLeaderboardUsers(): Promise<void> {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const totalUsers = await userRepo.count();

    if (totalUsers < 5) {
      console.log('[SEED] Seeding leaderboard test users...');
      const hashedPassword = await bcrypt.hash('password123', 10);

      const mockUsers = [
        { username: 'VortexMaster', wins: 142, losses: 18, draws: 5, elo: 2450, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Vortex' },
        { username: 'ShadowStriker', wins: 128, losses: 22, draws: 3, elo: 2310, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Shadow' },
        { username: 'ApexLegend', wins: 115, losses: 30, draws: 8, elo: 2180, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Apex' },
        { username: 'CyberKnight', wins: 98, losses: 25, draws: 4, elo: 2050, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Cyber' },
        { username: 'NeonSpectre', wins: 87, losses: 35, draws: 6, elo: 1940, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Neon' },
        { username: 'PixelKing', wins: 76, losses: 29, draws: 2, elo: 1860, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Pixel' },
        { username: 'TitanBrawler', wins: 69, losses: 41, draws: 7, elo: 1750, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Titan' },
        { username: 'QuantumGhost', wins: 58, losses: 33, draws: 4, elo: 1680, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Quantum' },
        { username: 'EchoSniper', wins: 50, losses: 40, draws: 1, elo: 1590, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Echo' },
        { username: 'ZeroAbsolute', wins: 44, losses: 38, draws: 5, elo: 1510, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zero' },
        { username: 'NovaBlade', wins: 38, losses: 42, draws: 3, elo: 1420, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nova' },
        { username: 'StormRider', wins: 29, losses: 35, draws: 2, elo: 1350, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Storm' },
        { username: 'AlphaOmega', wins: 22, losses: 28, draws: 4, elo: 1280, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alpha' },
        { username: 'BlazeInferno', wins: 15, losses: 20, draws: 1, elo: 1190, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Blaze' },
        { username: 'RookieChamp', wins: 8, losses: 12, draws: 0, elo: 1080, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Rookie' }
      ];

      for (const m of mockUsers) {
        const u = new User();
        u.username = m.username;
        u.email = `${m.username.toLowerCase()}@gamename.com`;
        u.password = hashedPassword;
        u.role = UserRole.USER;
        u.provider = 'local';
        u.hasUsernameSet = true;
        u.avatarUrl = m.avatarUrl;
        u.preferences = new Preferences();

        const stats = new Stats();
        stats.wins = m.wins;
        stats.losses = m.losses;
        stats.draws = m.draws;
        stats.elo = m.elo;
        u.stats = stats;

        await userRepo.save(u);
      }
      console.log('[SEED] ✅ 15 Leaderboard test users created successfully!');
    }
  } catch (error) {
    console.error('[SEED] Error seeding leaderboard users:', error);
  }
}
