import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { LevelProgressionConfig } from '../models/level-progression-config.entity.js';
import { getTotalXpForLevel } from './level-progression.service.js';
import { RankConfiguration, RankTier } from '../models/rank-tier.entity.js';

export interface IRankTierInput {
  id?: string;
  key: string;
  emoji: string;
  badgeBg: string;
  textColor: string;
  configuration: RankConfiguration;
}

export interface IRankTierResponse extends RankTier {
  minXp: number;
  maxXp: number;
}

export interface IRankInfoResponse {
  xp: number;
  rankKey: string;
  level: number;
  emoji: string;
  badgeBg: string;
  textColor: string;
  configuration: RankTier['configuration'];
  minXp: number;
  maxXp: number;
  nextRankKey: string;
  nextRankConfiguration: RankTier['configuration'] | null;
  targetXp: number;
  xpToNextRank: number;
  progressPercent: number;
  isMaxRank: boolean;
}

@injectable()
export class RankTierService {
  private get repository(): Repository<RankTier> {
    return AppDataSource.getRepository(RankTier);
  }

  public async getRanks(): Promise<IRankTierResponse[]> {
    const [ranks, progression] = await Promise.all([
      this.repository.find({ order: { level: 'ASC' } }),
      AppDataSource.getRepository(LevelProgressionConfig).findOne({ where: { singletonKey: 1 } }),
    ]);
    if (!progression) throw new Error('Level progression configuration has not been seeded.');

    const progressionConfig = {
      baseXpPerLevel: progression.baseXpPerLevel,
      exponentialMultiplier: Number(progression.exponentialMultiplier),
      pointsPerMatch: progression.pointsPerMatch,
      rankedPointsPerMatch: progression.rankedPointsPerMatch,
      pointsPerLevelUp: progression.pointsPerLevelUp,
      dailyRewardPoints: progression.dailyRewardPoints,
      maxLevel: progression.maxLevel,
    };
    const maxRankXp = getTotalXpForLevel(progression.maxLevel, progressionConfig);
    const xpPerRank = maxRankXp / Math.max(1, ranks.length);
    return ranks.map((rank, index) => ({
      ...rank,
      minXp: index === 0 ? 0 : Math.round(index * xpPerRank),
      maxXp: Math.round((index + 1) * xpPerRank),
    }));
  }

  public async getRankInfo(
    totalXp: number,
    configuredRanks?: IRankTierResponse[]
  ): Promise<IRankInfoResponse> {
    const ranks = configuredRanks ?? await this.getRanks();
    if (ranks.length === 0) {
      throw new Error('Rank tiers have not been seeded.');
    }

    const xp = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
    let currentIndex = 0;
    for (let index = 1; index < ranks.length; index++) {
      if (xp < ranks[index].minXp) break;
      currentIndex = index;
    }

    const current = ranks[currentIndex];
    const next = ranks[currentIndex + 1] ?? null;
    const targetXp = next?.minXp ?? current.maxXp;
    const xpInRank = Math.max(0, xp - current.minXp);
    const xpForRank = targetXp - current.minXp;
    const isMaxRank = next === null;

    return {
      xp,
      rankKey: current.key,
      level: current.level,
      emoji: current.emoji,
      badgeBg: current.badgeBg,
      textColor: current.textColor,
      configuration: current.configuration,
      minXp: current.minXp,
      maxXp: current.maxXp,
      nextRankKey: next?.key ?? current.key,
      nextRankConfiguration: next?.configuration ?? null,
      targetXp,
      xpToNextRank: isMaxRank ? 0 : Math.max(0, targetXp - xp),
      progressPercent:
        isMaxRank || xpForRank <= 0
          ? 100
          : Math.min(100, Math.max(0, Math.round((xpInRank / xpForRank) * 100))),
      isMaxRank,
    };
  }

