import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableColumn, TableForeignKey } from 'typeorm';

export class AddStoreItemGiftTracking1770340000000 implements MigrationInterface {
  name = 'AddStoreItemGiftTracking1770340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user_store_items');
    if (!table) throw new Error('user_store_items table does not exist.');

    if (!table.findColumnByName('giftedByUserId')) {
      await queryRunner.addColumn('user_store_items', new TableColumn({
        name: 'giftedByUserId',
        type: 'varchar',
        length: '36',
        isNullable: true
      }));
    }

    const refreshedTable = await queryRunner.getTable('user_store_items');
    if (!refreshedTable?.foreignKeys.some(key => key.columnNames.includes('giftedByUserId'))) {
      await queryRunner.createForeignKey('user_store_items', new TableForeignKey({
        name: 'FK_user_store_items_gifted_by_user',
        columnNames: ['giftedByUserId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL'
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user_store_items');
    const foreignKey = table?.foreignKeys.find(key => key.columnNames.includes('giftedByUserId'));
    if (foreignKey) await queryRunner.dropForeignKey('user_store_items', foreignKey);
    if (table?.findColumnByName('giftedByUserId')) {
      await queryRunner.dropColumn('user_store_items', 'giftedByUserId');
    }
  }
}
