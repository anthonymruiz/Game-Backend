import { injectable } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { LevelProgressionConfig } from '../models/level-progression-config.entity.js';

export interface ILevelProgressionConfig {
  baseXpPerLevel: number;
  exponentialMultiplier: number;
  maxLevel: number;
}

export const DEFAULT_LEVEL_PROGRESSION_CONFIG: ILevelProgressionConfig = {
  baseXpPerLevel: 10,
  exponentialMultiplier: 1.0493,
  maxLevel: 100
};

@injectable()
export class LevelProgressionService {
  private get repository() {
    return AppDataSource.getRepository(LevelProgressionConfig);
  }

  public async getConfiguration(): Promise<ILevelProgressionConfig> {
    const record = await this.repository.findOne({ where: { singletonKey: 1 } });
    if (!record) {
      throw new Error('Level progression configuration has not been seeded.');
    }
    return this.toConfiguration(record);
  }

  public async updateConfiguration(
    input: Partial<ILevelProgressionConfig>
  ): Promise<ILevelProgressionConfig> {
    const record = await this.repository.findOne({ where: { singletonKey: 1 } });
    if (!record) {
      throw new Error('Level progression configuration has not been seeded.');
    }

    const baseXpPerLevel = this.validateInteger(input.baseXpPerLevel, record.baseXpPerLevel, 'baseXpPerLevel', 1);
    const exponentialMultiplier = input.exponentialMultiplier === undefined
      ? record.exponentialMultiplier
      : Number(input.exponentialMultiplier);

    if (!Number.isFinite(exponentialMultiplier) || exponentialMultiplier <= 1 || exponentialMultiplier > 2) {
      throw new Error('exponentialMultiplier must be greater than 1 and at most 2.');
    }

    record.baseXpPerLevel = baseXpPerLevel;
    record.exponentialMultiplier = exponentialMultiplier;
    record.maxLevel = DEFAULT_LEVEL_PROGRESSION_CONFIG.maxLevel;

    return this.toConfiguration(await this.repository.save(record));
  }

  private validateInteger(value: unknown, current: number, name: string, minimum: number): number {
    if (value === undefined) return current;
    if (value === null) {
      throw new Error(`${name} must be an integer between ${minimum} and 1000000.`);
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > 1_000_000) {
      throw new Error(`${name} must be an integer between ${minimum} and 1000000.`);
    }
    return parsed;
  }

  private toConfiguration(record: LevelProgressionConfig): ILevelProgressionConfig {
    return {
      baseXpPerLevel: record.baseXpPerLevel,
      exponentialMultiplier: Number(record.exponentialMultiplier),
      maxLevel: record.maxLevel
    };
  }
}

export function getTotalXpForLevel(level: number, config: ILevelProgressionConfig): number {
  if (level <= 1) return 0;
  const step = Math.min(level, config.maxLevel) - 1;
  return Math.round(
    config.baseXpPerLevel *
    (Math.pow(config.exponentialMultiplier, step) - 1) /
    (config.exponentialMultiplier - 1)
  );
}

export function getLevelProgress(xp: number, config: ILevelProgressionConfig) {
  const totalXp = Math.max(0, Math.floor(xp));
  let level = 1;
  for (let candidate = 2; candidate <= config.maxLevel; candidate++) {
    if (totalXp < getTotalXpForLevel(candidate, config)) break;
    level = candidate;
  }

  const currentLevelXp = getTotalXpForLevel(level, config);
  const nextLevelXp = level >= config.maxLevel ? currentLevelXp : getTotalXpForLevel(level + 1, config);
  const xpIntoLevel = totalXp - currentLevelXp;
  const xpForLevel = nextLevelXp - currentLevelXp;

  return {
    level,
    currentLevelXp,
    nextLevelXp,
    xpToNextLevel: level >= config.maxLevel ? 0 : Math.max(0, nextLevelXp - totalXp),
    levelProgressPercent: level >= config.maxLevel || xpForLevel <= 0
      ? 100
      : Math.min(100, Math.max(0, Math.round(xpIntoLevel / xpForLevel * 100))),
    isMaxLevel: level >= config.maxLevel
  };
}
