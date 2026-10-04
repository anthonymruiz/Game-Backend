import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

@Entity('device_sessions')
export class DeviceSession extends AbstractBaseEntity {
  @Column({ type: 'varchar' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar' })
  deviceId!: string;

  @Column({ type: 'varchar' })
  deviceName!: string;

  @Column({ type: 'varchar', length: 1000 })
  token!: string;

  @Column({ type: 'varchar', nullable: true })
  ipAddress?: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'datetime' })
  lastActiveAt!: Date;
}
