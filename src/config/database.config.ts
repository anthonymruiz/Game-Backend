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
import { Friendship } from '../models/friendship.entity.js';
import { DeviceSession } from '../models/device-session.entity.js';
import { LevelProgressionConfig } from '../models/level-progression-config.entity.js';
import { DailyRewardClaim } from '../models/daily-reward-claim.entity.js';
import { PointPackage } from '../models/point-package.entity.js';
import { StoreItem } from '../models/store-item.entity.js';
import { UserStoreItem } from '../models/user-store-item.entity.js';
import { PointPackagePayment } from '../models/point-package-payment.entity.js';
import { StripeWebhookEvent } from '../models/stripe-webhook-event.entity.js';
import { RankTier } from '../models/rank-tier.entity.js';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: ENV.DB.HOST,
  port: ENV.DB.PORT,
  username: ENV.DB.USER,
  password: ENV.DB.PASS,
  database: ENV.DB.NAME,
  synchronize: true,
  migrationsRun: true,
  logging: ENV.NODE_ENV === 'development',
  entities: [User, Preferences, Stats, MatchHistory, Ban, Notification, Report, SystemSettings, Friendship, DeviceSession, LevelProgressionConfig, DailyRewardClaim, PointPackage, StoreItem, UserStoreItem, PointPackagePayment, StripeWebhookEvent, RankTier],
  migrations: ENV.NODE_ENV === 'production'
    ? ['dist/migrations/**/*.js']
    : ['src/migrations/**/*.ts'],
  subscribers: [],
});
