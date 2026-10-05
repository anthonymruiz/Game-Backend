import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserStoreItems1770280000000 implements MigrationInterface {
  name = 'CreateUserStoreItems1770280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasSalesCount = await queryRunner.hasColumn('store_items', 'salesCount');
    if (hasSalesCount) {
      await queryRunner.dropColumn('store_items', 'salesCount');
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`user_store_items\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`userId\` varchar(36) NOT NULL,
        \`storeItemId\` varchar(36) NOT NULL,
        \`pricePointsPaid\` int NOT NULL,
        INDEX \`IDX_user_store_items_user_item\` (\`userId\`, \`storeItemId\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_user_store_items_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_user_store_items_store_item\` FOREIGN KEY (\`storeItemId\`) REFERENCES \`store_items\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `user_store_items`');
    const hasSalesCount = await queryRunner.hasColumn('store_items', 'salesCount');
    if (!hasSalesCount) {
      await queryRunner.query('ALTER TABLE `store_items` ADD `salesCount` int NOT NULL DEFAULT 0');
    }
  }
}
