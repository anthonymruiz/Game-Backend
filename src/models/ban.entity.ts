import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

@Entity('bans')
export class Ban extends AbstractBaseEntity {
  @ManyToOne(() => User, (user) => user.bans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: any;

  @Column({ type: 'varchar', nullable: true })
  userId?: string;

  @Column({ type: 'varchar' })
  reason!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;
}
