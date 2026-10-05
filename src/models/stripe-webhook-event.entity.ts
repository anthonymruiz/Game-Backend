import { Column, Entity, Index } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('stripe_webhook_events')
@Index('IDX_stripe_webhook_events_event_id', ['stripeEventId'], { unique: true })
export class StripeWebhookEvent extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 255 })
  stripeEventId!: string;

  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  checkoutSessionId!: string | null;
}
