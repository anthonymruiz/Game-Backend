import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { container } from 'tsyringe';
import { ENV } from '../config/env.config.js';
import { DeviceSessionService } from '../services/device-session.service.js';

export const requireRole = (roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const deviceId = req.headers['x-device-id'] as string || undefined;

    try {
      const decoded: any = jwt.verify(token, ENV.JWT_SECRET);
      req.user = decoded;

      // If the user's role is not in the allowed roles list AND they are not a superadmin
      if (!roles.includes(decoded.role) && decoded.role !== 'superadmin') {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      }

      // Check DB session validation for registered users
      if (decoded.role !== 'guest' && !decoded.id.startsWith('guest_')) {
        const rawIp = req.headers['x-client-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '';
        const ipStr = Array.isArray(rawIp) ? rawIp[0] : rawIp;
        let ipAddress = ipStr.split(',')[0].trim();
        if (ipAddress.startsWith('::ffff:')) ipAddress = ipAddress.substring(7);
        if (ipAddress === '::1') ipAddress = '127.0.0.1';

        const rawDevName = req.headers['x-device-name'] || req.headers['user-agent'];
        const deviceName = Array.isArray(rawDevName) ? rawDevName[0] : rawDevName;

        const deviceSessionService = container.resolve(DeviceSessionService);
        const isValid = await deviceSessionService.isSessionValid(decoded.id, token, deviceId, ipAddress, deviceName);
        if (!isValid) {
          return res.status(401).json({ error: 'SESSION_REVOKED', message: 'La sesión ha sido cerrada en este dispositivo.' });
        }
      }

      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
};

export const requireAuth = requireRole(['user', 'admin', 'superadmin']);
