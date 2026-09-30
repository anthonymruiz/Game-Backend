import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENV } from './env.config.js';

import { User } from '../models/user.entity.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Ban } from '../models/ban.entity.js';
import { Notification } from '../models/notification.entity.js';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: ENV.DB.HOST,
  port: ENV.DB.PORT,
  username: ENV.DB.USER,
  password: ENV.DB.PASS,
  database: ENV.DB.NAME,
  synchronize: true, // Code-first approach: Auto-create tables on launch
  logging: ENV.NODE_ENV === 'development',
  entities: [User, Preferences, Stats, MatchHistory, Ban, Notification],
  migrations: ['src/migrations/**/*.ts'],
  subscribers: [],
});
