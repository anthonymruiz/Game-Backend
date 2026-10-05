import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { StoreItem } from './store-item.entity.js';
import { User } from './user.entity.js';

@Entity('user_store_items')
@Index('IDX_user_store_items_user_item', ['userId', 'storeItemId'])
export class UserStoreItem extends AbstractBaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, (user) => user.storeItemOwnerships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 36 })
  storeItemId!: string;

  @ManyToOne(() => StoreItem, (storeItem) => storeItem.ownerships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeItemId' })
  storeItem!: StoreItem;

  @Column({ type: 'int' })
  pricePointsPaid!: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  giftedByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'giftedByUserId' })
  giftedByUser!: User | null;
}
