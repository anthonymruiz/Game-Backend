import { Column, Entity } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('level_progression_config')
export class LevelProgressionConfig extends AbstractBaseEntity {
  @Column({ type: 'int', unique: true, default: 1 })
  singletonKey!: number;

  @Column({ type: 'int', default: 10 })
  baseXpPerLevel!: number;

  @Column({ type: 'decimal', precision: 8, scale: 3, default: 1.049 })
  exponentialMultiplier!: number;

  @Column({ type: 'int', default: 100 })
  maxLevel!: number;
}
