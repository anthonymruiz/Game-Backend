import { singleton } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { DeviceSession } from '../models/device-session.entity.js';

@singleton()
export class DeviceSessionService {
  private repository = AppDataSource.getRepository(DeviceSession);

  private cleanIpAddress(ip?: string): string {
    if (!ip) return '127.0.0.1';
    let clean = ip.trim();
    if (clean.startsWith('::ffff:')) clean = clean.substring(7);
    if (clean === '::1' || clean === '127.0.0.1' || clean === 'localhost') return '127.0.0.1';
    return clean;
  }

  public async registerOrUpdateSession(
    userId: string,
    deviceId: string,
    deviceName: string,
    token: string,
    ipAddress?: string
  ): Promise<DeviceSession> {
    if (!userId || !deviceId) {
      throw new Error('UserId and DeviceId are required.');
    }

    let session = await this.repository.findOne({
      where: { userId, deviceId }
    });

    if (!session) {
      session = new DeviceSession();
      session.userId = userId;
      session.deviceId = deviceId;
    }

    session.deviceName = deviceName || 'Desconocido';
    session.token = token;
    session.ipAddress = this.cleanIpAddress(ipAddress);
    session.isActive = true;
    session.lastActiveAt = new Date();

    return this.repository.save(session);
  }

  public async isSessionValid(
    userId: string,
    token: string,
    deviceId?: string,
    ipAddress?: string,
    deviceName?: string
  ): Promise<boolean> {
    if (!userId || !token) return false;

    // Guests don't require BD session validation
    if (userId.startsWith('guest_')) return true;

    let session: DeviceSession | null = null;

    if (deviceId) {
      session = await this.repository.findOne({
        where: { userId, deviceId, isActive: true }
      });
    }

    if (!session) {
      session = await this.repository.findOne({
        where: { userId, token, isActive: true }
      });
    }

    // Auto-register session if missing for active user token
    if (!session && deviceId) {
      session = await this.registerOrUpdateSession(userId, deviceId, deviceName || 'Desconocido', token, ipAddress);
    }

    if (!session || !session.isActive) {
      return false;
    }

    // Touch lastActiveAt & IP address
    const now = Date.now();
    let needsSave = false;
    if (!session.lastActiveAt || (now - new Date(session.lastActiveAt).getTime()) > 30000) {
      session.lastActiveAt = new Date();
      needsSave = true;
    }
    const cleanIp = this.cleanIpAddress(ipAddress);
    if (cleanIp && session.ipAddress !== cleanIp) {
      session.ipAddress = cleanIp;
      needsSave = true;
    }
    if (needsSave) {
      this.repository.save(session).catch(() => {});
    }

    return true;
  }

  public async getUserSessions(userId: string, currentDeviceId?: string): Promise<any[]> {
    const sessions = await this.repository.find({
      where: { userId, isActive: true },
      order: { lastActiveAt: 'DESC' }
    });

    return sessions.map(s => ({
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      ipAddress: this.cleanIpAddress(s.ipAddress),
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
      isCurrent: currentDeviceId ? s.deviceId === currentDeviceId : false
    }));
  }

  public async revokeSession(userId: string, sessionId: string): Promise<{ success: boolean; revokedDeviceId?: string }> {
    const session = await this.repository.findOne({
      where: { id: sessionId, userId }
    });

    if (!session) return { success: false };

    session.isActive = false;
    await this.repository.save(session);
    return { success: true, revokedDeviceId: session.deviceId };
  }

  public async revokeOtherSessions(userId: string, currentDeviceId: string): Promise<{ revokedCount: number; revokedDeviceIds: string[] }> {
    const sessions = await this.repository.find({
      where: { userId, isActive: true }
    });

    let revokedCount = 0;
    const revokedDeviceIds: string[] = [];
    for (const s of sessions) {
      if (s.deviceId !== currentDeviceId) {
        s.isActive = false;
        await this.repository.save(s);
        revokedCount++;
        revokedDeviceIds.push(s.deviceId);
      }
    }

    return { revokedCount, revokedDeviceIds };
  }

  public async logoutSession(userId: string, token: string, deviceId?: string): Promise<boolean> {
    if (!userId) return false;

    const sessions = await this.repository.find({
      where: { userId, isActive: true }
    });

    let matched = false;
    for (const session of sessions) {
      if ((deviceId && session.deviceId === deviceId) || (token && session.token === token)) {
        session.isActive = false;
        await this.repository.save(session);
        matched = true;
      }
    }

    if (!matched && sessions.length > 0) {
      for (const session of sessions) {
        session.isActive = false;
        await this.repository.save(session);
      }
      matched = true;
    }

    return matched;
  }
}

