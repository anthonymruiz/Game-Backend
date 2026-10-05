import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { Badge } from './badge.entity.js';
import { User } from './user.entity.js';

@Entity('user_badges')
@Index('UQ_user_badges_user_badge', ['userId', 'badgeId'], { unique: true })
@Index('IDX_user_badges_badge', ['badgeId'])
@Index('IDX_user_badges_badge_unlocked', ['badgeId', 'unlockedAt'])
export class UserBadge extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 36 })
  badgeId!: string;

  @ManyToOne(() => Badge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'badgeId' })
  badge!: Badge;

  @Column({ type: 'int', unsigned: true, default: 0 })
  progress!: number;

  @Column({ type: 'datetime', nullable: true })
  unlockedAt!: Date | null;
}
