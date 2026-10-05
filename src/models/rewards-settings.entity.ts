import { Column, Entity } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('rewards_settings')
export class RewardsSettings extends AbstractBaseEntity {
  @Column({ type: 'int', unique: true, default: 1 })
  singletonKey!: number;

  @Column({ type: 'int', default: 10 })
  pointsPerWin!: number;

  @Column({ type: 'int', default: 10 })
  rankedPointsPerWin!: number;

  @Column({ type: 'int', default: 10 })
  dailyRewardPoints!: number;

  @Column({ type: 'int', default: 10 })
  pointsPerLevelUp!: number;

  @Column({ type: 'int', default: 10 })
  pointsPerRankUp!: number;

  @Column({ type: 'int', default: 10 })
  pointsPerBadge!: number;

  @Column({ type: 'int', default: 500 })
  weeklyFirstPlacePoints!: number;

  @Column({ type: 'int', default: 300 })
  weeklySecondPlacePoints!: number;

  @Column({ type: 'int', default: 100 })
  weeklyThirdPlacePoints!: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  weeklyMysteryGiftItemId!: string | null;
}
