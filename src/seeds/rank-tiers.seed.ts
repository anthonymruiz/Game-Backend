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
      es: { name: 'Novato', description: 'Comienza tu viaje en el tablero. Descubre las mecánicas, afina tus instintos y prepárate para tus primeros triunfos.', motto: 'El primer paso hacia la grandeza.' },
      en: { name: 'Novice', description: 'Begin your journey across the board. Master the basics, sharpen your instincts, and claim your first victories.', motto: 'The first step toward greatness.' }
    }
  },
  {
    key: 'APRENDIZ', level: 2, emoji: '🛡️', badgeBg: 'rgba(37, 99, 235, 0.25)', textColor: '#60a5fa',
    configuration: {
      es: { name: 'Aprendiz', description: 'Empiezas a ver más allá de las jugadas simples. Cada partida fortalece tus reflejos y construye tu estilo táctico.', motto: 'Cada error forja una nueva victoria.' },
      en: { name: 'Apprentice', description: 'You start seeing beyond simple moves. Every match sharpens your reflexes and shapes your tactical style.', motto: 'Every mistake forges victory.' }
    }
  },
  {
    key: 'INICIADO', level: 3, emoji: '🗡️', badgeBg: 'rgba(16, 185, 129, 0.25)', textColor: '#34d399',
    configuration: {
      es: { name: 'Recluta', description: 'Templado en el fragor del juego, enfrentas la presión con disciplina y conviertes cada desafío en experiencia pura.', motto: 'El valor supera cualquier obstáculo.' },
      en: { name: 'Recruit', description: 'Tempered in the heat of competition, you face pressure with discipline and turn every challenge into pure skill.', motto: 'Courage overcomes all obstacles.' }
    }
  },
  {
    key: 'SOLDADO', level: 4, emoji: '🪖', badgeBg: 'rgba(34, 197, 94, 0.25)', textColor: '#86efac',
    configuration: {
      es: { name: 'Soldado', description: 'Un competidor aguerrido que no da un centímetro por perdido. Tu presencia en el tablero exige respeto a cada rival.', motto: 'Firme en la batalla, imparable al fin.' },
      en: { name: 'Soldier', description: 'A battle-hardened contender who never yields ground. Your presence on the board demands respect from any rival.', motto: 'Steadfast in battle, unstoppable.' }
    }
  },
  {
    key: 'ESTRATEGA', level: 5, emoji: '🔥', badgeBg: 'rgba(168, 85, 247, 0.25)', textColor: '#c084fc',
    configuration: {
      es: { name: 'Estratega', description: 'Anticipas los movimientos rivales mucho antes de que ocurran. Tu juego se basa en el cálculo y la astucia implacable.', motto: 'La mente ve antes de mover la pieza.' },
      en: { name: 'Strategist', description: 'You foresee enemy moves long before they happen. Your game relies on calculation and relentless cunning.', motto: 'The mind sees before moving.' }
    }
  },
  {
    key: 'TACTICO', level: 6, emoji: '⚡', badgeBg: 'rgba(245, 158, 11, 0.25)', textColor: '#fbbf24',
    configuration: {
      es: { name: 'Táctico', description: 'Adaptable y letal en situaciones críticas. Transformas cualquier error del oponente en un golpe decisivo para la victoria.', motto: 'Precisión letal en el momento exacto.' },
      en: { name: 'Tactician', description: 'Adaptable and lethal under pressure. You turn any opponent mistake into a decisive blow for victory.', motto: 'Lethal precision at the right moment.' }
    }
  },
  {
    key: 'MAESTRO_MUROS', level: 7, emoji: '🎖️', badgeBg: 'rgba(249, 115, 22, 0.25)', textColor: '#fb923c',
    configuration: {
      es: { name: 'Maestro', description: 'Controlas el espacio del tablero a la perfección. Tus bloqueos dictan el destino de la partida y encierran al enemigo.', motto: 'Domina el espacio y vence al rival.' },
      en: { name: 'Master', description: 'You command board space with sheer perfection. Your walls dictate the game destiny and trap any challenger.', motto: 'Command the space, conquer the foe.' }
    }
  },
  {
    key: 'GRAN_MAESTRO', level: 8, emoji: '👑', badgeBg: 'rgba(236, 72, 153, 0.25)', textColor: '#f472b6',
    configuration: {
      es: { name: 'Gran Maestro', description: 'Una mente brillante con un balance perfecto entre defensa y ataque. Dominas el ritmo de la partida a tu antojo.', motto: 'La visión que anticipa el destino.' },
      en: { name: 'Grandmaster', description: 'A brilliant mind balancing offense and defense. You command the rhythm of every game with effortless poise.', motto: 'Vision that anticipates destiny.' }
    }
  },
  {
    key: 'ELITE', level: 9, emoji: '🔮', badgeBg: 'rgba(14, 165, 233, 0.25)', textColor: '#38bdf8',
    configuration: {
      es: { name: 'Élite', description: 'Perteneces al círculo exclusivo de los mejores. Tu precisión y velocidad mental te colocan en la cima del juego competitivo.', motto: 'Solo los audaces dominan la cima.' },
      en: { name: 'Elite', description: 'You belong to an exclusive circle of champions. Mental speed and flawless execution keep you at the pinnacle.', motto: 'Only the bold rule the summit.' }
    }
  },
  {
    key: 'CAMPEON', level: 10, emoji: '🏆', badgeBg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(234, 88, 12, 0.35))', textColor: '#fbbf24',
    configuration: {
      es: { name: 'Campeón', description: 'La gloria te acompaña en cada enfrentamiento. Has superado a los rivales más duros y compites por el trono supremo.', motto: 'Nacido para competir y triunfar.' },
      en: { name: 'Champion', description: 'Glory follows your every clash. Having bested the fiercest rivals, you now contend for the ultimate crown.', motto: 'Born to compete and triumph.' }
    }
  },
  {
    key: 'MITICO', level: 11, emoji: '🦄', badgeBg: 'linear-gradient(135deg, #a855f7, #ec4899)', textColor: '#f5d0fe',
    configuration: {
      es: { name: 'Mítico', description: 'Tu nivel desafía los límites convencionales. Las partidas a tu alrededor se convierten en auténticas demostraciones de maestría.', motto: 'Tu leyenda despierta en el tablero.' },
      en: { name: 'Mythic', description: 'Your prowess defies conventional limits. Matches around you turn into masterclasses of high-level play.', motto: 'Your legend awakens on the board.' }
    }
  },
  {
    key: 'GENIO', level: 12, emoji: '🧠', badgeBg: 'rgba(6, 182, 212, 0.25)', textColor: '#67e8f9',
    configuration: {
      es: { name: 'Genio', description: 'Ves soluciones donde otros solo ven callejones sin salida. Tu creatividad e inteligencia deslumbran en cada movimiento.', motto: 'El ingenio supera toda adversidad.' },
      en: { name: 'Genius', description: 'You see winning paths where others see dead ends. Pure creativity and brilliant strategy ignite every move.', motto: 'Brilliance overcomes adversity.' }
    }
  },
  {
    key: 'CONQUISTADOR', level: 13, emoji: '🏹', badgeBg: 'rgba(239, 68, 68, 0.25)', textColor: '#fca5a5',
    configuration: {
      es: { name: 'Conquistador', description: 'Impones tu ritmo y conquistas cada rincón del tablero. Ningún rival logra escapar a tu implacable presión ofensiva.', motto: 'Ningún territorio queda invicto.' },
      en: { name: 'Conqueror', description: 'You set the pace and conquer every zone of the board. No opponent can withstand your relentless pressure.', motto: 'No challenge remains unconquered.' }
    }
  },
  {
    key: 'DOMINADOR', level: 14, emoji: '🔱', badgeBg: 'rgba(59, 130, 246, 0.25)', textColor: '#93c5fd',
    configuration: {
      es: { name: 'Dominador', description: 'El tablero se pliega a tu voluntad. Controlas el tiempo, el espacio y las emociones de tus rivales de principio a fin.', motto: 'El control absoluto de la partida.' },
      en: { name: 'Dominator', description: 'The entire board bends to your will. You command time, space, and opponent morale from start to finish.', motto: 'Absolute control of the match.' }
    }
  },
  {
    key: 'GENERAL', level: 15, emoji: '⚔️', badgeBg: 'rgba(100, 116, 139, 0.3)', textColor: '#e2e8f0',
    configuration: {
      es: { name: 'General', description: 'Estratega supremo y líder nato del campo de juego. Cada jugada tuya es una orden ejecutada con precisión quirúrgica.', motto: 'Liderazgo de acero, triunfo seguro.' },
      en: { name: 'General', description: 'Supreme strategist and battlefield leader. Every move you make is a command executed with surgical precision.', motto: 'Iron leadership, certain triumph.' }
    }
  },
  {
    key: 'INMORTAL', level: 16, emoji: '♾️', badgeBg: 'rgba(14, 165, 233, 0.25)', textColor: '#7dd3fc',
    configuration: {
      es: { name: 'Inmortal', description: 'Imbatible ante la adversidad. No importa qué tan difícil sea la situación, tu determinación siempre encuentra el camino.', motto: 'Tu legado jamás será olvidado.' },
      en: { name: 'Immortal', description: 'Unshakable in the face of adversity. No matter how tough the odds, your resolve always discovers victory.', motto: 'Your legacy will never be forgotten.' }
    }
  },
  {
    key: 'CELESTIAL', level: 17, emoji: '🌌', badgeBg: 'linear-gradient(135deg, #312e81, #7c3aed)', textColor: '#c4b5fd',
    configuration: {
      es: { name: 'Celestial', description: 'Tu comprensión del juego trasciende lo terrenal. Tus decisiones parecen guiadas por una visión casi divina del tablero.', motto: 'Un poder que trasciende límites.' },
      en: { name: 'Celestial', description: 'Your understanding of the game reaches astral heights. Your decisions flow with near-divine foresight.', motto: 'Power that transcends limits.' }
    }
  },
  {
    key: 'DIVINO', level: 18, emoji: '☀️', badgeBg: 'linear-gradient(135deg, #f59e0b, #f97316)', textColor: '#ffedd5',
    configuration: {
      es: { name: 'Divino', description: 'La personificación de la maestría absoluta. Cada partida es una obra de arte donde el rival apenas puede reaccionar.', motto: 'La perfección absoluta en cada acto.' },
      en: { name: 'Divine', description: 'The embodiment of absolute mastery. Every match is a work of art where opponents are left with no answers.', motto: 'Absolute perfection in every move.' }
    }
  },
  {
    key: 'ETERNO', level: 19, emoji: '✨', badgeBg: 'linear-gradient(135deg, #0f172a, #6366f1)', textColor: '#e0e7ff',
    configuration: {
      es: { name: 'Eterno', description: 'Tu grandeza ha superado la prueba del tiempo. Eres una leyenda viviente venerada por todos los jugadores.', motto: 'La gloria que el tiempo no borra.' },
      en: { name: 'Eternal', description: 'Your greatness stands the test of time. A living legend celebrated by competitive players across the realm.', motto: 'Glory that time cannot erase.' }
    }
  },
  {
    key: 'LEGENDARIO', level: 20, emoji: '💎', badgeBg: 'linear-gradient(135deg, #ef4444, #dc2626)', textColor: '#ffffff',
    configuration: {
      es: { name: 'Legendario', description: 'La cúspide del Olimpo competitivo. Solo los elegidos alcanzan este pedestal donde tu nombre queda grabado para siempre.', motto: 'La cumbre absoluta del Olimpo.' },
      en: { name: 'Legendary', description: 'The absolute summit of the competitive pantheon. Only the chosen reach this throne, etched into history forever.', motto: 'The ultimate summit of Olympus.' }
    }
  }
];

export function createDefaultRankTier(rank: IDefaultRankTier): RankTier {
  return Object.assign(new RankTier(), rank);
}
