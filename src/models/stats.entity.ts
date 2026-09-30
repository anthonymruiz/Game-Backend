import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('stats')
export class Stats {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ default: 0 })
  wins!: number;

  @Column({ default: 0 })
  losses!: number;

  @Column({ default: 0 })
  draws!: number;

  @Column({ default: 1000 })
  elo!: number;
}
