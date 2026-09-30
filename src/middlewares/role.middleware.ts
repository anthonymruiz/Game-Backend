import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.config.js';

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded: any = jwt.verify(token, ENV.JWT_SECRET);
      req.user = decoded;
      
      // If the user's role is not in the allowed roles list AND they are not a superadmin
      if (!roles.includes(decoded.role) && decoded.role !== 'superadmin') {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      }
      
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
};
