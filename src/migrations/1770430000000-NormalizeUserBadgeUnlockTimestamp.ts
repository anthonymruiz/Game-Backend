import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeUserBadgeUnlockTimestamp1770430000000 implements MigrationInterface {
  name = 'NormalizeUserBadgeUnlockTimestamp1770430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `user_badges` MODIFY `unlockedAt` datetime(0) NULL'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `user_badges` MODIFY `unlockedAt` datetime NULL'
    );
  }
}
