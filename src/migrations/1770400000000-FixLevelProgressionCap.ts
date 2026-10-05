import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FixLevelProgressionCap1770400000000 implements MigrationInterface {
  name = 'FixLevelProgressionCap1770400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('level_progression_config') &&
        await queryRunner.hasColumn('level_progression_config', 'maxLevel')) {
      await queryRunner.query(`
        UPDATE \`level_progression_config\`
        SET \`maxLevel\` = 100
        WHERE \`singletonKey\` = 1
      `);
    }
  }

  public async down(): Promise<void> {
    // The prior level cap was not retained after progression was standardized.
  }
}
