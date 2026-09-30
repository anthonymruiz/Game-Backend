import { Entity, Column, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

@Entity('notifications')
export class Notification extends AbstractBaseEntity {
  @ManyToOne(() => User)
  user!: User;

  @Column()
  type!: string;

  @Column()
  title!: string;

  @Column('text')
  message!: string;

  @Column({ default: false })
  isRead!: boolean;
}
