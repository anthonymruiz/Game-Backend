import { Badge, type BadgeLocales } from '../models/badge.entity.js';
import type { BadgeCategory, BadgeEvent } from '../models/badge.enum.js';
import { AppDataSource } from '../config/database.config.js';
import { TROPHIES_LIST } from '../utils/trophy.util.js';

interface IExtraBadgeGroup {
  category: BadgeCategory;
  event: BadgeEvent;
  icon: string;
  targets: number[];
  titles: Array<{ es: string; en: string }>;
}

const LEGACY_RULES: Record<string, { category: BadgeCategory; event: BadgeEvent }> = {
  level_2: { category: 'LEVELS', event: 'level_reached' },
  level_3: { category: 'LEVELS', event: 'level_reached' },
  level_4: { category: 'LEVELS', event: 'level_reached' },
  level_5: { category: 'LEVELS', event: 'level_reached' },
  level_6: { category: 'LEVELS', event: 'level_reached' },
  level_7: { category: 'LEVELS', event: 'level_reached' },
  level_8: { category: 'LEVELS', event: 'level_reached' },
  level_9: { category: 'LEVELS', event: 'level_reached' },
  level_10: { category: 'LEVELS', event: 'level_reached' },
  first_win: { category: 'MATCHES', event: 'match_win' },
  bot_win: { category: 'BOT', event: 'bot_win' },
  win_4p_mode: { category: 'MODE_4FFA', event: 'win_4ffa' },
  win_1v1_10: { category: 'MODE_1V1', event: 'win_1v1' },
  win_4p_5: { category: 'MODE_4FFA', event: 'win_4ffa' },
  streak_2: { category: 'STREAKS', event: 'win_streak' },
  streak_3: { category: 'STREAKS', event: 'win_streak' },
  streak_5: { category: 'STREAKS', event: 'win_streak' },
  streak_8: { category: 'STREAKS', event: 'win_streak' },
  streak_12: { category: 'STREAKS', event: 'win_streak' },
  first_wall: { category: 'WALLS', event: 'wall_placed' },
  walls_25: { category: 'WALLS', event: 'wall_placed' },
  walls_100: { category: 'WALLS', event: 'wall_placed' },
  walls_300: { category: 'WALLS', event: 'wall_placed' },
  walls_750: { category: 'WALLS', event: 'wall_placed' },
  first_pickup: { category: 'BOOST_WALL', event: 'boost_wall' },
  pickups_10: { category: 'BOOST_WALL', event: 'boost_wall' },
  pickups_30: { category: 'BOOST_WALL', event: 'boost_wall' },
  first_portal: { category: 'PORTALS', event: 'portal_used' },
  portals_5: { category: 'PORTALS', event: 'portal_used' },
  portals_15: { category: 'PORTALS', event: 'portal_used' },
  portals_30: { category: 'PORTALS', event: 'portal_used' },
  portals_50: { category: 'PORTALS', event: 'portal_used' },
  portal_win: { category: 'PORTALS', event: 'portal_used' },
  first_friend: { category: 'FRIENDS', event: 'friend_added' },
  friends_5: { category: 'FRIENDS', event: 'friend_added' },
  friends_10: { category: 'FRIENDS', event: 'friend_added' },
  spectate_1: { category: 'SPECTATING', event: 'spectate' },
  spectate_5: { category: 'SPECTATING', event: 'spectate' },
  spectated_1: { category: 'SPECTATING', event: 'spectated' },
  spectated_3: { category: 'SPECTATING', event: 'spectated' },
  first_emote: { category: 'EMOTES', event: 'emote_sent' },
  emotes_20: { category: 'EMOTES', event: 'emote_sent' },
  emotes_50: { category: 'EMOTES', event: 'emote_sent' },
  victory_emote: { category: 'EMOTES', event: 'emote_sent' },
  games_25: { category: 'MATCHES', event: 'match_played' },
  games_100: { category: 'MATCHES', event: 'match_played' },
  games_250: { category: 'MATCHES', event: 'match_played' },
  moves_500: { category: 'WALLS', event: 'move_completed' },
  moves_2000: { category: 'WALLS', event: 'move_completed' },
  no_walls_win: { category: 'WALLS', event: 'win_without_walls' }
};

