import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRankTiers1770350000000 implements MigrationInterface {
  name = 'CreateRankTiers1770350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`rank_tiers\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`key\` varchar(64) NOT NULL,
        \`level\` int NOT NULL,
        \`emoji\` varchar(32) NOT NULL,
        \`badgeBg\` text NOT NULL,
        \`textColor\` varchar(16) NOT NULL,
        \`configuration\` json NOT NULL,
        UNIQUE INDEX \`IDX_rank_tiers_key\` (\`key\`),
        UNIQUE INDEX \`IDX_rank_tiers_level\` (\`level\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('rank_tiers')) {
      await queryRunner.dropTable('rank_tiers');
    }
  }
}
