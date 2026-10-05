import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MoveRewardValuesToRewardsSettings1770370000000 implements MigrationInterface {
  name = 'MoveRewardValuesToRewardsSettings1770370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`rewards_settings\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`singletonKey\` int NOT NULL DEFAULT 1,
        \`pointsPerWin\` int NOT NULL DEFAULT 10,
        \`rankedPointsPerWin\` int NOT NULL DEFAULT 10,
        \`dailyRewardPoints\` int NOT NULL DEFAULT 10,
        \`pointsPerLevelUp\` int NOT NULL DEFAULT 10,
        \`pointsPerRankUp\` int NOT NULL DEFAULT 0,
        UNIQUE INDEX \`UQ_rewards_settings_singletonKey\` (\`singletonKey\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);

    if (await queryRunner.hasTable('level_progression_config')) {
      const oldFieldMapping = [
        ['pointsPerMatch', 'pointsPerWin'],
        ['rankedPointsPerMatch', 'rankedPointsPerWin'],
        ['dailyRewardPoints', 'dailyRewardPoints'],
        ['pointsPerLevelUp', 'pointsPerLevelUp']
      ] as const;
      const existingFields = new Map<string, boolean>();
      for (const [oldField] of oldFieldMapping) {
        existingFields.set(oldField, await queryRunner.hasColumn('level_progression_config', oldField));
      }

      if (await queryRunner.hasColumn('level_progression_config', 'singletonKey')) {
        const selectValues = oldFieldMapping.map(([oldField]) =>
          existingFields.get(oldField) ? `\`${oldField}\`` : '10'
        );
        await queryRunner.query(`
          INSERT INTO \`rewards_settings\`
            (\`id\`, \`createdAt\`, \`updatedAt\`, \`singletonKey\`, \`pointsPerWin\`, \`rankedPointsPerWin\`, \`dailyRewardPoints\`, \`pointsPerLevelUp\`)
          SELECT UUID(), CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6), 1, ${selectValues.join(', ')}
          FROM \`level_progression_config\`
          WHERE \`singletonKey\` = 1
          ON DUPLICATE KEY UPDATE \`singletonKey\` = VALUES(\`singletonKey\`);
        `);
      }

      for (const [oldField] of oldFieldMapping) {
        if (existingFields.get(oldField)) {
          await queryRunner.dropColumn('level_progression_config', oldField);
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('level_progression_config')) {
      const oldColumns = [
        ['pointsPerMatch', 'pointsPerWin'],
        ['rankedPointsPerMatch', 'rankedPointsPerWin'],
        ['dailyRewardPoints', 'dailyRewardPoints'],
        ['pointsPerLevelUp', 'pointsPerLevelUp']
      ] as const;
      for (const [oldField] of oldColumns) {
        if (!(await queryRunner.hasColumn('level_progression_config', oldField))) {
          await queryRunner.query(
            `ALTER TABLE \`level_progression_config\` ADD \`${oldField}\` int NOT NULL DEFAULT 10`
          );
        }
      }

      if (await queryRunner.hasTable('rewards_settings')) {
        const assignments = oldColumns.map(([oldField, rewardField]) =>
          `\`${oldField}\` = COALESCE((SELECT \`${rewardField}\` FROM \`rewards_settings\` WHERE \`singletonKey\` = 1), 10)`
        );
        await queryRunner.query(`UPDATE \`level_progression_config\` SET ${assignments.join(', ')} WHERE \`singletonKey\` = 1`);
      }
    }

    await queryRunner.dropTable('rewards_settings', true);
  }
}
