import { RankTier, RankConfiguration } from '../models/rank-tier.entity.js';

export interface IDefaultRankTier {
  key: string;
  level: number;
  emoji: string;
  badgeBg: string;
  textColor: string;
  configuration: RankConfiguration;
}

export const DEFAULT_RANK_TIERS: IDefaultRankTier[] = [
  {
    key: 'NOVATO', level: 1, emoji: '🌱', badgeBg: 'rgba(100, 116, 139, 0.35)', textColor: '#f1f5f9',
    configuration: {
      es: { name: 'Novato', description: 'Estás comenzando tu camino. Aprende las reglas y da tus primeros pasos.', motto: 'Cada paso inicia una gran aventura.' },
      en: { name: 'Novice', description: 'Your journey is just beginning. Learn the rules and take your first steps.', motto: 'Every step begins a new adventure.' }
    }
  },
  {
    key: 'APRENDIZ', level: 2, emoji: '🛡️', badgeBg: 'rgba(37, 99, 235, 0.25)', textColor: '#60a5fa',
    configuration: {
      es: { name: 'Aprendiz', description: 'Ya conoces lo básico y empiezas a construir una estrategia.', motto: 'Aprende hoy; conquista el tablero ya.' },
      en: { name: 'Apprentice', description: 'You know the basics and are beginning to build a strategy.', motto: 'Learn now; conquer the board tomorrow.' }
    }
  },
  {
    key: 'INICIADO', level: 3, emoji: '🗡️', badgeBg: 'rgba(16, 185, 129, 0.25)', textColor: '#34d399',
    configuration: {
      es: { name: 'Iniciado', description: 'Tus decisiones son más seguras y empiezas a dominar el tablero.', motto: 'El dominio nace con cada jugada.' },
      en: { name: 'Adept', description: 'Your decisions are more confident, and you are starting to master the board.', motto: 'Mastery begins with every move.' }
    }
  },
  {
    key: 'ESTRATEGA', level: 4, emoji: '🔥', badgeBg: 'rgba(168, 85, 247, 0.25)', textColor: '#c084fc',
    configuration: {
      es: { name: 'Estratega', description: 'Anticipas las jugadas rivales y trazas planes para alcanzar la victoria.', motto: 'Piensa adelante, vence con estrategia.' },
      en: { name: 'Strategist', description: 'You anticipate your opponents’ moves and plan your route to victory.', motto: 'Think ahead. Turn plans into victories.' }
    }
  },
  {
    key: 'TACTICO', level: 5, emoji: '⚡', badgeBg: 'rgba(245, 158, 11, 0.25)', textColor: '#fbbf24',
    configuration: {
      es: { name: 'Táctico', description: 'Aprovechas cada oportunidad y adaptas tus tácticas durante la partida.', motto: 'La precisión decide cada partida.' },
      en: { name: 'Tactician', description: 'You seize every opportunity and adapt your tactics throughout the match.', motto: 'Precision decides who wins the game.' }
    }
  },
  {
    key: 'MAESTRO_MUROS', level: 6, emoji: '🎖️', badgeBg: 'rgba(249, 115, 22, 0.25)', textColor: '#fb923c',
    configuration: {
      es: { name: 'Maestro', description: 'Colocas muros con precisión y conviertes cada bloqueo en una ventaja.', motto: 'Cada muro abre un nuevo camino.' },
      en: { name: 'Master', description: 'You place walls with precision and turn every blockade into an advantage.', motto: 'Every wall opens a new path forward.' }
    }
  },
  {
    key: 'GRAN_MAESTRO', level: 7, emoji: '👑', badgeBg: 'rgba(236, 72, 153, 0.25)', textColor: '#f472b6',
    configuration: {
      es: { name: 'Gran Maestro', description: 'Combinas visión y experiencia para controlar el ritmo de la partida.', motto: 'Experiencia que domina cada desafío.' },
      en: { name: 'Grandmaster', description: 'You combine vision and experience to control the pace of the match.', motto: 'Experience that masters every challenge.' }
    }
  },
  {
    key: 'ELITE', level: 8, emoji: '🔮', badgeBg: 'rgba(14, 165, 233, 0.25)', textColor: '#38bdf8',
    configuration: {
      es: { name: 'Élite', description: 'Tu dominio del tablero te distingue entre los mejores jugadores.', motto: 'Solo los mejores dominan el tablero.' },
      en: { name: 'Elite', description: 'Your command of the board sets you apart among the best players.', motto: 'Only the best command the board.' }
    }
  },
  {
    key: 'CAMPEON', level: 9, emoji: '🏆', badgeBg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(234, 88, 12, 0.35))', textColor: '#fbbf24',
    configuration: {
      es: { name: 'Campeón', description: 'Has superado a grandes rivales y estás entre los aspirantes al título.', motto: 'Un paso más cerca de la gloria.' },
      en: { name: 'Champion', description: 'You have overcome formidable rivals and are a title contender.', motto: 'One victory away from lasting glory.' }
    }
  },
  {
    key: 'LEGENDARIO', level: 10, emoji: '💎', badgeBg: 'linear-gradient(135deg, #ef4444, #dc2626)', textColor: '#ffffff',
    configuration: {
      es: { name: 'Legendario', description: 'Alcanzaste la cima: tu nombre queda grabado entre las leyendas.', motto: 'Guerrero legendario, nivel máximo.' },
      en: { name: 'Legendary', description: 'You have reached the summit: your name is written among the legends.', motto: 'Legendary warrior at the highest level.' }
    }
  }
];

export function createDefaultRankTier(rank: IDefaultRankTier): RankTier {
  return Object.assign(new RankTier(), rank);
}
