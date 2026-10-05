import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStoreItems1770260000000 implements MigrationInterface {
  name = 'CreateStoreItems1770260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`store_items\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`code\` varchar(32) NOT NULL,
        \`configuration\` json NOT NULL,
        \`category\` enum('PAWN_SKIN','WALL_EFFECT','MOVEMENT_TRAIL','EXCLUSIVE_EMOTES') NOT NULL,
        \`rarity\` enum('COMMON','RARE','EPIC','LEGENDARY') NOT NULL,
        \`pricePoints\` int NOT NULL,
        \`salesCount\` int NOT NULL DEFAULT 0,
        \`status\` enum('AVAILABLE','UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
        \`icon\` varchar(120) NOT NULL,
        \`allowColor\` boolean NOT NULL DEFAULT 0,
        \`sortOrder\` int NOT NULL DEFAULT 0,
        UNIQUE INDEX \`IDX_store_items_code\` (\`code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `store_items`');
  }
}