const EXTRA_GROUPS: IExtraBadgeGroup[] = [
  {
    category: 'BOT', event: 'bot_win', icon: '🤖', targets: [3, 5, 10, 25],
    titles: [
      { es: 'Cazador de bots', en: 'Bot Hunter' },
      { es: 'Asesino de bots', en: 'Bot Slayer' },
      { es: 'Aniquilador de bots', en: 'Bot Annihilator' },
      { es: 'Némesis de la IA', en: 'AI Nemesis' }
    ]
  },
  {
    category: 'MODE_1V1', event: 'win_1v1', icon: '⚔️', targets: [1, 3, 5, 25],
    titles: [
      { es: 'Primer duelo', en: 'First Duel' },
      { es: 'Espadachín', en: 'Swordsman' },
      { es: 'Maestro del duelo', en: 'Duel Master' },
      { es: 'Leyenda uno contra uno', en: 'One-on-One Legend' }
    ]
  },
  {
    category: 'MODE_2V2', event: 'win_2v2', icon: '🤝', targets: [1, 3, 5, 25],
    titles: [
      { es: 'Dúo victorioso', en: 'Victorious Duo' },
      { es: 'Socios de batalla', en: 'Battle Partners' },
      { es: 'Sincronía perfecta', en: 'Perfect Sync' },
      { es: 'Leyenda de equipo', en: 'Team Legend' }
    ]
  },
  {
    category: 'MODE_4FFA', event: 'win_4ffa', icon: '👑', targets: [3, 10, 25, 50],
    titles: [
      { es: 'Dueño de la arena', en: 'Arena Owner' },
      { es: 'Monarca del caos', en: 'Monarch of Chaos' },
      { es: 'Conquistador del todos contra todos', en: 'Free-for-All Conqueror' },
      { es: 'Soberano de la arena', en: 'Arena Sovereign' }
    ]
  },
  {
    category: 'MODE_6FFA', event: 'win_6ffa', icon: '🏟️', targets: [1, 3, 10, 25],
    titles: [
      { es: 'Superviviente del coliseo', en: 'Colosseum Survivor' },
      { es: 'Gladiador imparable', en: 'Unstoppable Gladiator' },
      { es: 'Dominador de seis', en: 'Six-Player Dominator' },
      { es: 'Campeón del gran coliseo', en: 'Grand Colosseum Champion' }
    ]
  },
  {
    category: 'MATCHES', event: 'match_win', icon: '🏆', targets: [3, 10, 25, 100],
    titles: [
      { es: 'Aspirante a campeón', en: 'Champion Contender' },
      { es: 'Coleccionista de victorias', en: 'Victory Collector' },
      { es: 'Maestro de la estrategia', en: 'Strategy Master' },
      { es: 'Gloria eterna', en: 'Eternal Glory' }
    ]
  },
  {
    category: 'WALLS', event: 'wall_placed', icon: '🧱', targets: [5, 50, 150, 500],
    titles: [
      { es: 'Primer arquitecto', en: 'Junior Architect' },
      { es: 'Maestro constructor', en: 'Master Builder' },
      { es: 'Ingeniero del tablero', en: 'Board Engineer' },
      { es: 'Gran fortificador', en: 'Grand Fortifier' }
    ]
  },
  {
    category: 'BOOST_WALL', event: 'boost_wall', icon: '🧰', targets: [5, 15, 50],
    titles: [
      { es: 'Muro reforzado', en: 'Reinforced Wall' },
      { es: 'Proveedor de defensas', en: 'Defense Provider' },
      { es: 'Muralla impenetrable', en: 'Impenetrable Rampart' }
    ]
  },
  {
    category: 'BOOST_KILLER', event: 'boost_killer', icon: '🎯', targets: [1, 5, 20],
    titles: [
      { es: 'Primer impacto', en: 'First Strike' },
      { es: 'Tirador certero', en: 'Sharpshooter' },
      { es: 'Depredador táctico', en: 'Tactical Predator' }
    ]
  },
  {
    category: 'BOOST_EXCHANGE', event: 'boost_exchange', icon: '🔄', targets: [1, 5, 20],
    titles: [
      { es: 'Giro inesperado', en: 'Unexpected Turn' },
      { es: 'Maestro del intercambio', en: 'Exchange Master' },
      { es: 'Estratega impredecible', en: 'Unpredictable Strategist' }
    ]
  },
  {
    category: 'PORTALS', event: 'portal_used', icon: '🌀', targets: [3, 10, 25],
    titles: [
      { es: 'Explorador de portales', en: 'Portal Explorer' },
      { es: 'Nómada dimensional', en: 'Dimensional Nomad' },
      { es: 'Señor de los portales', en: 'Portal Overlord' }
    ]
  },
  {
    category: 'STORE_PURCHASES', event: 'store_purchase', icon: '🛍️', targets: [1, 5, 20],
    titles: [
      { es: 'Primera adquisición', en: 'First Acquisition' },
      { es: 'Colección en marcha', en: 'Collection in Progress' },
      { es: 'Magnate de la tienda', en: 'Store Tycoon' }
    ]
  },
  {
    category: 'STORE_REDEMPTIONS', event: 'store_redeem', icon: '🎁', targets: [1, 5, 20],
    titles: [
      { es: 'Canje inaugural', en: 'First Redemption' },
      { es: 'Cazador de tesoros', en: 'Treasure Hunter' },
      { es: 'Leyenda de los canjes', en: 'Redemption Legend' }
    ]
  },
  {
    category: 'POINT_PURCHASES', event: 'point_purchase', icon: '💎', targets: [1, 5],
    titles: [
      { es: 'Inversión inicial', en: 'First Investment' },
      { es: 'Mecenas del reino', en: 'Patron of the Realm' }
    ]
  },
  {
    category: 'FRIEND_MATCHES', event: 'friend_match', icon: '🧑‍🤝‍🧑', targets: [1, 5],
    titles: [
      { es: 'Primera partida en equipo', en: 'First Game Together' },
      { es: 'Amistad inquebrantable', en: 'Unbreakable Friendship' }
    ]
  }
];

