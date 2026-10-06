import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddXpAwardedToMatchHistory1770470000000 implements MigrationInterface {
  name = 'AddXpAwardedToMatchHistory1770470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('match_history', 'xpAwarded')) return;
    await queryRunner.query(`
      ALTER TABLE \`match_history\`
      ADD \`xpAwarded\` int NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasColumn('match_history', 'xpAwarded')) return;
    await queryRunner.query('ALTER TABLE \`match_history\` DROP COLUMN \`xpAwarded\`');
  }
}
