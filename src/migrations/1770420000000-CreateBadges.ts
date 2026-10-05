import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBadges1770420000000 implements MigrationInterface {
  name = 'CreateBadges1770420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`badges\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`code\` varchar(80) NOT NULL,
        \`category\` varchar(32) NOT NULL,
        \`event\` varchar(32) NOT NULL,
        \`target\` int unsigned NOT NULL,
        \`icon\` varchar(16) NOT NULL,
        \`locales\` json NOT NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`sortOrder\` int NOT NULL DEFAULT 0,
        UNIQUE INDEX \`UQ_badges_code\` (\`code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`user_badges\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`userId\` varchar(36) NOT NULL,
        \`badgeId\` varchar(36) NOT NULL,
        \`progress\` int unsigned NOT NULL DEFAULT 0,
        \`unlockedAt\` datetime NULL,
        UNIQUE INDEX \`UQ_user_badges_user_badge\` (\`userId\`, \`badgeId\`),
        INDEX \`IDX_user_badges_badge\` (\`badgeId\`),
        INDEX \`IDX_user_badges_badge_unlocked\` (\`badgeId\`, \`unlockedAt\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_user_badges_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_user_badges_badge\` FOREIGN KEY (\`badgeId\`) REFERENCES \`badges\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `user_badges`');
    await queryRunner.query('DROP TABLE IF EXISTS `badges`');
  }
}