const LEGACY_TITLES: Record<string, { es: string; en: string }> = {
  level_2: { es: 'Semilla táctica', en: 'Tactical Seed' },
  level_3: { es: 'Guardián del tablero', en: 'Board Guardian' },
  level_4: { es: 'Espíritu de acero', en: 'Steel Spirit' },
  level_5: { es: 'Arquero de precisión', en: 'Precision Archer' },
  level_6: { es: 'Muro de confianza', en: 'Reliable Wall' },
  level_7: { es: 'Rayo estratégico', en: 'Strategic Lightning' },
  level_8: { es: 'Soberano del tablero', en: 'Board Sovereign' },
  level_9: { es: 'Corazón de diamante', en: 'Diamond Heart' },
  level_10: { es: 'Llama legendaria', en: 'Legendary Flame' },
  first_win: { es: 'La primera conquista', en: 'First Conquest' },
  bot_win: { es: 'Primer bot derrotado', en: 'First Bot Down' },
  win_4p_mode: { es: 'Rey entre rivales', en: 'King Among Rivals' },
  win_1v1_10: { es: 'Maestro de los duelos', en: 'Duel Virtuoso' },
  win_4p_5: { es: 'As de la arena', en: 'Arena Ace' },
  streak_2: { es: 'Racha naciente', en: 'Rising Streak' },
  streak_3: { es: 'Fuego constante', en: 'Steady Flame' },
  streak_5: { es: 'Invicto en marcha', en: 'Unbeaten Run' },
  streak_8: { es: 'Tormenta de victorias', en: 'Victory Storm' },
  streak_12: { es: 'Racha inmortal', en: 'Immortal Streak' },
  first_wall: { es: 'Ladrillo a ladrillo', en: 'Brick by Brick' },
  walls_25: { es: 'Diseñador de rutas', en: 'Route Designer' },
  walls_100: { es: 'Maestro albañil', en: 'Master Mason' },
  walls_300: { es: 'Fortaleza viviente', en: 'Living Fortress' },
  walls_750: { es: 'Arquitecto imperial', en: 'Imperial Architect' },
  first_pickup: { es: 'Hallazgo útil', en: 'Useful Find' },
  pickups_10: { es: 'Almacén portátil', en: 'Walking Armory' },
  pickups_30: { es: 'Experto en suministros', en: 'Supply Specialist' },
  first_portal: { es: 'Umbral desconocido', en: 'Unknown Threshold' },
  portals_5: { es: 'Saltamundos', en: 'World Hopper' },
  portals_15: { es: 'Cartógrafo dimensional', en: 'Dimensional Cartographer' },
  portals_30: { es: 'Navegante del vacío', en: 'Void Navigator' },
  portals_50: { es: 'Viajero entre mundos', en: 'Worldwalker' },
  portal_win: { es: 'Victoria al otro lado', en: 'Victory Beyond the Gate' },
  first_friend: { es: 'Nueva alianza', en: 'New Alliance' },
  friends_5: { es: 'Círculo de confianza', en: 'Circle of Trust' },
  friends_10: { es: 'Conector de comunidades', en: 'Community Connector' },
  spectate_1: { es: 'Desde las gradas', en: 'From the Stands' },
  spectate_5: { es: 'Analista de partidas', en: 'Match Analyst' },
  spectated_1: { es: 'Primera audiencia', en: 'First Audience' },
  spectated_3: { es: 'Partida imperdible', en: 'Must-Watch Match' },
  first_emote: { es: 'Que hable la emoción', en: 'Let Emotions Speak' },
  emotes_20: { es: 'Repertorio expresivo', en: 'Expressive Repertoire' },
  emotes_50: { es: 'Maestro de reacciones', en: 'Reaction Virtuoso' },
  victory_emote: { es: 'Celebración merecida', en: 'Well-Earned Celebration' },
  games_25: { es: 'Bitácora de aventuras', en: 'Adventure Log' },
  games_100: { es: 'Veterano del tablero', en: 'Board Veteran' },
  games_250: { es: 'Leyenda de mil batallas', en: 'Legend of Many Battles' },
  moves_500: { es: 'Pasos calculados', en: 'Calculated Steps' },
  moves_2000: { es: 'Maratonista táctico', en: 'Tactical Marathoner' },
  no_walls_win: { es: 'Camino despejado', en: 'Clear Path' }
};

