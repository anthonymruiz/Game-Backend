import { Column, Entity } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

export interface IRankLocaleConfiguration {
  name: string;
  description: string;
  motto: string;
}

export type RankConfiguration = Record<'es' | 'en', IRankLocaleConfiguration>;

@Entity('rank_tiers')
export class RankTier extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 64, unique: true })
  key!: string;

  @Column({ type: 'int', unique: true })
  level!: number;

  @Column({ type: 'varchar', length: 32 })
  emoji!: string;

  @Column({ type: 'text' })
  badgeBg!: string;

  @Column({ type: 'varchar', length: 16 })
  textColor!: string;

  @Column({ type: 'json' })
  configuration!: RankConfiguration;
}
