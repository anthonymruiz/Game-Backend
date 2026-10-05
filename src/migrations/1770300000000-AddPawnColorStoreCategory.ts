import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPawnColorStoreCategory1770300000000 implements MigrationInterface {
  name = 'AddPawnColorStoreCategory1770300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`store_items\`
      MODIFY \`category\` enum('PAWN_COLOR','PAWN_SKIN','WALL_EFFECT','MOVEMENT_TRAIL','EXCLUSIVE_EMOTES') NOT NULL
    `);
    await queryRunner.query(`
      UPDATE \`store_items\`
      SET \`category\` = 'PAWN_COLOR'
      WHERE \`code\` IN ('PWN-101','PWN-102','PWN-103','PWN-104','PWN-105','PWN-106','PWN-107','PWN-108','PWN-109','PWN-110','PWN-111')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE \`store_items\`
      SET \`category\` = 'PAWN_SKIN'
      WHERE \`category\` = 'PAWN_COLOR'
    `);
    await queryRunner.query(`
      ALTER TABLE \`store_items\`
      MODIFY \`category\` enum('PAWN_SKIN','WALL_EFFECT','MOVEMENT_TRAIL','EXCLUSIVE_EMOTES') NOT NULL
    `);
  }
}
