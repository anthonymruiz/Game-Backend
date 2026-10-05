import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLobbyTourPreference1770360000000 implements MigrationInterface {
  name = 'AddLobbyTourPreference1770360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('preferences') && !(await queryRunner.hasColumn('preferences', 'hasCompletedLobbyTour'))) {
      await queryRunner.query(`
        ALTER TABLE \`preferences\`
        ADD \`hasCompletedLobbyTour\` tinyint NOT NULL DEFAULT 0
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('preferences') && await queryRunner.hasColumn('preferences', 'hasCompletedLobbyTour')) {
      await queryRunner.dropColumn('preferences', 'hasCompletedLobbyTour');
    }
  }
}
