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
  { level: 1, key: RankLevel.NOVATO, minPoints: 0, maxPoints: 100 },
  { level: 2, key: RankLevel.APRENDIZ, minPoints: 100, maxPoints: 250 },
  { level: 3, key: RankLevel.INICIADO, minPoints: 250, maxPoints: 500 },
  { level: 4, key: RankLevel.ESTRATEGA, minPoints: 500, maxPoints: 850 },
  { level: 5, key: RankLevel.TACTICO, minPoints: 850, maxPoints: 1300 },
  { level: 6, key: RankLevel.MAESTRO_MUROS, minPoints: 1300, maxPoints: 1850 },
  { level: 7, key: RankLevel.GRAN_MAESTRO, minPoints: 1850, maxPoints: 2500 },
  { level: 8, key: RankLevel.ELITE, minPoints: 2500, maxPoints: 3200 },
  { level: 9, key: RankLevel.CAMPEON, minPoints: 3200, maxPoints: 4000 },
  { level: 10, key: RankLevel.LEGENDARIO, minPoints: 4000, maxPoints: 4000 }
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
