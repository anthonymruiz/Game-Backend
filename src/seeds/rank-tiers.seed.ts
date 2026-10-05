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
    key: 'NOVATO', level: 1, emoji: '🔰', badgeBg: 'rgba(100, 116, 139, 0.35)', textColor: '#f1f5f9',
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
      es: { name: 'Recluta', description: 'Aprendes las bases del combate y te preparas para cada desafío.', motto: 'La disciplina forja al combatiente.' },
      en: { name: 'Recruit', description: 'You learn the basics of battle and prepare for every challenge.', motto: 'Discipline forges the fighter.' }
    }
  },
  {
    key: 'SOLDADO', level: 4, emoji: '🪖', badgeBg: 'rgba(34, 197, 94, 0.25)', textColor: '#86efac',
    configuration: {
      es: { name: 'Soldado', description: 'Ya estás listo para enfrentar rivales y luchar por la victoria.', motto: 'Avanza con valor y determinación.' },
      en: { name: 'Soldier', description: 'You are ready to face rivals and fight for victory.', motto: 'Move forward with courage.' }
    }
  },
  {
    key: 'ESTRATEGA', level: 5, emoji: '🔥', badgeBg: 'rgba(168, 85, 247, 0.25)', textColor: '#c084fc',
    configuration: {
      es: { name: 'Estratega', description: 'Anticipas las jugadas rivales y trazas planes para alcanzar la victoria.', motto: 'Piensa adelante, vence con estrategia.' },
      en: { name: 'Strategist', description: 'You anticipate your opponents’ moves and plan your route to victory.', motto: 'Think ahead. Turn plans into victories.' }
    }
  },
  {
    key: 'TACTICO', level: 6, emoji: '⚡', badgeBg: 'rgba(245, 158, 11, 0.25)', textColor: '#fbbf24',
    configuration: {
      es: { name: 'Táctico', description: 'Aprovechas cada oportunidad y adaptas tus tácticas durante la partida.', motto: 'La precisión decide cada partida.' },
      en: { name: 'Tactician', description: 'You seize every opportunity and adapt your tactics throughout the match.', motto: 'Precision decides who wins the game.' }
    }
  },
  {
    key: 'MAESTRO_MUROS', level: 7, emoji: '🎖️', badgeBg: 'rgba(249, 115, 22, 0.25)', textColor: '#fb923c',
    configuration: {
      es: { name: 'Maestro', description: 'Colocas muros con precisión y conviertes cada bloqueo en una ventaja.', motto: 'Cada muro abre un nuevo camino.' },
      en: { name: 'Master', description: 'You place walls with precision and turn every blockade into an advantage.', motto: 'Every wall opens a new path forward.' }
    }
  },
  {
    key: 'GRAN_MAESTRO', level: 8, emoji: '👑', badgeBg: 'rgba(236, 72, 153, 0.25)', textColor: '#f472b6',
    configuration: {
      es: { name: 'Gran Maestro', description: 'Combinas visión y experiencia para controlar el ritmo de la partida.', motto: 'Experiencia que domina cada desafío.' },
      en: { name: 'Grandmaster', description: 'You combine vision and experience to control the pace of the match.', motto: 'Experience that masters every challenge.' }
    }
  },
  {
    key: 'ELITE', level: 9, emoji: '🔮', badgeBg: 'rgba(14, 165, 233, 0.25)', textColor: '#38bdf8',
    configuration: {
      es: { name: 'Élite', description: 'Tu dominio del tablero te distingue entre los mejores jugadores.', motto: 'Solo los mejores dominan el tablero.' },
      en: { name: 'Elite', description: 'Your command of the board sets you apart among the best players.', motto: 'Only the best command the board.' }
    }
  },
  {
    key: 'CAMPEON', level: 10, emoji: '🏆', badgeBg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(234, 88, 12, 0.35))', textColor: '#fbbf24',
    configuration: {
      es: { name: 'Campeón', description: 'Has superado a grandes rivales y estás entre los aspirantes al título.', motto: 'Un paso más cerca de la gloria.' },
      en: { name: 'Champion', description: 'You have overcome formidable rivals and are a title contender.', motto: 'One victory away from lasting glory.' }
    }
  },
  {
    key: 'MITICO', level: 11, emoji: '🦄', badgeBg: 'linear-gradient(135deg, #a855f7, #ec4899)', textColor: '#f5d0fe',
    configuration: {
      es: { name: 'Mítico', description: 'Has alcanzado un nivel extraordinario que pocos pueden igualar.', motto: 'La leyenda se vuelve realidad.' },
      en: { name: 'Mythic', description: 'You have reached an extraordinary level few can match.', motto: 'Legend becomes reality.' }
    }
  },
  {
    key: 'GENIO', level: 12, emoji: '🧠', badgeBg: 'rgba(6, 182, 212, 0.25)', textColor: '#67e8f9',
    configuration: {
      es: { name: 'Genio', description: 'Tu ingenio convierte cada movimiento en una oportunidad.', motto: 'La mente abre todos los caminos.' },
      en: { name: 'Genius', description: 'Your brilliance turns every move into an opportunity.', motto: 'The mind opens every path.' }
    }
  },
  {
    key: 'CONQUISTADOR', level: 13, emoji: '🏹', badgeBg: 'rgba(239, 68, 68, 0.25)', textColor: '#fca5a5',
    configuration: {
      es: { name: 'Conquistador', description: 'Superas cada frontera y sometes el tablero a tu estrategia.', motto: 'Ningún desafío queda sin conquistar.' },
      en: { name: 'Conqueror', description: 'You cross every frontier and bring the board under your strategy.', motto: 'No challenge remains unconquered.' }
    }
  },
  {
    key: 'DOMINADOR', level: 14, emoji: '🔱', badgeBg: 'rgba(59, 130, 246, 0.25)', textColor: '#93c5fd',
    configuration: {
      es: { name: 'Dominador', description: 'Controlas la partida y marcas el ritmo de cada enfrentamiento.', motto: 'El tablero responde a tu voluntad.' },
      en: { name: 'Dominator', description: 'You control the match and set the pace of every encounter.', motto: 'The board answers to your will.' }
    }
  },
  {
    key: 'GENERAL', level: 15, emoji: '⚔️', badgeBg: 'rgba(100, 116, 139, 0.3)', textColor: '#e2e8f0',
    configuration: {
      es: { name: 'General', description: 'Lideras cada batalla con visión, firmeza y experiencia.', motto: 'La victoria sigue a quien lidera.' },
      en: { name: 'General', description: 'You lead every battle with vision, resolve, and experience.', motto: 'Victory follows the one who leads.' }
    }
  },
  {
    key: 'INMORTAL', level: 16, emoji: '♾️', badgeBg: 'rgba(14, 165, 233, 0.25)', textColor: '#7dd3fc',
    configuration: {
      es: { name: 'Inmortal', description: 'Tu nombre perdura y tu determinación nunca se quiebra.', motto: 'Tu legado no conoce final.' },
      en: { name: 'Immortal', description: 'Your name endures and your determination never breaks.', motto: 'Your legacy has no end.' }
    }
  },
  {
    key: 'CELESTIAL', level: 17, emoji: '🌌', badgeBg: 'linear-gradient(135deg, #312e81, #7c3aed)', textColor: '#c4b5fd',
    configuration: {
      es: { name: 'Celestial', description: 'Tu dominio trasciende el tablero y alcanza nuevas alturas.', motto: 'Más allá de todo límite.' },
      en: { name: 'Celestial', description: 'Your mastery transcends the board and reaches new heights.', motto: 'Beyond every limit.' }
    }
  },
  {
    key: 'DIVINO', level: 18, emoji: '☀️', badgeBg: 'linear-gradient(135deg, #f59e0b, #f97316)', textColor: '#ffedd5',
    configuration: {
      es: { name: 'Divino', description: 'Cada jugada revela una maestría digna de los dioses.', motto: 'La perfección ilumina el camino.' },
      en: { name: 'Divine', description: 'Every move reveals mastery worthy of the gods.', motto: 'Perfection lights the way.' }
    }
  },
  {
    key: 'ETERNO', level: 19, emoji: '✨', badgeBg: 'linear-gradient(135deg, #0f172a, #6366f1)', textColor: '#e0e7ff',
    configuration: {
      es: { name: 'Eterno', description: 'Has llegado a la cima y tu leyenda vivirá para siempre.', motto: 'La grandeza no tiene final.' },
      en: { name: 'Eternal', description: 'You have reached the summit and your legend will live forever.', motto: 'Greatness has no end.' }
    }
  },
  {
    key: 'LEGENDARIO', level: 20, emoji: '💎', badgeBg: 'linear-gradient(135deg, #ef4444, #dc2626)', textColor: '#ffffff',
    configuration: {
      es: { name: 'Legendario', description: 'Alcanzaste la cima: tu nombre queda grabado entre las leyendas.', motto: 'Guerrero legendario, nivel máximo.' },
      en: { name: 'Legendary', description: 'You have reached the summit: your name is written among the legends.', motto: 'Legendary warrior at the highest level.' }
    }
  }
];

export function createDefaultRankTier(rank: IDefaultRankTier): RankTier {
  return Object.assign(new RankTier(), rank);
}
