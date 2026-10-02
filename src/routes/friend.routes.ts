import { Router } from 'express';
import { FriendController } from '../controllers/friend.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const friendRoutes: Router = Router();
const controller = new FriendController();

friendRoutes.use(requireAuth);

friendRoutes.get('/', controller.getFriends);
friendRoutes.get('/requests', controller.getRequests);
friendRoutes.get('/count', controller.getCount);
friendRoutes.get('/search', controller.searchUsers);
friendRoutes.get('/status/:targetUserId', controller.getStatus);
friendRoutes.post('/request/:targetUserId', controller.sendRequest);
friendRoutes.post('/accept/:friendshipId', controller.acceptRequest);
friendRoutes.post('/reject/:friendshipId', controller.rejectRequest);
friendRoutes.delete('/:friendId', controller.removeFriend);
