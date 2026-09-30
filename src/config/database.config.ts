import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENV } from './env.config.js';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: ENV.DB.HOST,
  port: ENV.DB.PORT,
  username: ENV.DB.USER,
  password: ENV.DB.PASS,
  database: ENV.DB.NAME,
  synchronize: ENV.NODE_ENV === 'development',
  logging: ENV.NODE_ENV === 'development',
  entities: ['src/models/**/*.ts'],
  migrations: ['src/migrations/**/*.ts'],
  subscribers: [],
});
