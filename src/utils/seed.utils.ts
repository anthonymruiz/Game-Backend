import bcrypt from 'bcryptjs';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';
import { UserRole } from '../models/user-role.enum.js';
import { LevelProgressionConfig } from '../models/level-progression-config.entity.js';
import { DEFAULT_LEVEL_PROGRESSION_CONFIG } from '../services/level-progression.service.js';
import { RankTier } from '../models/rank-tier.entity.js';
import { DEFAULT_RANK_TIERS, createDefaultRankTier } from '../seeds/rank-tiers.seed.js';
import { RewardsSettings } from '../models/rewards-settings.entity.js';
import { DEFAULT_REWARDS_SETTINGS } from '../services/rewards-settings.service.js';
import { DEFAULT_SYSTEM_SETTINGS } from '../services/system-settings.service.js';

export async function seedLevelProgressionConfig(): Promise<void> {
  const repository = AppDataSource.getRepository(LevelProgressionConfig);
  const existing = await repository.findOne({ where: { singletonKey: 1 } });
  if (existing) {
    if (existing.maxLevel !== DEFAULT_LEVEL_PROGRESSION_CONFIG.maxLevel) {
      existing.maxLevel = DEFAULT_LEVEL_PROGRESSION_CONFIG.maxLevel;
      await repository.save(existing);
    }
    return;
  }

  await repository.save(repository.create({
    singletonKey: 1,
    ...DEFAULT_LEVEL_PROGRESSION_CONFIG
  }));
  console.log('[SEED] Default level progression configuration created.');
}

export async function seedRewardsSettings(): Promise<void> {
  const repository = AppDataSource.getRepository(RewardsSettings);
  const existing = await repository.findOne({ where: { singletonKey: 1 } });
  if (existing) {
    const rewardFields = [
      'pointsPerWin',
      'rankedPointsPerWin',
      'dailyRewardPoints',
      'pointsPerLevelUp',
      'pointsPerRankUp',
      'pointsPerBadge',
      'weeklyFirstPlacePoints',
      'weeklySecondPlacePoints',
      'weeklyThirdPlacePoints'
    ] as const;
    let changed = false;
    for (const field of rewardFields) {
      if (existing[field] < 1) {
        existing[field] = DEFAULT_REWARDS_SETTINGS[field];
        changed = true;
      }
    }
    if (changed) await repository.save(existing);
    return;
  }
  await repository.save(repository.create({ singletonKey: 1, ...DEFAULT_REWARDS_SETTINGS }));
  console.log('[SEED] Default rewards settings created.');
}

export async function seedRankTiers(): Promise<void> {
  const repository = AppDataSource.getRepository(RankTier);
  const existing = await repository.find({ order: { level: 'ASC' } });
  if (existing.length === 0) {
    await repository.save(DEFAULT_RANK_TIERS.map(createDefaultRankTier));
    console.log('[SEED] Default rank tiers created.');
    return;
  }

  const existingByKey = new Map(existing.map(rank => [rank.key, rank]));
  const missingDefaults = DEFAULT_RANK_TIERS.filter(rank => !existingByKey.has(rank.key));
  const novice = existingByKey.get('NOVATO');
  if (novice?.emoji === '🌱') novice.emoji = '🔰';
  const recruit = existingByKey.get('INICIADO');
  if (recruit?.configuration.es.name === 'Iniciado' && recruit.configuration.en.name === 'Adept') {
    recruit.configuration = {
      ...recruit.configuration,
      es: { ...recruit.configuration.es, name: 'Recluta' },
      en: { ...recruit.configuration.en, name: 'Recruit' }
    };
  }

  const updatedLegacyDefaults = [novice, recruit].filter((rank): rank is RankTier => !!rank);
  if (missingDefaults.length === 0) {
    if (updatedLegacyDefaults.length > 0) await repository.save(updatedLegacyDefaults);
    return;
  }

  await AppDataSource.transaction(async manager => {
    const transactionRepository = manager.getRepository(RankTier);
    const customRanks = existing.filter(rank => !DEFAULT_RANK_TIERS.some(defaultRank => defaultRank.key === rank.key));
    const orderedRanks = DEFAULT_RANK_TIERS.map(defaultRank =>
      existingByKey.get(defaultRank.key) ?? transactionRepository.create(createDefaultRankTier(defaultRank))
    ).concat(customRanks);

    for (const [index, rank] of orderedRanks.entries()) {
      rank.level = -(index + 1);
    }
    await transactionRepository.save(orderedRanks);

    for (const [index, rank] of orderedRanks.entries()) {
      rank.level = index + 1;
    }
    await transactionRepository.save(orderedRanks);
  });
  console.log(`[SEED] Added ${missingDefaults.length} default rank tier(s).`);
}

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
    const testUserExists = await userRepo.findOne({ where: { username: 'VortexMaster' } });

    if (!testUserExists) {
      console.log('[SEED] Seeding 15 leaderboard test users...');
      const hashedPassword = await bcrypt.hash('password123', 10);

      const mockUsers = [
        { username: 'VortexMaster', wins: 142, losses: 18, draws: 5, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Vortex' },
        { username: 'ShadowStriker', wins: 128, losses: 22, draws: 3, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Shadow' },
        { username: 'ApexLegend', wins: 115, losses: 30, draws: 8, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Apex' },
        { username: 'CyberKnight', wins: 98, losses: 25, draws: 4, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Cyber' },
        { username: 'NeonSpectre', wins: 87, losses: 35, draws: 6, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Neon' },
        { username: 'PixelKing', wins: 76, losses: 29, draws: 2, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Pixel' },
        { username: 'TitanBrawler', wins: 69, losses: 41, draws: 7, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Titan' },
        { username: 'QuantumGhost', wins: 58, losses: 33, draws: 4, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Quantum' },
        { username: 'EchoSniper', wins: 50, losses: 40, draws: 1, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Echo' },
        { username: 'ZeroAbsolute', wins: 44, losses: 38, draws: 5, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zero' },
        { username: 'NovaBlade', wins: 38, losses: 42, draws: 3, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nova' },
        { username: 'StormRider', wins: 29, losses: 35, draws: 2, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Storm' },
        { username: 'AlphaOmega', wins: 22, losses: 28, draws: 4, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alpha' },
        { username: 'BlazeInferno', wins: 15, losses: 20, draws: 1, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Blaze' },
        { username: 'RookieChamp', wins: 8, losses: 12, draws: 0, avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Rookie' }
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
        stats.points = m.wins * 10;
        u.stats = stats;

        await userRepo.save(u);
      }
      console.log('[SEED] ✅ 15 Leaderboard test users created successfully!');
    }
  } catch (error) {
    console.error('[SEED] Error seeding leaderboard users:', error);
  }
}

export async function seedSystemSettings(): Promise<void> {
  try {
    const { SystemSettings } = await import('../models/system-settings.entity.js');
    const settingsRepo = AppDataSource.getRepository(SystemSettings);
    const existing = await settingsRepo.findOne({ where: {}, order: { createdAt: 'ASC' } });
    if (!existing) {
      console.log('[SEED] Creating default SystemSettings record...');
      const s = new SystemSettings();
      Object.assign(s, DEFAULT_SYSTEM_SETTINGS);
      await settingsRepo.save(s);
      console.log('[SEED] ✅ Default SystemSettings created successfully!');
    }
  } catch (error) {
    console.error('[SEED] Error seeding SystemSettings:', error);
  }
}
