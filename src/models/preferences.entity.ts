import { Entity, Column } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('preferences')
export class Preferences extends AbstractBaseEntity {
  @Column({ default: 'en' })
  language!: string;

  @Column({ default: 'light' })
  theme!: string;

  @Column({ nullable: true })
  fcmToken?: string;
}
