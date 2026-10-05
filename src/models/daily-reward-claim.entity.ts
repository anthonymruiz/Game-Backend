import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

@Entity('daily_reward_claims')
@Unique(['userId', 'claimDate'])
export class DailyRewardClaim extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'date' })
  claimDate!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;
}
