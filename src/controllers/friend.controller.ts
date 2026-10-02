import { Request, Response } from 'express';
import { container } from 'tsyringe';
import { FriendService } from '../services/friend.service.js';

export class FriendController {
  private get friendService(): FriendService {
    return container.resolve(FriendService);
  }

  public sendRequest = async (req: Request, res: Response): Promise<Response> => {
    try {
      const requesterId = String((req as any).user?.id || (req as any).user?.sub);
      const targetUserId = String(req.params.targetUserId);
      const friendship = await this.friendService.sendRequest(requesterId, targetUserId);
      return res.status(200).json({ success: true, friendship });
    } catch (err: any) {
      return res.status(400).json({ message: err.message || 'Error sending friend request' });
    }
  };

  public acceptRequest = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const friendshipId = String(req.params.friendshipId);
      const friendship = await this.friendService.acceptRequest(userId, friendshipId);
      return res.status(200).json({ success: true, friendship });
    } catch (err: any) {
      return res.status(400).json({ message: err.message || 'Error accepting friend request' });
    }
  };

  public rejectRequest = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const friendshipId = String(req.params.friendshipId);
      await this.friendService.rejectRequest(userId, friendshipId);
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(400).json({ message: err.message || 'Error rejecting friend request' });
    }
  };

  public removeFriend = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const friendId = String(req.params.friendId);
      await this.friendService.removeFriend(userId, friendId);
      return res.status(200).json({ success: true });
    } catch (err: any) {
      return res.status(400).json({ message: err.message || 'Error removing friend' });
    }
  };

  public getFriends = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const friends = await this.friendService.getFriends(userId);
      return res.status(200).json({ friends });
    } catch (err: any) {
      return res.status(500).json({ message: err.message || 'Error fetching friends' });
    }
  };

  public getRequests = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const requests = await this.friendService.getRequests(userId);
      return res.status(200).json(requests);
    } catch (err: any) {
      return res.status(500).json({ message: err.message || 'Error fetching requests' });
    }
  };

  public getStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const targetUserId = String(req.params.targetUserId);
      const statusInfo = await this.friendService.getFriendshipStatus(userId, targetUserId);
      return res.status(200).json(statusInfo);
    } catch (err: any) {
      return res.status(500).json({ message: err.message || 'Error fetching friendship status' });
    }
  };

  public getCount = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const count = await this.friendService.getPendingCount(userId);
      return res.status(200).json({ count });
    } catch (err: any) {
      return res.status(500).json({ message: err.message || 'Error fetching pending count' });
    }
  };

  public searchUsers = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = String((req as any).user?.id || (req as any).user?.sub);
      const query = String(req.query.q || '');
      const users = await this.friendService.searchUsers(userId, query);
      return res.status(200).json({ users });
    } catch (err: any) {
      return res.status(500).json({ message: err.message || 'Error searching users' });
    }
  };
}
