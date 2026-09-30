import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn, OneToMany } from 'typeorm';
import { Preferences } from './preferences.entity.js';
import { Stats } from './stats.entity.js';
import { MatchHistory } from './match-history.entity.js';
import { Ban } from './ban.entity.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ nullable: true })
  password?: string;

  @Column({ nullable: true })
  provider?: string;

  @Column({ default: 'user' })
  role!: string;

  @OneToOne(() => Preferences, { cascade: true })
  @JoinColumn()
  preferences!: Preferences;

  @OneToOne(() => Stats, { cascade: true })
  @JoinColumn()
  stats!: Stats;

  @OneToMany(() => MatchHistory, (match) => match.user)
  matchHistory!: MatchHistory[];

  @OneToMany(() => Ban, (ban) => ban.user)
  bans!: Ban[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
