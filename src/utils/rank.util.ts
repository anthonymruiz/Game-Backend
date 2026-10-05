export enum RankLevel {
  NOVATO = 'NOVATO',
  APRENDIZ = 'APRENDIZ',
  INICIADO = 'INICIADO',
  ESTRATEGA = 'ESTRATEGA',
  TACTICO = 'TACTICO',
  MAESTRO_MUROS = 'MAESTRO_MUROS',
  GRAN_MAESTRO = 'GRAN_MAESTRO',
  ELITE = 'ELITE',
  CAMPEON = 'CAMPEON',
  LEGENDARIO = 'LEGENDARIO'
}

export interface IRankTier {
  level: number;
  key: RankLevel;
  minXp: number;
  maxXp: number;
}

const DEFAULT_MAX_LEVEL_XP = Math.round(
  10 * (Math.pow(1.0493, 99) - 1) / (1.0493 - 1)
);

export const RANK_TIERS: IRankTier[] = Object.values(RankLevel).map((key, index, tiers) => ({
  level: index + 1,
  key,
  minXp: index === 0 ? 0 : Math.round(index * DEFAULT_MAX_LEVEL_XP / tiers.length),
  maxXp: Math.round((index + 1) * DEFAULT_MAX_LEVEL_XP / tiers.length)
}));

export function getRankInfo(totalXp: number) {
  const xp = Math.max(0, Math.floor(totalXp));
  let currentTier = RANK_TIERS[0];
  let nextTier: IRankTier | null = RANK_TIERS[1];

  for (let i = 0; i < RANK_TIERS.length; i++) {
    const tier = RANK_TIERS[i];
    if (xp >= tier.minXp) {
      currentTier = tier;
      nextTier = i < RANK_TIERS.length - 1 ? RANK_TIERS[i + 1] : null;
    }
  }

  const isMaxLevel = currentTier.level === 10;
  const targetXp = nextTier ? nextTier.minXp : currentTier.maxXp;
  const xpToNextRank = isMaxLevel ? 0 : Math.max(0, targetXp - xp);
  
  const xpInCurrentTier = xp - currentTier.minXp;
  const tierSpan = targetXp - currentTier.minXp;
  const progressPercent = isMaxLevel ? 100 : Math.min(100, Math.max(0, Math.round((xpInCurrentTier / tierSpan) * 100)));

  return {
    level: currentTier.level,
    rankKey: currentTier.key,
    nextRankKey: nextTier ? nextTier.key : currentTier.key,
    xp,
    minXp: currentTier.minXp,
    targetXp,
    xpToNextRank,
    progressPercent,
    isMaxLevel
  };
}
