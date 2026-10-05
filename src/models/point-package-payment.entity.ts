import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { PointPackage } from './point-package.entity.js';
import { User } from './user.entity.js';

export enum PointPackagePaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED'
}

@Entity('point_package_payments')
@Index('IDX_point_package_payments_session', ['stripeCheckoutSessionId'], { unique: true })
@Index('IDX_point_package_payments_intent', ['stripePaymentIntentId'], { unique: true })
export class PointPackagePayment extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 36, nullable: true })
  pointPackageId!: string | null;

  @ManyToOne(() => PointPackage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pointPackageId' })
  pointPackage!: PointPackage | null;

  @Column({ type: 'int' })
  points!: number;

  @Column({ type: 'int' })
  amountTotal!: number;

  @Column({ type: 'varchar', length: 3, default: 'usd' })
  currency!: string;

  @Column({ type: 'varchar', length: 100 })
  packageName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeCheckoutSessionId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripePaymentIntentId!: string | null;

  @Column({ type: 'varchar', length: 20, default: PointPackagePaymentStatus.PENDING })
  status!: PointPackagePaymentStatus;
}
