import rateLimit, { Options } from 'express-rate-limit';
import { ENV } from '../config/env.config.js';

export const createRateLimiter = (options: Partial<Options>) => {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options
  });
};

export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, please try again later.' },
  skip: () => ENV.NODE_ENV === 'test'
});

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts, please try again later.' },
  skip: () => ENV.NODE_ENV === 'test'
});
