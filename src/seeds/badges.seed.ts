import { Badge, type BadgeLocales } from '../models/badge.entity.js';
import type { BadgeCategory, BadgeEvent } from '../models/badge.enum.js';
import { AppDataSource } from '../config/database.config.js';
import { TROPHIES_LIST } from '../utils/trophy.util.js';

interface IExtraBadgeGroup {
  category: BadgeCategory;
  event: BadgeEvent;
  icon: string;
  targets: number[];
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
  { category: 'BOT', event: 'bot_win', icon: '🤖', targets: [3, 5, 10, 25] },
  { category: 'MODE_1V1', event: 'win_1v1', icon: '⚔️', targets: [1, 3, 5, 25] },
  { category: 'MODE_2V2', event: 'win_2v2', icon: '🤝', targets: [1, 3, 5, 25] },
  { category: 'MODE_4FFA', event: 'win_4ffa', icon: '👑', targets: [3, 10, 25, 50] },
  { category: 'MODE_6FFA', event: 'win_6ffa', icon: '🏟️', targets: [1, 3, 10, 25] },
  { category: 'MATCHES', event: 'match_win', icon: '🏆', targets: [3, 10, 25, 100] },
  { category: 'WALLS', event: 'wall_placed', icon: '🧱', targets: [5, 50, 150, 500] },
  { category: 'BOOST_WALL', event: 'boost_wall', icon: '🧰', targets: [5, 15, 50] },
  { category: 'BOOST_KILLER', event: 'boost_killer', icon: '🎯', targets: [1, 5, 20] },
  { category: 'BOOST_EXCHANGE', event: 'boost_exchange', icon: '🔄', targets: [1, 5, 20] },
  { category: 'PORTALS', event: 'portal_used', icon: '🌀', targets: [3, 10, 25] },
  { category: 'STORE_PURCHASES', event: 'store_purchase', icon: '🛍️', targets: [1, 5, 20] },
  { category: 'STORE_REDEMPTIONS', event: 'store_redeem', icon: '🎁', targets: [1, 5, 20] },
  { category: 'POINT_PURCHASES', event: 'point_purchase', icon: '💎', targets: [1, 5] },
  { category: 'FRIEND_MATCHES', event: 'friend_match', icon: '🧑‍🤝‍🧑', targets: [1, 5] }
];

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

function makeLocales(event: BadgeEvent, target: number, tier: number): BadgeLocales {
  const copy = EVENT_COPY[event];
  return {
    es: {
      name: `${copy.nameEs} ${tier}`,
      motto: tier === 1 ? 'Cada partida te acerca a la meta.' : 'La constancia construye leyendas.',
      description: copy.es.replace('{target}', String(target))
    },
    en: {
      name: `${copy.nameEn} ${tier}`,
      motto: tier === 1 ? 'Every match brings you closer.' : 'Consistency builds legends.',
      description: copy.en.replace('{target}', String(target))
    }
  };
}

export function getDefaultBadges(): Array<Pick<Badge, 'code' | 'category' | 'event' | 'target' | 'icon' | 'locales' | 'isActive' | 'sortOrder'>> {
  const legacy = TROPHIES_LIST.map((trophy, index) => {
    const rule = LEGACY_RULES[trophy.id];
    if (!rule) throw new Error(`Missing badge rule for legacy trophy ${trophy.id}`);
    const target = trophy.targetCount ?? 1;
    return {
      code: trophy.id,
      category: rule.category,
      event: rule.event,
      target,
      icon: trophy.icon,
      locales: makeLocales(rule.event, target, index + 1),
      isActive: true,
      sortOrder: index
    };
  });

  let nextOrder = legacy.length;
  const extra = EXTRA_GROUPS.flatMap(group => group.targets.map(target => {
    const tier = target;
    return {
      code: `challenge_${group.event}_${target}`,
      category: group.category,
      event: group.event,
      target,
      icon: group.icon,
      locales: makeLocales(group.event, target, tier),
      isActive: true,
      sortOrder: nextOrder++
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
  const existing = await repository.find({ select: { id: true, code: true } });
  const existingCodes = new Set(existing.map(badge => badge.code));
  const missing = defaults
    .filter(badge => !existingCodes.has(badge.code))
    .map(badge => repository.create(badge));
  if (missing.length) await repository.save(missing);
  console.log(`[SEED] Badge catalog ready (${defaults.length} definitions; ${missing.length} added).`);
}
