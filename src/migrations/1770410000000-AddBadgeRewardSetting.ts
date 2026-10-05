import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBadgeRewardSetting1770410000000 implements MigrationInterface {
  name = 'AddBadgeRewardSetting1770410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      await queryRunner.hasTable('rewards_settings') &&
      !(await queryRunner.hasColumn('rewards_settings', 'pointsPerBadge'))
    ) {
      await queryRunner.query(`
        ALTER TABLE \`rewards_settings\`
        ADD \`pointsPerBadge\` int NOT NULL DEFAULT 10
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      await queryRunner.hasTable('rewards_settings') &&
      await queryRunner.hasColumn('rewards_settings', 'pointsPerBadge')
    ) {
      await queryRunner.dropColumn('rewards_settings', 'pointsPerBadge');
    }
  }
}
