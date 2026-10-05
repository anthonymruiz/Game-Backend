process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_12345';

import 'reflect-metadata';
import http from 'http';
import { container } from 'tsyringe';
import { App } from '../app.js';
import { AppDataSource } from '../config/database.config.js';
import { seedLevelProgressionConfig, seedRankTiers, seedSuperAdmin, seedSystemSettings } from '../utils/seed.utils.js';

let appInstance: App | null = null;

export async function setupTestEnvironment() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  await seedSuperAdmin();
  await seedSystemSettings();
  await seedLevelProgressionConfig();
  await seedRankTiers();

  if (!appInstance) {
    appInstance = container.resolve(App);
  }

  return appInstance.expressApp;
}

export async function teardownTestEnvironment() {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

export function makeRequest(app: any, method: string, path: string, body?: any, token?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      const port = address.port;
      const url = `http://127.0.0.1:${port}${path}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          server.close(() => {
            resolve({ status: res.status, body: json });
          });
        })
        .catch((err) => {
          server.close(() => {
            reject(err);
          });
        });
    });
  });
}
