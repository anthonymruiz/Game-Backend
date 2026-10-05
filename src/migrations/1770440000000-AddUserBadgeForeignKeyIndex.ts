import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserBadgeForeignKeyIndex1770440000000 implements MigrationInterface {
  name = 'AddUserBadgeForeignKeyIndex1770440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user_badges');
    if (table && !table.indices.some(index => index.name === 'IDX_user_badges_badge')) {
      await queryRunner.query(
        'CREATE INDEX `IDX_user_badges_badge` ON `user_badges` (`badgeId`)'
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('user_badges');
    if (table?.indices.some(index => index.name === 'IDX_user_badges_badge')) {
      await queryRunner.query(
        'DROP INDEX `IDX_user_badges_badge` ON `user_badges`'
      );
    }
  }
}
