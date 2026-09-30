import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENV } from './env.config.js';

import { User } from '../models/user.entity.js';
import { Preferences } from '../models/preferences.entity.js';
import { Stats } from '../models/stats.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';
import { Ban } from '../models/ban.entity.js';
import { Notification } from '../models/notification.entity.js';
import { Report } from '../models/report.entity.js';
import { SystemSettings } from '../models/system-settings.entity.js';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: ENV.DB.HOST,
  port: ENV.DB.PORT,
  username: ENV.DB.USER,
  password: ENV.DB.PASS,
  database: ENV.DB.NAME,
  synchronize: false,
  logging: ENV.NODE_ENV === 'development',
  entities: [User, Preferences, Stats, MatchHistory, Ban, Notification, Report, SystemSettings],
  migrations: ['dist/migrations/**/*.js', 'src/migrations/**/*.ts'],
  subscribers: [],
});
