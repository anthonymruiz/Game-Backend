import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeeklyRewards1770380000000 implements MigrationInterface {
  name = 'AddWeeklyRewards1770380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('rewards_settings')) {
      const columns = [
        ['weeklyFirstPlacePoints', 'int NOT NULL DEFAULT 500'],
        ['weeklySecondPlacePoints', 'int NOT NULL DEFAULT 300'],
        ['weeklyThirdPlacePoints', 'int NOT NULL DEFAULT 100'],
        ['weeklyMysteryGiftItemId', 'varchar(36) NULL']
      ] as const;
      for (const [column, definition] of columns) {
        if (!(await queryRunner.hasColumn('rewards_settings', column))) {
          await queryRunner.query(`ALTER TABLE \`rewards_settings\` ADD \`${column}\` ${definition}`);
        }
      }
      await queryRunner.query(`
        UPDATE \`rewards_settings\`
        SET \`pointsPerWin\` = GREATEST(\`pointsPerWin\`, 1),
            \`rankedPointsPerWin\` = GREATEST(\`rankedPointsPerWin\`, 1),
            \`dailyRewardPoints\` = GREATEST(\`dailyRewardPoints\`, 1),
            \`pointsPerLevelUp\` = GREATEST(\`pointsPerLevelUp\`, 1),
            \`pointsPerRankUp\` = GREATEST(\`pointsPerRankUp\`, 1),
            \`weeklyFirstPlacePoints\` = GREATEST(\`weeklyFirstPlacePoints\`, 1),
            \`weeklySecondPlacePoints\` = GREATEST(\`weeklySecondPlacePoints\`, 1),
            \`weeklyThirdPlacePoints\` = GREATEST(\`weeklyThirdPlacePoints\`, 1)
      `);
      await queryRunner.query(`
        ALTER TABLE \`rewards_settings\`
        MODIFY \`pointsPerRankUp\` int NOT NULL DEFAULT 10
      `);
    }

    if (!(await queryRunner.hasTable('weekly_reward_payouts'))) {
      await queryRunner.query(`
        CREATE TABLE \`weekly_reward_payouts\` (
          \`id\` varchar(36) NOT NULL,
          \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          \`weekStart\` varchar(10) NOT NULL,
          UNIQUE INDEX \`UQ_weekly_reward_payouts_weekStart\` (\`weekStart\`),
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('weekly_reward_payouts', true);
    if (await queryRunner.hasTable('rewards_settings')) {
      for (const column of [
        'weeklyMysteryGiftItemId',
        'weeklyThirdPlacePoints',
        'weeklySecondPlacePoints',
        'weeklyFirstPlacePoints'
      ]) {
        if (await queryRunner.hasColumn('rewards_settings', column)) {
          await queryRunner.dropColumn('rewards_settings', column);
        }
      }
    }
  }
}
