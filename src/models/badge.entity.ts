import { Column, Entity, Index } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import type { BadgeCategory, BadgeEvent } from './badge.enum.js';

export interface IBadgeLocale {
  name: string;
  motto: string;
  description: string;
}

export type BadgeLocales = Record<'es' | 'en', IBadgeLocale>;

@Entity('badges')
@Index('UQ_badges_code', ['code'], { unique: true })
export class Badge extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 80 })
  code!: string;

  @Column({ type: 'varchar', length: 32 })
  category!: BadgeCategory;

  @Column({ type: 'varchar', length: 32 })
  event!: BadgeEvent;

  @Column({ type: 'int', unsigned: true })
  target!: number;

  @Column({ type: 'varchar', length: 16 })
  icon!: string;

  @Column({ type: 'json' })
  locales!: BadgeLocales;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
