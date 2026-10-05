import { container, singleton } from 'tsyringe';
import Stripe from 'stripe';
import { AppDataSource } from '../config/database.config.js';
import { ENV } from '../config/env.config.js';
import { PointPackage } from '../models/point-package.entity.js';
import { PointPackagePayment, PointPackagePaymentStatus } from '../models/point-package-payment.entity.js';
import { Stats } from '../models/stats.entity.js';
import { StripeWebhookEvent } from '../models/stripe-webhook-event.entity.js';
import { User } from '../models/user.entity.js';
import { BadgeService } from './badge.service.js';

export class StripeWebhookSignatureError extends Error {
  constructor() {
    super('Invalid Stripe webhook signature.');
    this.name = 'StripeWebhookSignatureError';
  }
}

export interface PointPackageCheckoutResult {
  status: PointPackagePaymentStatus;
  pointsAwarded: number;
  balancePoints: number | null;
}

@singleton()
export class StripePaymentService {
  private stripeClient?: Stripe;

  private get stripe(): Stripe {
    if (!ENV.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_NOT_CONFIGURED');
    }
    this.stripeClient ??= new Stripe(ENV.STRIPE_SECRET_KEY);
    return this.stripeClient;
  }

  public async createCheckoutSession(userId: string, packageId: string): Promise<{ url: string }> {
    const [pointPackage, user] = await Promise.all([
      AppDataSource.getRepository(PointPackage).findOneBy({ id: packageId, isActive: true }),
      AppDataSource.getRepository(User).findOne({ where: { id: userId }, relations: { stats: true } })
    ]);
    if (!pointPackage) throw new Error('POINT_PACKAGE_NOT_FOUND');
    if (!user) throw new Error('USER_NOT_FOUND');
    if (!user.stats) throw new Error('USER_STATS_NOT_FOUND');

    const priceUsd = Number(pointPackage.priceUsd);
    const amountTotal = Math.round(priceUsd * 100);
    if (!Number.isSafeInteger(amountTotal) || amountTotal < 1) {
      throw new Error('POINT_PACKAGE_PRICE_INVALID');
    }

    const packageName = pointPackage.configuration.en?.name || pointPackage.configuration.es?.name || 'Points package';
    const paymentRepository = AppDataSource.getRepository(PointPackagePayment);
    const payment = await paymentRepository.save(paymentRepository.create({
      userId,
      pointPackageId: pointPackage.id,
      points: pointPackage.points,
      amountTotal,
      currency: 'usd',
      packageName,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      status: PointPackagePaymentStatus.PENDING
    }));

    try {
      const lineItem = await this.createLineItem(pointPackage, amountTotal, packageName);
      const checkoutSession = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [lineItem],
        client_reference_id: userId,
        metadata: {
          paymentId: payment.id,
          userId,
          pointPackageId: pointPackage.id
        },
        payment_intent_data: {
          metadata: {
            paymentId: payment.id,
            userId,
            pointPackageId: pointPackage.id
          }
        },
        success_url: `${this.frontendBaseUrl}/store?tab=points&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.frontendBaseUrl}/store?tab=points&checkout=cancelled`
      }, {
        idempotencyKey: `point-package-checkout-${payment.id}`
      });

      if (!checkoutSession.url) {
        throw new Error('STRIPE_CHECKOUT_URL_MISSING');
      }

