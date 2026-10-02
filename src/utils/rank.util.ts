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
  minPoints: number;
  maxPoints: number;
}

export const RANK_TIERS: IRankTier[] = [
  { level: 1, key: RankLevel.NOVATO, minPoints: 0, maxPoints: 50 },
  { level: 2, key: RankLevel.APRENDIZ, minPoints: 50, maxPoints: 120 },
  { level: 3, key: RankLevel.INICIADO, minPoints: 120, maxPoints: 220 },
  { level: 4, key: RankLevel.ESTRATEGA, minPoints: 220, maxPoints: 350 },
  { level: 5, key: RankLevel.TACTICO, minPoints: 350, maxPoints: 500 },
  { level: 6, key: RankLevel.MAESTRO_MUROS, minPoints: 500, maxPoints: 700 },
  { level: 7, key: RankLevel.GRAN_MAESTRO, minPoints: 700, maxPoints: 950 },
  { level: 8, key: RankLevel.ELITE, minPoints: 950, maxPoints: 1250 },
  { level: 9, key: RankLevel.CAMPEON, minPoints: 1250, maxPoints: 1600 },
  { level: 10, key: RankLevel.LEGENDARIO, minPoints: 1600, maxPoints: 1600 }
];

export function getRankInfo(wins: number) {
  const points = Math.max(0, wins * 10);
  let currentTier = RANK_TIERS[0];
  let nextTier: IRankTier | null = RANK_TIERS[1];

  for (let i = 0; i < RANK_TIERS.length; i++) {
    const tier = RANK_TIERS[i];
    if (points >= tier.minPoints) {
      currentTier = tier;
      nextTier = i < RANK_TIERS.length - 1 ? RANK_TIERS[i + 1] : null;
    }
  }

  const isMaxLevel = currentTier.level === 10;
  const targetPoints = nextTier ? nextTier.minPoints : currentTier.minPoints;
  const pointsToNextRank = isMaxLevel ? 0 : Math.max(0, targetPoints - points);
  
  const pointsInCurrentTier = points - currentTier.minPoints;
  const tierSpan = targetPoints - currentTier.minPoints;
  const progressPercent = isMaxLevel ? 100 : Math.min(100, Math.max(0, Math.round((pointsInCurrentTier / tierSpan) * 100)));

  return {
    level: currentTier.level,
    rankKey: currentTier.key,
    nextRankKey: nextTier ? nextTier.key : currentTier.key,
    points,
    minPoints: currentTier.minPoints,
    targetPoints,
    pointsToNextRank,
    progressPercent,
    isMaxLevel
  };
}
