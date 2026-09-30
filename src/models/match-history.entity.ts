import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { User } from './user.entity.js';

@Entity('match_history')
export class MatchHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, (user) => user.matchHistory)
  user!: User;

  @Column()
  matchId!: string;

  @Column()
  result!: string;

  @Column({ nullable: true })
  eloChange?: number;

  @CreateDateColumn()
  playedAt!: Date;
}
