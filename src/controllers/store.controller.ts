import type { Request, Response } from 'express';
import { injectable, container } from 'tsyringe';
import { StoreItemService } from '../services/store-item.service.js';
import { StripePaymentService, StripeWebhookSignatureError } from '../services/stripe-payment.service.js';
import { NotificationService } from '../services/notification.service.js';
import { PointPackageService } from '../services/point-package.service.js';

@injectable()
export class StoreController {
  private storeItemService = container.resolve(StoreItemService);
  private pointPackageService = container.resolve(PointPackageService);
  private stripePaymentService = container.resolve(StripePaymentService);

  public createPointPackageCheckout = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const checkout = await this.stripePaymentService.createCheckoutSession(
        userId,
        req.params.packageId as string
      );
      res.status(201).json(checkout);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'CHECKOUT_CREATION_FAILED';
      if (code === 'POINT_PACKAGE_NOT_FOUND' || code === 'USER_NOT_FOUND') {
        res.status(404).json({ error: code });
      } else if (code === 'USER_STATS_NOT_FOUND' || code === 'POINT_PACKAGE_PRICE_INVALID') {
        res.status(409).json({ error: code });
      } else if (code === 'STRIPE_NOT_CONFIGURED') {
        res.status(503).json({ error: code });
      } else {
        console.error('[StoreController] Failed to create Stripe checkout session:', error);
        res.status(502).json({ error: 'CHECKOUT_CREATION_FAILED' });
      }
    }
  };

  public verifyPointPackageCheckout = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.sub || req.user?.id;
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!sessionId || sessionId.length > 255) {
      res.status(400).json({ error: 'INVALID_SESSION_ID' });
      return;
    }
    try {
      const result = await this.stripePaymentService.verifyCheckoutSession(userId, sessionId);
      res.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'PAYMENT_VERIFICATION_FAILED';
      if (code === 'PAYMENT_NOT_FOUND') {
        res.status(404).json({ error: code });
      } else if (code === 'PAYMENT_SESSION_MISMATCH' || code === 'PAYMENT_VALIDATION_FAILED') {
        res.status(403).json({ error: code });
      } else if (code === 'STRIPE_NOT_CONFIGURED') {
        res.status(503).json({ error: code });
      } else {
        console.error('[StoreController] Failed to verify Stripe checkout:', error);
        res.status(502).json({ error: 'PAYMENT_VERIFICATION_FAILED' });
      }
    }
  };

  public handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'INVALID_WEBHOOK_BODY' });
      return;
    }
    const signature = req.headers['stripe-signature'];
    try {
      await this.stripePaymentService.handleWebhook(
        req.body,
        Array.isArray(signature) ? signature[0] : signature
      );
      res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof StripeWebhookSignatureError) {
        res.status(400).json({ error: 'INVALID_STRIPE_SIGNATURE' });
      } else if (error instanceof Error && error.message === 'STRIPE_WEBHOOK_NOT_CONFIGURED') {
        console.error('[StoreController] Stripe webhook secret is not configured.');
        res.status(503).json({ error: 'STRIPE_WEBHOOK_NOT_CONFIGURED' });
      } else {
        console.error('[StoreController] Failed to process Stripe webhook:', error);
        res.status(500).json({ error: 'STRIPE_WEBHOOK_PROCESSING_FAILED' });
      }
    }
  };

  public getItems = async (_req: Request, res: Response): Promise<void> => {
    try {
      const items = await this.storeItemService.getItems();
      res.status(200).json({ items });
    } catch (error) {
      console.error('[StoreController] Failed to load store items:', error);
      res.status(500).json({ message: 'Could not load store items.' });
    }
  };

  public getAdminItems = async (_req: Request, res: Response): Promise<void> => {
    try {
      const items = await this.storeItemService.getItems(true);
      res.status(200).json({ items });
    } catch (error) {
      console.error('[StoreController] Failed to load admin store items:', error);
      res.status(500).json({ message: 'Could not load store items.' });
    }
  };

  public getInventory = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const items = await this.storeItemService.getInventory(userId);
      res.status(200).json({ items });
    } catch (error) {
      console.error('[StoreController] Failed to load user store inventory:', error);
      res.status(500).json({ message: 'Could not load store inventory.' });
    }
  };

  public searchGiftRecipients = async (req: Request, res: Response): Promise<void> => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (query.length < 2 || query.length > 50) {
      res.status(400).json({ error: 'INVALID_SEARCH_QUERY' });
      return;
    }
    try {
      const recipients = await this.storeItemService.searchGiftRecipients(query);
      res.status(200).json({ recipients });
    } catch (error) {
      console.error('[StoreController] Failed to search gift recipients:', error);
      res.status(500).json({ error: 'GIFT_RECIPIENT_SEARCH_FAILED' });
    }
  };

  public giftItem = async (req: Request, res: Response): Promise<void> => {
    const senderId = req.user?.sub || req.user?.id;
    const recipientUserIds: unknown = req.body?.recipientUserIds ?? (
      typeof req.body?.recipientUserId === 'string' ? [req.body.recipientUserId] : undefined
    );
    if (!senderId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!Array.isArray(recipientUserIds) ||
      recipientUserIds.length === 0 ||
      recipientUserIds.some(id => typeof id !== 'string' || !id.trim())
    ) {
      res.status(400).json({ error: 'INVALID_GIFT_RECIPIENT' });
      return;
    }
    const uniqueRecipientIds = [...new Set((recipientUserIds as string[]).map(id => id.trim()))];
    try {
      const result = await this.storeItemService.giftItem(
        senderId,
        uniqueRecipientIds,
        req.params.id as string
      );
      const notificationService = container.resolve(NotificationService);
      for (const recipient of result.recipients) {
        try {
          await notificationService.sendNotification(
            recipient.id,
            'STORE_ITEM_GIFTED',
            'STORE_ITEM_GIFTED_TITLE',
            'STORE_ITEM_GIFTED_MSG',
            result.itemName
          );
        } catch (notificationError) {
          console.error(
            `[StoreController] Gift succeeded for ${recipient.id}, but its notification could not be sent:`,
            notificationError
          );
        }
      }
      const firstRecipient = result.recipients[0];
      const firstAcquisition = result.acquisitions[0];
      res.status(201).json({
        acquisitionId: firstAcquisition.id,
        recipient: firstRecipient,
        acquisitionIds: result.acquisitions.map(acquisition => acquisition.id),
        recipients: result.recipients,
        storeItemId: firstAcquisition.storeItemId
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'STORE_ITEM_GIFT_FAILED';
      if (code === 'INVALID_GIFT_RECIPIENT') {
        res.status(400).json({ error: code });
      } else if (code === 'GIFT_RECIPIENT_NOT_FOUND' || code === 'STORE_ITEM_NOT_FOUND') {
        res.status(404).json({ error: code });
      } else if (code === 'GIFT_RECIPIENT_UNAVAILABLE') {
        res.status(409).json({ error: code });
      } else if (code === 'GIFT_SENDER_NOT_ADMIN') {
        res.status(403).json({ error: code });
      } else {
        console.error('[StoreController] Failed to gift store item:', error);
        res.status(500).json({ error: 'STORE_ITEM_GIFT_FAILED' });
      }
    }
  };

  public giftPointPackage = async (req: Request, res: Response): Promise<void> => {
    const recipientUserId = typeof req.body?.recipientUserId === 'string'
      ? req.body.recipientUserId.trim()
      : '';
    if (!recipientUserId) {
      res.status(400).json({ error: 'INVALID_GIFT_RECIPIENT' });
      return;
    }
    try {
      const result = await this.pointPackageService.giftPackagePoints(
        recipientUserId,
        req.params.id as string
      );
      try {
        await container.resolve(NotificationService).sendNotification(
          result.recipient.id,
          'POINTS_GIFTED',
          'POINTS_GIFTED_TITLE',
          'POINTS_GIFTED_MSG',
          String(result.points)
        );
      } catch (notificationError) {
        console.error(
          `[StoreController] Points gift succeeded for ${result.recipient.id}, but its notification could not be sent:`,
          notificationError
        );
      }
      res.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'POINTS_GIFT_FAILED';
      if (code === 'POINT_PACKAGE_NOT_FOUND' || code === 'GIFT_RECIPIENT_NOT_FOUND') {
        res.status(404).json({ error: code });
      } else if (code === 'GIFT_RECIPIENT_UNAVAILABLE' || code === 'POINT_PACKAGE_INVALID') {
        res.status(409).json({ error: code });
      } else {
        console.error('[StoreController] Failed to gift point package:', error);
        res.status(500).json({ error: 'POINTS_GIFT_FAILED' });
      }
    }
  };

  public purchaseItem = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const result = await this.storeItemService.purchaseItem(userId, req.params.id as string);
      try {
        await container.resolve(NotificationService).sendNotification(
          userId,
          'STORE_ITEM_PURCHASED',
          'STORE_ITEM_PURCHASED_TITLE',
          'STORE_ITEM_PURCHASED_MSG',
          result.itemName
        );
      } catch (notificationError) {
        console.error('[StoreController] Item purchase succeeded, but its notification could not be sent:', notificationError);
      }
      res.status(200).json({
        userPoints: result.userPoints,
        acquisition: {
          id: result.acquisition.id,
          storeItemId: result.acquisition.storeItemId,
          pricePointsPaid: result.acquisition.pricePointsPaid,
          acquiredAt: result.acquisition.createdAt
        }
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'STORE_PURCHASE_FAILED';
      if (code === 'STORE_ITEM_NOT_FOUND' || code === 'USER_NOT_FOUND') {
        res.status(404).json({ error: code });
      } else if (code === 'STORE_ITEM_UNAVAILABLE' || code === 'INSUFFICIENT_POINTS') {
        res.status(409).json({ error: code });
      } else {
        console.error('[StoreController] Failed to purchase store item:', error);
        res.status(500).json({ error: code === 'USER_STATS_NOT_FOUND' ? code : 'STORE_PURCHASE_FAILED' });
      }
    }
  };

  public updateItemStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const item = await this.storeItemService.updateStatus(req.params.id as string, req.body?.status);
      res.status(200).json({ item });
    } catch (error) {
      this.handleStoreItemWriteError(res, error, 'update item status');
    }
  };

  public createItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const item = await this.storeItemService.createItem(req.body?.item);
      res.status(201).json({ item });
    } catch (error) {
      this.handleStoreItemWriteError(res, error, 'create item');
    }
  };

  public updateItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const item = await this.storeItemService.updateItem(req.params.id as string, req.body?.item);
      res.status(200).json({ item });
    } catch (error) {
      this.handleStoreItemWriteError(res, error, 'update item');
    }
  };

  private handleStoreItemWriteError(res: Response, error: unknown, operation: string): void {
    const message = error instanceof Error ? error.message : `Could not ${operation}.`;
    if (message === 'Store item not found.') {
      res.status(404).json({ message });
    } else if (message.includes('already exists')) {
      res.status(409).json({ message });
    } else if (message.startsWith('Store item') || message === 'Item status is invalid.') {
      res.status(400).json({ message });
    } else {
      console.error(`[StoreController] Failed to ${operation}:`, error);
      res.status(500).json({ message: `Could not ${operation}.` });
    }
  }
}