const EVENT_COPY: Record<BadgeEvent, { es: string; en: string; nameEs: string; nameEn: string }> = {
  bot_win: { es: 'Gana {target} partida(s) en Juega con IA.', en: 'Win {target} match(es) in Play vs AI.', nameEs: 'Cazador de IA', nameEn: 'AI Hunter' },
  match_played: { es: 'Completa {target} partida(s).', en: 'Complete {target} match(es).', nameEs: 'Veterano', nameEn: 'Veteran' },
  match_win: { es: 'Gana {target} partida(s).', en: 'Win {target} match(es).', nameEs: 'Campeón', nameEn: 'Champion' },
  win_1v1: { es: 'Gana {target} partida(s) en modo 1 vs 1.', en: 'Win {target} 1 vs 1 match(es).', nameEs: 'Duelista', nameEn: 'Duelist' },
  win_2v2: { es: 'Gana {target} partida(s) en modo 2 vs 2.', en: 'Win {target} 2 vs 2 match(es).', nameEs: 'Aliado', nameEn: 'Teammate' },
  win_4ffa: { es: 'Gana {target} partida(s) en modo 4-FFA.', en: 'Win {target} 4-FFA match(es).', nameEs: 'Rey de la arena', nameEn: 'Arena champion' },
  win_6ffa: { es: 'Gana {target} partida(s) en modo 6-FFA.', en: 'Win {target} 6-FFA match(es).', nameEs: 'Leyenda de la arena', nameEn: 'Arena legend' },
  win_streak: { es: 'Consigue una racha de {target} victorias.', en: 'Reach a streak of {target} wins.', nameEs: 'Racha de fuego', nameEn: 'Winning streak' },
  wall_placed: { es: 'Coloca {target} muro(s) en partidas.', en: 'Place {target} wall(s) in matches.', nameEs: 'Arquitecto', nameEn: 'Builder' },
  boost_wall: { es: 'Recoge {target} recarga(s) de muro.', en: 'Collect {target} wall refill(s).', nameEs: 'Refuerzo', nameEn: 'Reinforcement' },
  boost_killer: { es: 'Recoge {target} potenciador(es) de ataque.', en: 'Collect {target} attack boost(s).', nameEs: 'Cazador', nameEn: 'Hunter' },
  boost_exchange: { es: 'Recoge {target} potenciador(es) de intercambio.', en: 'Collect {target} exchange boost(s).', nameEs: 'Estratega', nameEn: 'Strategist' },
  portal_used: { es: 'Usa {target} portal(es).', en: 'Use {target} portal(s).', nameEs: 'Viajero dimensional', nameEn: 'Dimensional traveler' },
  friend_added: { es: 'Agrega {target} amigo(s).', en: 'Add {target} friend(s).', nameEs: 'Buen compañero', nameEn: 'Good company' },
  friend_match: { es: 'Juega {target} partida(s) con amigos.', en: 'Play {target} match(es) with friends.', nameEs: 'Equipo unido', nameEn: 'Close-knit team' },
  emote_sent: { es: 'Envía {target} reacción(es) durante una partida.', en: 'Send {target} reaction(s) during a match.', nameEs: 'Expresivo', nameEn: 'Expressive' },
  spectate: { es: 'Especta {target} partida(s).', en: 'Spectate {target} match(es).', nameEs: 'Observador', nameEn: 'Observer' },
  spectated: { es: 'Recibe {target} visita(s) de espectador.', en: 'Have {target} spectator(s) watch your match.', nameEs: 'Centro de atención', nameEn: 'In the spotlight' },
  move_completed: { es: 'Realiza {target} movimiento(s).', en: 'Make {target} move(s).', nameEs: 'Explorador', nameEn: 'Pathfinder' },
  win_without_walls: { es: 'Gana {target} partida(s) sin colocar muros.', en: 'Win {target} match(es) without placing walls.', nameEs: 'Precisión pura', nameEn: 'Pure precision' },
  level_reached: { es: 'Alcanza el nivel {target}.', en: 'Reach level {target}.', nameEs: 'Ascenso', nameEn: 'Rising star' },
  store_purchase: { es: 'Compra {target} artículo(s) en la tienda.', en: 'Purchase {target} store item(s).', nameEs: 'Coleccionista', nameEn: 'Collector' },
  store_redeem: { es: 'Canjea {target} artículo(s) de tienda.', en: 'Redeem {target} store item(s).', nameEs: 'Cazador de ofertas', nameEn: 'Deal hunter' },
  point_purchase: { es: 'Compra puntos {target} vez/veces.', en: 'Purchase points {target} time(s).', nameEs: 'Inversor', nameEn: 'Investor' }
};

