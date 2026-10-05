import { Column, Entity } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

export interface IPointPackageLocalization {
  name: string;
  description: string;
}

export type PointPackageConfiguration = Partial<Record<'en' | 'es', IPointPackageLocalization>>;

@Entity('point_packages')
export class PointPackage extends AbstractBaseEntity {
  @Column({ type: 'json' })
  configuration!: PointPackageConfiguration;

  @Column({ type: 'int' })
  points!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceUsd!: number;

  @Column({ name: 'StripePriceUrl', type: 'varchar', length: 255, default: "''" })
  stripePriceUrl!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}
