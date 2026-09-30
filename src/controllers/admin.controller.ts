import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { AppDataSource } from '../config/database.config.js';
import { User } from '../models/user.entity.js';
import { MatchHistory } from '../models/match-history.entity.js';

@injectable()
export class AdminController {
  
  public async getMetrics(req: Request, res: Response) {
    try {
      const userRepo = AppDataSource.getRepository(User);
      const matchRepo = AppDataSource.getRepository(MatchHistory);

      const totalUsers = await userRepo.count();
      const totalMatches = await matchRepo.count();
      
      const onlineUsers = Math.floor(Math.random() * 100); // Mocked for simplicity right now

      return res.status(200).json({
        totalUsers,
        totalMatches,
        onlineUsers
      });
    } catch (error) {
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  public async getUsers(req: Request, res: Response) {
    try {
      const currentUser = req.user!;
      const userRepo = AppDataSource.getRepository(User);
      
      let users = await userRepo.find({
        select: ['id', 'username', 'email', 'role', 'createdAt']
      });

      if (currentUser.role === 'admin') {
        // Admins cannot see other admins or superadmins
        users = users.filter(u => u.role === 'user');
      }

      return res.status(200).json(users);
    } catch (error) {
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  public async banUser(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userRepo = AppDataSource.getRepository(User);
      const targetUser = await userRepo.findOne({ where: { id }});
      
      if (!targetUser) return res.status(404).json({ message: 'User not found' });
      
      if (targetUser.role === 'superadmin' || targetUser.role === 'admin') {
        return res.status(403).json({ message: 'Cannot ban admins' });
      }

      targetUser.role = 'banned'; 
      await userRepo.save(targetUser);

      return res.status(200).json({ message: 'User banned' });
    } catch (error) {
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  public async createAdmin(req: Request, res: Response) {
    try {
      const currentUser = req.user!;
      if (currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: 'Only superadmin can create admins' });
      }

      const { id } = req.body;
      const userRepo = AppDataSource.getRepository(User);
      const targetUser = await userRepo.findOne({ where: { id }});

      if (!targetUser) return res.status(404).json({ message: 'User not found' });
      
      targetUser.role = 'admin';
      await userRepo.save(targetUser);

      return res.status(200).json({ message: 'User promoted to admin' });
    } catch (error) {
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
}
