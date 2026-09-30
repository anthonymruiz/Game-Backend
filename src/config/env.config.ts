import dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB: {
    HOST: process.env.DB_HOST || 'localhost',
    PORT: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    USER: process.env.DB_USER || 'root',
    PASS: process.env.DB_PASS || '',
    NAME: process.env.DB_NAME || 'wallrush_db',
  },
  JWT_SECRET: process.env.JWT_SECRET || 'fallback_secret',
};
