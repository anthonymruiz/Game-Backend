import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import type { BadgeEvent } from './badge.enum.js';
import { User } from './user.entity.js';

@Entity('badge_event_receipts')
@Index('UQ_badge_event_receipts_source', ['userId', 'event', 'sourceId'], { unique: true })
export class BadgeEventReceipt extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 32 })
  event!: BadgeEvent;

  @Column({ type: 'varchar', length: 128 })
  sourceId!: string;
}
