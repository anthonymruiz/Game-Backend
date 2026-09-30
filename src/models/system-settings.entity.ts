import { Entity, Column } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('system_settings')
export class SystemSettings extends AbstractBaseEntity {
  @Column({ type: 'boolean', default: false })
  maintenanceMode!: boolean;

  @Column({ type: 'int', default: 30 })
  turnTimeLimitSeconds!: number;

  @Column({ type: 'int', default: 3 })
  maxStrikesBeforeKick!: number;

  @Column({ type: 'boolean', default: true })
  allowNewRegistrations!: boolean;

  @Column({ type: 'text', nullable: true })
  announcementBanner?: string;
}
