import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveBadgeSortOrder1770450000000 implements MigrationInterface {
  name = 'RemoveBadgeSortOrder1770450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('badges');
    if (table?.findColumnByName('sortOrder')) {
      await queryRunner.dropColumn('badges', 'sortOrder');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('badges');
    if (table && !table.findColumnByName('sortOrder')) {
      await queryRunner.query(
        'ALTER TABLE `badges` ADD `sortOrder` int NOT NULL DEFAULT 0'
      );
    }
  }
}
