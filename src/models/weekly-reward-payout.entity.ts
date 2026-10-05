import { Column, Entity, Index } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('weekly_reward_payouts')
@Index('UQ_weekly_reward_payouts_weekStart', ['weekStart'], { unique: true })
export class WeeklyRewardPayout extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 10 })
  weekStart!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  firstPlaceUserId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  secondPlaceUserId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  thirdPlaceUserId!: string | null;
}
