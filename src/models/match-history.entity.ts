import { Entity, Column, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';

@Entity('match_history')
export class MatchHistory extends AbstractBaseEntity {
  @ManyToOne(() => User, (user) => user.matchHistory, { onDelete: 'CASCADE' })
  user!: any;

  @Column({ type: 'varchar' })
  userId!: string;

  @Column({ type: 'varchar' })
  matchId!: string;

  @Column({ type: 'varchar' })
  result!: string; // 'win' | 'loss' | 'draw'

  @Column({ type: 'varchar', default: '1v1' })
  mode!: string; // '1v1' | '4way' | '2v2'

  @Column({ type: 'varchar', nullable: true })
  opponentUsername?: string;

  @Column({ type: 'int', nullable: true })
  eloChange?: number;

  @Column({ type: 'int', nullable: true })
  durationSeconds?: number;
}
