import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || (nodeEnv === 'production' ? '' : 'dev_jwt_secret_antigravity_safe_key_123');
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_refresh' : (nodeEnv === 'production' ? '' : 'dev_jwt_refresh_secret_safe_key_123'));

if (nodeEnv === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'fallback_secret' || process.env.JWT_SECRET.length < 32) {
    throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET must be set and contain at least 32 characters in production.');
  }
}

export const ENV = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: nodeEnv,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:4200',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  DB: {
    HOST: process.env.DB_HOST || 'localhost',
    PORT: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    USER: process.env.DB_USER || 'root',
    PASS: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    NAME: process.env.DB_NAME || 'game',
  },
  JWT_SECRET: jwtSecret,
  JWT_REFRESH_SECRET: jwtRefreshSecret,
};
