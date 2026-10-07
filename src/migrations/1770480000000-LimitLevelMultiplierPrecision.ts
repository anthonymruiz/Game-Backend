import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LimitLevelMultiplierPrecision1770480000000 implements MigrationInterface {
  name = 'LimitLevelMultiplierPrecision1770480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `level_progression_config` MODIFY `exponentialMultiplier` decimal(8,3) NOT NULL DEFAULT 1.049'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `level_progression_config` MODIFY `exponentialMultiplier` decimal(8,5) NOT NULL DEFAULT 1.04900'
    );
  }
}
