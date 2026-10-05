import { Entity, Column } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('preferences')
export class Preferences extends AbstractBaseEntity {
  @Column({ type: 'varchar', default: 'en' })
  language!: string;

  @Column({ type: 'varchar', default: 'light' })
  theme!: string;

  @Column({ type: 'boolean', default: false })
  hasCompletedLobbyTour = false;

  @Column({ type: 'varchar', nullable: true })
  fcmToken?: string;
}
