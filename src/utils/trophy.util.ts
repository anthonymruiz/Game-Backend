export interface ITrophy {
  id: string;
  icon: string;
  category: 'LEVELS' | 'MODES' | 'STREAKS' | 'WALLS' | 'PORTALS' | 'SOCIAL' | 'EMOTES' | 'STATS';
  titleKey: string;
  descKey: string;
  targetCount?: number;
}

export const TROPHIES_LIST: ITrophy[] = [
  // 📈 Progression milestones
  { id: 'level_10', icon: '🌱', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_10_TITLE', descKey: 'TROPHIES.LEVEL_10_DESC', targetCount: 10 },
  { id: 'level_20', icon: '🛡️', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_20_TITLE', descKey: 'TROPHIES.LEVEL_20_DESC', targetCount: 20 },
  { id: 'level_30', icon: '🗡️', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_30_TITLE', descKey: 'TROPHIES.LEVEL_30_DESC', targetCount: 30 },
  { id: 'level_40', icon: '🏹', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_40_TITLE', descKey: 'TROPHIES.LEVEL_40_DESC', targetCount: 40 },
  { id: 'level_50', icon: '🧱', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_50_TITLE', descKey: 'TROPHIES.LEVEL_50_DESC', targetCount: 50 },
  { id: 'level_60', icon: '⚡', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_60_TITLE', descKey: 'TROPHIES.LEVEL_60_DESC', targetCount: 60 },
  { id: 'level_70', icon: '👑', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_70_TITLE', descKey: 'TROPHIES.LEVEL_70_DESC', targetCount: 70 },
  { id: 'level_80', icon: '💎', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_80_TITLE', descKey: 'TROPHIES.LEVEL_80_DESC', targetCount: 80 },
  { id: 'level_90', icon: '🔥', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_90_TITLE', descKey: 'TROPHIES.LEVEL_90_DESC', targetCount: 90 },
  { id: 'level_100', icon: '🏆', category: 'LEVELS', titleKey: 'TROPHIES.LEVEL_100_TITLE', descKey: 'TROPHIES.LEVEL_100_DESC', targetCount: 100 },

  // 🎮 Modos de Juego (5)
  { id: 'first_win', icon: '🎉', category: 'MODES', titleKey: 'TROPHIES.FIRST_WIN_TITLE', descKey: 'TROPHIES.FIRST_WIN_DESC', targetCount: 1 },
  { id: 'bot_win', icon: '🤖', category: 'MODES', titleKey: 'TROPHIES.BOT_WIN_TITLE', descKey: 'TROPHIES.BOT_WIN_DESC', targetCount: 1 },
  { id: 'win_4p_mode', icon: '👑', category: 'MODES', titleKey: 'TROPHIES.WIN_4P_MODE_TITLE', descKey: 'TROPHIES.WIN_4P_MODE_DESC', targetCount: 1 },
  { id: 'win_1v1_10', icon: '⚔️', category: 'MODES', titleKey: 'TROPHIES.WIN_1V1_10_TITLE', descKey: 'TROPHIES.WIN_1V1_10_DESC', targetCount: 10 },
  { id: 'win_4p_5', icon: '🏅', category: 'MODES', titleKey: 'TROPHIES.WIN_4P_5_TITLE', descKey: 'TROPHIES.WIN_4P_5_DESC', targetCount: 5 },

  // 🔥 Rachas de Victorias (5)
  { id: 'streak_2', icon: '✌️', category: 'STREAKS', titleKey: 'TROPHIES.STREAK_2_TITLE', descKey: 'TROPHIES.STREAK_2_DESC', targetCount: 2 },
  { id: 'streak_3', icon: '🔥', category: 'STREAKS', titleKey: 'TROPHIES.STREAK_3_TITLE', descKey: 'TROPHIES.STREAK_3_DESC', targetCount: 3 },
  { id: 'streak_5', icon: '💥', category: 'STREAKS', titleKey: 'TROPHIES.STREAK_5_TITLE', descKey: 'TROPHIES.STREAK_5_DESC', targetCount: 5 },
  { id: 'streak_8', icon: '⚡', category: 'STREAKS', titleKey: 'TROPHIES.STREAK_8_TITLE', descKey: 'TROPHIES.STREAK_8_DESC', targetCount: 8 },
  { id: 'streak_12', icon: '🌟', category: 'STREAKS', titleKey: 'TROPHIES.STREAK_12_TITLE', descKey: 'TROPHIES.STREAK_12_DESC', targetCount: 12 },

  // 🧱 Muros y Recargas (8)
  { id: 'first_wall', icon: '🧱', category: 'WALLS', titleKey: 'TROPHIES.FIRST_WALL_TITLE', descKey: 'TROPHIES.FIRST_WALL_DESC', targetCount: 1 },
  { id: 'walls_25', icon: '📐', category: 'WALLS', titleKey: 'TROPHIES.WALLS_25_TITLE', descKey: 'TROPHIES.WALLS_25_DESC', targetCount: 25 },
  { id: 'walls_100', icon: '🔨', category: 'WALLS', titleKey: 'TROPHIES.WALLS_100_TITLE', descKey: 'TROPHIES.WALLS_100_DESC', targetCount: 100 },
  { id: 'walls_300', icon: '🏰', category: 'WALLS', titleKey: 'TROPHIES.WALLS_300_TITLE', descKey: 'TROPHIES.WALLS_300_DESC', targetCount: 300 },
  { id: 'walls_750', icon: '🏛️', category: 'WALLS', titleKey: 'TROPHIES.WALLS_750_TITLE', descKey: 'TROPHIES.WALLS_750_DESC', targetCount: 750 },
  { id: 'first_pickup', icon: '📦', category: 'WALLS', titleKey: 'TROPHIES.FIRST_PICKUP_TITLE', descKey: 'TROPHIES.FIRST_PICKUP_DESC', targetCount: 1 },
  { id: 'pickups_10', icon: '🎒', category: 'WALLS', titleKey: 'TROPHIES.PICKUPS_10_TITLE', descKey: 'TROPHIES.PICKUPS_10_DESC', targetCount: 10 },
  { id: 'pickups_30', icon: '⚡', category: 'WALLS', titleKey: 'TROPHIES.PICKUPS_30_TITLE', descKey: 'TROPHIES.PICKUPS_30_DESC', targetCount: 30 },

  // 🌀 Portales (6)
  { id: 'first_portal', icon: '🌌', category: 'PORTALS', titleKey: 'TROPHIES.FIRST_PORTAL_TITLE', descKey: 'TROPHIES.FIRST_PORTAL_DESC', targetCount: 1 },
  { id: 'portals_5', icon: '🛸', category: 'PORTALS', titleKey: 'TROPHIES.PORTALS_5_TITLE', descKey: 'TROPHIES.PORTALS_5_DESC', targetCount: 5 },
  { id: 'portals_15', icon: '☄️', category: 'PORTALS', titleKey: 'TROPHIES.PORTALS_15_TITLE', descKey: 'TROPHIES.PORTALS_15_DESC', targetCount: 15 },
  { id: 'portals_30', icon: '✨', category: 'PORTALS', titleKey: 'TROPHIES.PORTALS_30_TITLE', descKey: 'TROPHIES.PORTALS_30_DESC', targetCount: 30 },
  { id: 'portals_50', icon: '🔮', category: 'PORTALS', titleKey: 'TROPHIES.PORTALS_50_TITLE', descKey: 'TROPHIES.PORTALS_50_DESC', targetCount: 50 },

  // 👥 Social y Espectadores (7)
  { id: 'first_friend', icon: '🤝', category: 'SOCIAL', titleKey: 'TROPHIES.FIRST_FRIEND_TITLE', descKey: 'TROPHIES.FIRST_FRIEND_DESC', targetCount: 1 },
  { id: 'friends_5', icon: '👥', category: 'SOCIAL', titleKey: 'TROPHIES.FRIENDS_5_TITLE', descKey: 'TROPHIES.FRIENDS_5_DESC', targetCount: 5 },
  { id: 'friends_10', icon: '🌐', category: 'SOCIAL', titleKey: 'TROPHIES.FRIENDS_10_TITLE', descKey: 'TROPHIES.FRIENDS_10_DESC', targetCount: 10 },
  { id: 'spectate_1', icon: '👁️', category: 'SOCIAL', titleKey: 'TROPHIES.SPECTATE_1_TITLE', descKey: 'TROPHIES.SPECTATE_1_DESC', targetCount: 1 },
  { id: 'spectate_5', icon: '🍿', category: 'SOCIAL', titleKey: 'TROPHIES.SPECTATE_5_TITLE', descKey: 'TROPHIES.SPECTATE_5_DESC', targetCount: 5 },
  { id: 'spectated_1', icon: '🌟', category: 'SOCIAL', titleKey: 'TROPHIES.SPECTATED_1_TITLE', descKey: 'TROPHIES.SPECTATED_1_DESC', targetCount: 1 },
  { id: 'spectated_3', icon: '🔥', category: 'SOCIAL', titleKey: 'TROPHIES.SPECTATED_3_TITLE', descKey: 'TROPHIES.SPECTATED_3_DESC', targetCount: 3 },

  // 😃 Emojis y Reacciones (4)
  { id: 'first_emote', icon: '💬', category: 'EMOTES', titleKey: 'TROPHIES.FIRST_EMOTE_TITLE', descKey: 'TROPHIES.FIRST_EMOTE_DESC', targetCount: 1 },
  { id: 'emotes_20', icon: '😃', category: 'EMOTES', titleKey: 'TROPHIES.EMOTES_20_TITLE', descKey: 'TROPHIES.EMOTES_20_DESC', targetCount: 20 },
  { id: 'emotes_50', icon: '🎭', category: 'EMOTES', titleKey: 'TROPHIES.EMOTES_50_TITLE', descKey: 'TROPHIES.EMOTES_50_DESC', targetCount: 50 },
  { id: 'victory_emote', icon: '🏆', category: 'EMOTES', titleKey: 'TROPHIES.VICTORY_EMOTE_TITLE', descKey: 'TROPHIES.VICTORY_EMOTE_DESC', targetCount: 1 },

  // 📜 Persistencia y Hazañas (6)
  { id: 'games_25', icon: '📜', category: 'STATS', titleKey: 'TROPHIES.GAMES_25_TITLE', descKey: 'TROPHIES.GAMES_25_DESC', targetCount: 25 },
  { id: 'games_100', icon: '⚔️', category: 'STATS', titleKey: 'TROPHIES.GAMES_100_TITLE', descKey: 'TROPHIES.GAMES_100_DESC', targetCount: 100 },
  { id: 'games_250', icon: '🏆', category: 'STATS', titleKey: 'TROPHIES.GAMES_250_TITLE', descKey: 'TROPHIES.GAMES_250_DESC', targetCount: 250 },
  { id: 'moves_500', icon: '👣', category: 'STATS', titleKey: 'TROPHIES.MOVES_500_TITLE', descKey: 'TROPHIES.MOVES_500_DESC', targetCount: 500 },
  { id: 'moves_2000', icon: '🏃', category: 'STATS', titleKey: 'TROPHIES.MOVES_2000_TITLE', descKey: 'TROPHIES.MOVES_2000_DESC', targetCount: 2000 },
  { id: 'no_walls_win', icon: '🎯', category: 'STATS', titleKey: 'TROPHIES.NO_WALLS_WIN_TITLE', descKey: 'TROPHIES.NO_WALLS_WIN_DESC', targetCount: 1 }
];

export function getTrophyById(id: string): ITrophy | undefined {
  return TROPHIES_LIST.find(t => t.id === id);
}
