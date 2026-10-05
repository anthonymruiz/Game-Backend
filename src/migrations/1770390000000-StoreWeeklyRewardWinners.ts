import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreWeeklyRewardWinners1770390000000 implements MigrationInterface {
  name = 'StoreWeeklyRewardWinners1770390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('weekly_reward_payouts'))) return;
    for (const column of ['firstPlaceUserId', 'secondPlaceUserId', 'thirdPlaceUserId']) {
      if (!(await queryRunner.hasColumn('weekly_reward_payouts', column))) {
        await queryRunner.query(
          `ALTER TABLE \`weekly_reward_payouts\` ADD \`${column}\` varchar(36) NULL`
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('weekly_reward_payouts'))) return;
    for (const column of ['thirdPlaceUserId', 'secondPlaceUserId', 'firstPlaceUserId']) {
      if (await queryRunner.hasColumn('weekly_reward_payouts', column)) {
        await queryRunner.dropColumn('weekly_reward_payouts', column);
      }
    }
  }
}
