import { Column, Entity, Index } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';

@Entity('maze_match_audit_states')
@Index('IDX_maze_audit_match_sequence', ['matchId', 'sequence'], { unique: true })
export class MazeMatchAuditState extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 100 })
  matchId!: string;

  @Column({ type: 'int' })
  sequence!: number;

  @Column({ type: 'varchar', length: 64 })
  event!: string;

  @Column({ type: 'json' })
  snapshot!: object;
}
