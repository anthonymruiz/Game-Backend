import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { User } from './user.entity.js';
import { ReportCategory } from './report-category.enum.js';
import { ReportStatus } from './report-status.enum.js';

export { ReportCategory, ReportStatus };

@Entity('reports')
export class Report extends AbstractBaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporterId' })
  reporter!: any;

  @Column({ type: 'varchar' })
  reporterId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reportedUserId' })
  reportedUser!: any;

  @Column({ type: 'varchar' })
  reportedUserId!: string;

  @Column({ type: 'varchar', length: 50 })
  category!: ReportCategory;

  @Column({ type: 'text' })
  details!: string;

  @Column({ type: 'varchar', length: 20, default: ReportStatus.PENDING })
  status!: ReportStatus;

  @Column({ type: 'varchar', length: 10, default: 'es' })
  language!: string;

  @Column({ type: 'varchar', nullable: true })
  matchId?: string;
}

