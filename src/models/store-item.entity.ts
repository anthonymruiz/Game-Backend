import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AbstractBaseEntity } from './base.entity.js';
import { StoreItemCategory, StoreItemRarity, StoreItemStatus } from './store-item.enum.js';
import { UserStoreItem } from './user-store-item.entity.js';

export interface IStoreItemLocalization {
  name: string;
  description: string;
}

export type StoreItemConfiguration = Record<'en' | 'es', IStoreItemLocalization>;

@Entity('store_items')
export class StoreItem extends AbstractBaseEntity {
  @Index('IDX_store_items_code', { unique: true })
  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'json' })
  configuration!: StoreItemConfiguration;

  @Column({ type: 'enum', enum: StoreItemCategory })
  category!: StoreItemCategory;

  @Column({ type: 'enum', enum: StoreItemRarity })
  rarity!: StoreItemRarity;

  @Column({ type: 'int' })
  pricePoints!: number;

  @Column({ type: 'enum', enum: StoreItemStatus, default: StoreItemStatus.AVAILABLE })
  status!: StoreItemStatus;

  @Column({ type: 'varchar', length: 120 })
  icon!: string;

  @Column({ type: 'boolean', default: false })
  allowColor!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @OneToMany(() => UserStoreItem, (ownership) => ownership.storeItem)
  ownerships!: UserStoreItem[];
}