  public async replaceRanks(input: unknown): Promise<IRankTierResponse[]> {
    const ranks = this.validateRanks(input);
    await AppDataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RankTier);
      const existing = await repository.find();
      const existingById = new Map(existing.map((rank) => [rank.id, rank]));
      const retainedIds = new Set<string>();
      if (existing.length > 0) {
        await repository
          .createQueryBuilder()
          .update(RankTier)
          .set({ level: () => '-level' })
          .execute();
      }

      const updated = ranks.map((item, index) => {
        const current = item.id ? existingById.get(item.id) : undefined;
        if (item.id && !current) throw new Error(`Rank ${item.key} was not found.`);
        if (current) retainedIds.add(current.id);

        return repository.create({
          ...(current ? { id: current.id, createdAt: current.createdAt } : {}),
          key: item.key,
          level: index + 1,
          emoji: item.emoji,
          badgeBg: item.badgeBg,
          textColor: item.textColor,
          configuration: item.configuration,
        });
      });

      await repository.save(updated);
      const removed = existing.filter((rank) => !retainedIds.has(rank.id));
      if (removed.length > 0) await repository.remove(removed);
    });

    return this.getRanks();
  }

  private validateRanks(value: unknown): IRankTierInput[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 34) {
      throw new Error('Ranks must contain between 1 and 34 entries.');
    }

    const keys = new Set<string>();
    const ids = new Set<string>();
    const emojis = new Set<string>();
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new Error(`Rank ${index + 1} is invalid.`);
      const rank = entry as Partial<IRankTierInput>;
      const key = typeof rank.key === 'string' ? rank.key.trim() : '';
      const emoji = typeof rank.emoji === 'string' ? rank.emoji.trim() : '';
      if (!key || key.length > 64 || !/^[A-Za-z0-9_-]+$/.test(key)) {
        throw new Error(`Rank ${index + 1} has an invalid key.`);
      }
      if (!emoji || emoji.length > 32) throw new Error(`Rank ${key} has an invalid emoji.`);
      if (keys.has(key)) throw new Error('Rank keys must be unique.');
      if (emojis.has(emoji)) throw new Error('Rank emojis must be unique.');
      keys.add(key);
      emojis.add(emoji);

      if (rank.id !== undefined) {
        if (typeof rank.id !== 'string' || !rank.id.trim() || ids.has(rank.id)) {
          throw new Error('Rank ids must be valid and unique.');
        }
        ids.add(rank.id);
      }

      return {
        id: rank.id,
        key,
        emoji,
        badgeBg: this.validateStyle(rank.badgeBg, `Rank ${key} badge background`),
        textColor: this.validateStyle(rank.textColor, `Rank ${key} text color`),
        configuration: this.validateConfiguration(rank.configuration, key),
      };
    });
  }

  private validateStyle(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 255) {
      throw new Error(`${field} is invalid.`);
    }
    return value.trim();
  }

  private validateConfiguration(value: unknown, key: string): RankConfiguration {
    if (!value || typeof value !== 'object')
      throw new Error(`Rank ${key} configuration is invalid.`);
    const configuration = value as Partial<RankConfiguration>;
    const localized = {} as RankConfiguration;
    for (const language of ['es', 'en'] as const) {
      const locale = configuration[language];
      if (!locale || typeof locale !== 'object') {
        throw new Error(`Rank ${key} is missing ${language} configuration.`);
      }
      const name = typeof locale.name === 'string' ? locale.name.trim() : '';
      const description = typeof locale.description === 'string' ? locale.description.trim() : '';
      const motto = typeof locale.motto === 'string' ? locale.motto.trim() : '';
      if (!name || name.length > 30)
        throw new Error(`Rank ${key} has an invalid ${language} name.`);
      if (!description || description.length > 500)
        throw new Error(`Rank ${key} has an invalid ${language} description.`);
      if (!motto || motto.length > 40)
        throw new Error(`Rank ${key} has an invalid ${language} motto.`);
      localized[language] = { name, description, motto };
    }
    return localized;
  }
}
