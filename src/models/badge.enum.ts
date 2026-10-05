export const BADGE_CATEGORIES = [
  'BOT',
  'MATCHES',
  'MODE_1V1',
  'MODE_2V2',
  'MODE_4FFA',
  'MODE_6FFA',
  'STREAKS',
  'WALLS',
  'BOOST_WALL',
  'BOOST_KILLER',
  'BOOST_EXCHANGE',
  'PORTALS',
  'FRIENDS',
  'FRIEND_MATCHES',
  'EMOTES',
  'SPECTATING',
  'WEEKLY_LEADERBOARD',
  'LEVELS',
  'STORE_PURCHASES',
  'POINT_PURCHASES'
] as const;

export type BadgeCategory = typeof BADGE_CATEGORIES[number];

export const BADGE_EVENTS = [
  'bot_win',
  'match_played',
  'match_win',
  'win_1v1',
  'win_2v2',
  'win_4ffa',
  'win_6ffa',
  'win_streak',
  'wall_placed',
  'boost_wall',
  'boost_killer',
  'boost_exchange',
  'portal_used',
  'friend_added',
  'friend_match',
  'emote_sent',
  'spectate',
  'spectated',
  'weekly_first_place',
  'weekly_second_place',
  'weekly_third_place',
  'move_completed',
  'win_without_walls',
  'level_reached',
  'store_purchase',
  'point_purchase'
] as const;

export type BadgeEvent = typeof BADGE_EVENTS[number];

export const BADGE_CATEGORY_EVENTS: Record<BadgeCategory, readonly BadgeEvent[]> = {
  BOT: ['bot_win'],
  MATCHES: ['match_played', 'match_win'],
  MODE_1V1: ['win_1v1'],
  MODE_2V2: ['win_2v2'],
  MODE_4FFA: ['win_4ffa'],
  MODE_6FFA: ['win_6ffa'],
  STREAKS: ['win_streak'],
  WALLS: ['wall_placed', 'move_completed', 'win_without_walls'],
  BOOST_WALL: ['boost_wall'],
  BOOST_KILLER: ['boost_killer'],
  BOOST_EXCHANGE: ['boost_exchange'],
  PORTALS: ['portal_used'],
  FRIENDS: ['friend_added'],
  FRIEND_MATCHES: ['friend_match'],
  EMOTES: ['emote_sent'],
  SPECTATING: ['spectate', 'spectated'],
  WEEKLY_LEADERBOARD: ['weekly_first_place', 'weekly_second_place', 'weekly_third_place'],
  LEVELS: ['level_reached'],
  STORE_PURCHASES: ['store_purchase'],
  POINT_PURCHASES: ['point_purchase']
};
