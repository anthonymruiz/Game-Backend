import { ENV } from '../config/env.config.js';

export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;

  const allowedOrigins = [
    ENV.FRONTEND_URL,
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://192.168.100.4:4200',
    'http://192.168.100.4:3000'
  ].filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // In non-production environments, allow local development hostnames & private LAN ranges
  if (ENV.NODE_ENV !== 'production') {
    try {
      const parsed = new URL(origin);
      const hostname = parsed.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}
