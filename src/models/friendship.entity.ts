import { Entity, Column, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';
import { FriendshipStatus } from './friendship-status.enum.js';

@Entity('friendships')
export class Friendship extends AbstractBaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  requester!: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  addressee!: User;

  @Column({ type: 'varchar', default: FriendshipStatus.PENDING })
  status!: FriendshipStatus;
}
