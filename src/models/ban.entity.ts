import { Entity, Column, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

@Entity('bans')
export class Ban extends AbstractBaseEntity {
  @ManyToOne(() => User, (user) => user.bans)
  user!: any;

  @Column({ type: 'varchar' })
  reason!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;
}
