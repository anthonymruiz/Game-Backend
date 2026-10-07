import { Entity, Column, OneToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { Preferences } from './preferences.entity.js';
import { Stats } from './stats.entity.js';
import { MatchHistory } from './match-history.entity.js';
import { Ban } from './ban.entity.js';
import { Report } from './report.entity.js';
import { DeviceSession } from './device-session.entity.js';
import { UserStoreItem } from './user-store-item.entity.js';
import { UserRole } from './user-role.enum.js';
import { PresenceStatus } from './presence.enum.js';

@Entity('users')
@Index('IDX_users_online_presence', ['isOnline', 'presenceStatus'])
export class User extends AbstractBaseEntity {
  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ type: 'varchar', unique: true })
  username!: string;

  @Column({ type: 'varchar', nullable: true })
  password?: string;

  @Column({ type: 'varchar', nullable: true })
  provider?: string;

  @Column({ type: 'varchar', nullable: true })
  providerId?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  refreshToken?: string;

  @Column({ type: 'varchar', default: UserRole.USER })
  role!: UserRole;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl?: string;

  @Column({ type: 'boolean', default: true })
  hasUsernameSet!: boolean;

  @Column({ type: 'boolean', default: false })
  isOnline!: boolean;

  @Column({ type: 'varchar', default: PresenceStatus.OFFLINE })
  presenceStatus!: PresenceStatus;

  @Column({ type: 'datetime', nullable: true })
  lastSeen?: Date;

  @OneToOne(() => Preferences, { cascade: true })
  @JoinColumn()
  preferences!: any;

  @OneToOne(() => Stats, { cascade: true })
  @JoinColumn()
  stats!: any;

  @OneToMany(() => MatchHistory, (match) => match.user)
  matchHistory!: any[];

  @OneToMany(() => Ban, (ban) => ban.user)
  bans!: any[];

  @OneToMany(() => Report, (report) => report.reporter)
  submittedReports!: any[];

  @OneToMany(() => Report, (report) => report.reportedUser)
  receivedReports!: any[];

  @OneToMany(() => DeviceSession, (session) => session.user)
  deviceSessions!: any[];

  @OneToMany(() => UserStoreItem, (ownership) => ownership.user)
  storeItemOwnerships!: UserStoreItem[];
}
