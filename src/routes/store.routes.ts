import { Router } from 'express';
import { container } from 'tsyringe';
import { PointPackageService } from '../services/point-package.service.js';
import { StoreController } from '../controllers/store.controller.js';
import { requireAuth } from '../middlewares/role.middleware.js';

export const storeRoutes: Router = Router();
const getStoreController = () => container.resolve(StoreController);

storeRoutes.get('/items', (req, res) => getStoreController().getItems(req, res));
storeRoutes.get('/me/items', requireAuth, (req, res) => getStoreController().getInventory(req, res));
storeRoutes.post('/items/:id/obtain', requireAuth, (req, res) => getStoreController().purchaseItem(req, res));

storeRoutes.get('/point-packages', async (req, res) => {
  try {
    const packages = await container.resolve(PointPackageService).getPackages();
    res.status(200).json({ packages });
  } catch (error) {
    console.error('[StoreRoutes] Failed to load point packages:', error);
    res.status(500).json({ message: 'Could not load point packages.' });
  }
});

storeRoutes.post('/point-packages/:packageId/checkout', requireAuth, (req, res) =>
  getStoreController().createPointPackageCheckout(req, res));
storeRoutes.post('/point-packages/checkout/verify', requireAuth, (req, res) =>
  getStoreController().verifyPointPackageCheckout(req, res));
storeRoutes.post('/stripe/webhook', (req, res) => getStoreController().handleStripeWebhook(req, res));