function makeLocales(
  event: BadgeEvent,
  target: number,
  tier: number,
  title?: { es: string; en: string }
): BadgeLocales {
  const copy = EVENT_COPY[event];
  return {
    es: {
      name: title?.es ?? `${copy.nameEs} ${tier}`,
      motto: tier === 1 ? 'Cada partida te acerca a la meta.' : 'La constancia construye leyendas.',
      description: copy.es.replace('{target}', String(target))
    },
    en: {
      name: title?.en ?? `${copy.nameEn} ${tier}`,
      motto: tier === 1 ? 'Every match brings you closer.' : 'Consistency builds legends.',
      description: copy.en.replace('{target}', String(target))
    }
  };
}

export function getDefaultBadges(): Array<Pick<Badge, 'code' | 'category' | 'event' | 'target' | 'icon' | 'locales' | 'isActive'>> {
  const legacy = TROPHIES_LIST.map(trophy => {
    const rule = LEGACY_RULES[trophy.id];
    if (!rule) throw new Error(`Missing badge rule for legacy trophy ${trophy.id}`);
    const title = LEGACY_TITLES[trophy.id];
    if (!title) throw new Error(`Missing badge title for legacy trophy ${trophy.id}`);
    const target = trophy.targetCount ?? 1;
    return {
      code: trophy.id,
      category: rule.category,
      event: rule.event,
      target,
      icon: trophy.icon,
      locales: makeLocales(rule.event, target, 1, title),
      isActive: true
    };
  });

  const extra = EXTRA_GROUPS.flatMap(group => group.targets.map((target, index) => {
    const title = group.titles[index];
    if (!title) throw new Error(`Missing badge title for ${group.event} target ${target}`);
    return {
      code: `challenge_${group.event}_${target}`,
      category: group.category,
      event: group.event,
      target,
      icon: group.icon,
      locales: makeLocales(group.event, target, index + 1, title),
      isActive: true
    };
  }));

  const allBadges = [...legacy, ...extra];
  if (allBadges.length !== 100) {
    throw new Error(`Expected exactly 100 default badges, got ${allBadges.length}`);
  }
  return allBadges;
}

export async function seedBadges(): Promise<void> {
  const repository = AppDataSource.getRepository(Badge);
  const defaults = getDefaultBadges();
  const existing = await repository.find({ select: { id: true, code: true, locales: true } });
  const existingByCode = new Map(existing.map(badge => [badge.code, badge]));
  const missing = defaults
    .filter(badge => !existingByCode.has(badge.code))
    .map(badge => repository.create(badge));
  if (missing.length) await repository.save(missing);
  const defaultByCode = new Map(defaults.map(badge => [badge.code, badge]));
  const staleSeededBadges = existing
    .map(badge => {
      const definition = defaultByCode.get(badge.code);
      if (!definition) return null;
      const locales: BadgeLocales = {
        es: { ...badge.locales.es, name: definition.locales.es.name },
        en: { ...badge.locales.en, name: definition.locales.en.name }
      };
      if (
        locales.es.name === badge.locales.es.name &&
        locales.en.name === badge.locales.en.name
      ) return null;
      return repository.create({ id: badge.id, locales });
    })
    .filter((badge): badge is Badge => badge !== null);
  if (staleSeededBadges.length) await repository.save(staleSeededBadges);
  console.log(`[SEED] Badge catalog ready (${defaults.length} definitions; ${missing.length} added; ${staleSeededBadges.length} refreshed).`);
}