      payment.stripeCheckoutSessionId = checkoutSession.id;
      await paymentRepository.save(payment);
      return { url: checkoutSession.url };
    } catch (error) {
      payment.status = PointPackagePaymentStatus.FAILED;
      await paymentRepository.save(payment);
      throw error;
    }
  }

  public async verifyCheckoutSession(userId: string, sessionId: string): Promise<PointPackageCheckoutResult> {
    const payment = await AppDataSource.getRepository(PointPackagePayment).findOneBy({
      userId,
      stripeCheckoutSessionId: sessionId
    });
    if (!payment) throw new Error('PAYMENT_NOT_FOUND');
    if (payment.status === PointPackagePaymentStatus.PAID) {
      const user = await AppDataSource.getRepository(User).findOne({
        where: { id: userId },
        relations: { stats: true }
      });
      if (!user?.stats) throw new Error('USER_STATS_NOT_FOUND');
      return {
        status: PointPackagePaymentStatus.PAID,
        pointsAwarded: payment.points,
        balancePoints: user.stats.points
      };
    }

    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.paymentId !== payment.id ||
      session.metadata?.userId !== userId ||
      session.metadata?.pointPackageId !== payment.pointPackageId) {
      throw new Error('PAYMENT_SESSION_MISMATCH');
    }
    if (session.payment_status !== 'paid') {
      return {
        status: payment.status,
        pointsAwarded: 0,
        balancePoints: null
      };
    }
    return this.creditPaidSession(session);
  }

  public async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
    if (!ENV.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_NOT_CONFIGURED');
    if (!signature) throw new StripeWebhookSignatureError();

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, ENV.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new StripeWebhookSignatureError();
    }

    const eventRepository = AppDataSource.getRepository(StripeWebhookEvent);
    if (await eventRepository.findOneBy({ stripeEventId: event.id })) return;

    let sessionId: string | null = null;
    if (event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded') {
      const eventSession = event.data.object as Stripe.Checkout.Session;
      sessionId = eventSession.id;
      if (eventSession.metadata?.paymentId) {
        const session = await this.stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') await this.creditPaidSession(session);
      }
    } else if (event.type === 'checkout.session.expired') {
      const expiredSession = event.data.object as Stripe.Checkout.Session;
      sessionId = expiredSession.id;
      await AppDataSource.getRepository(PointPackagePayment).createQueryBuilder()
        .update(PointPackagePayment)
        .set({ status: PointPackagePaymentStatus.EXPIRED })
        .where('stripeCheckoutSessionId = :sessionId', { sessionId })
        .andWhere('status = :status', { status: PointPackagePaymentStatus.PENDING })
        .execute();
    }

    await eventRepository.createQueryBuilder()
      .insert()
      .into(StripeWebhookEvent)
      .values({
        stripeEventId: event.id,
        eventType: event.type,
        checkoutSessionId: sessionId
      })
      .orIgnore()
      .execute();
  }

  private async creditPaidSession(session: Stripe.Checkout.Session): Promise<PointPackageCheckoutResult> {
    if (session.mode !== 'payment' || session.payment_status !== 'paid') {
      throw new Error('PAYMENT_NOT_PAID');
    }

    const paymentId = session.metadata?.paymentId;
    const userId = session.metadata?.userId;
    const pointPackageId = session.metadata?.pointPackageId;
    if (!paymentId || !userId || !pointPackageId) throw new Error('PAYMENT_METADATA_INVALID');

    const result = await AppDataSource.transaction(async manager => {
      const payment = await manager.getRepository(PointPackagePayment).createQueryBuilder('payment')
        .where('payment.id = :paymentId', { paymentId })
        .setLock('pessimistic_write')
        .getOne();
      if (!payment ||
        payment.stripeCheckoutSessionId !== session.id ||
        payment.userId !== userId ||
        payment.pointPackageId !== pointPackageId ||
        session.client_reference_id !== userId ||
        session.currency?.toLowerCase() !== payment.currency ||
        session.amount_total !== payment.amountTotal) {
        throw new Error('PAYMENT_VALIDATION_FAILED');
      }

      const user = await manager.getRepository(User).createQueryBuilder('user')
        .leftJoinAndSelect('user.stats', 'stats')
        .where('user.id = :userId', { userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!user?.stats) throw new Error('USER_STATS_NOT_FOUND');

      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
      let newlyPaid = false;
      if (payment.status !== PointPackagePaymentStatus.PAID) {
        user.stats.points += payment.points;
        await manager.getRepository(Stats).save(user.stats);
        payment.status = PointPackagePaymentStatus.PAID;
        payment.stripePaymentIntentId = paymentIntentId;
        await manager.getRepository(PointPackagePayment).save(payment);
        newlyPaid = true;
      }

      return {
        status: payment.status,
        pointsAwarded: payment.points,
        balancePoints: user.stats.points,
        newlyPaid
      };
    });
    if (result.newlyPaid) {
      try {
        await container.resolve(BadgeService).recordEvent(userId, 'point_purchase');
      } catch (error) {
        console.error(`Failed to record point-purchase badge event for player ${userId}:`, error);
      }
    }
    return {
      status: result.status,
      pointsAwarded: result.pointsAwarded,
      balancePoints: result.balancePoints
    };
  }

  private async createLineItem(
    pointPackage: PointPackage,
    amountTotal: number,
    packageName: string
  ): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
    const stripePriceId = pointPackage.stripePriceUrl.trim();
    if (stripePriceId.startsWith('price_test_')) {
      return {
        price_data: {
          currency: 'usd',
          unit_amount: amountTotal,
          product_data: { name: packageName }
        },
        quantity: 1
      };
    }
    if (/^price_[A-Za-z0-9]+$/.test(stripePriceId)) {
      const price = await this.stripe.prices.retrieve(stripePriceId);
      if (!price.active || price.type !== 'one_time' ||
        price.currency !== 'usd' || price.unit_amount !== amountTotal) {
        throw new Error('STRIPE_PRICE_MISMATCH');
      }
      return { price: price.id, quantity: 1 };
    }
    if (stripePriceId) throw new Error('STRIPE_PRICE_ID_INVALID');

    return {
      price_data: {
        currency: 'usd',
        unit_amount: amountTotal,
        product_data: { name: packageName }
      },
      quantity: 1
    };
  }

  private get frontendBaseUrl(): string {
    return ENV.FRONTEND_URL.replace(/\/+$/, '');
  }
}
