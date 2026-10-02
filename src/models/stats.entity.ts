import { Entity, Column } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('stats')
export class Stats extends AbstractBaseEntity {
  @Column({ type: 'int', default: 0 })
  wins!: number;

  @Column({ type: 'int', default: 0 })
  losses!: number;

  @Column({ type: 'int', default: 0 })
  draws!: number;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @Column({ type: 'int', default: 1000 })
  elo!: number;
}
