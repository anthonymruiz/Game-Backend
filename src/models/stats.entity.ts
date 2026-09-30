import { Entity, Column } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('stats')
export class Stats extends AbstractBaseEntity {
  @Column({ default: 0 })
  wins!: number;

  @Column({ default: 0 })
  losses!: number;

  @Column({ default: 0 })
  draws!: number;

  @Column({ default: 1000 })
  elo!: number;
}
