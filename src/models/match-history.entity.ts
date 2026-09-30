import { Entity, Column, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

@Entity('match_history')
export class MatchHistory extends AbstractBaseEntity {
  @ManyToOne(() => User, (user) => user.matchHistory)
  user!: User;

  @Column()
  matchId!: string;

  @Column()
  result!: string;

  @Column({ nullable: true })
  eloChange?: number;
}
