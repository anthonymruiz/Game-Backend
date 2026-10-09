import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameImpostorMode1770490000000 implements MigrationInterface {
  name = 'RenameImpostorMode1770490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('match_history')) {
      await queryRunner.query(
        "UPDATE `match_history` SET `mode` = 'impostor' WHERE `mode` = 'labyrinth'"
      );
    }

    const oldAuditTable = await queryRunner.getTable('maze_match_audit_states');
    if (oldAuditTable && !(await queryRunner.hasTable('impostor_match_audit_states'))) {
      await queryRunner.renameTable(oldAuditTable, 'impostor_match_audit_states');
      if (oldAuditTable.indices.some(index => index.name === 'IDX_maze_audit_match_sequence')) {
        await queryRunner.query(
          'ALTER TABLE `impostor_match_audit_states` RENAME INDEX `IDX_maze_audit_match_sequence` TO `IDX_impostor_audit_match_sequence`'
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('match_history')) {
      await queryRunner.query(
        "UPDATE `match_history` SET `mode` = 'labyrinth' WHERE `mode` = 'impostor'"
      );
    }

    const auditTable = await queryRunner.getTable('impostor_match_audit_states');
    if (auditTable && !(await queryRunner.hasTable('maze_match_audit_states'))) {
      if (auditTable.indices.some(index => index.name === 'IDX_impostor_audit_match_sequence')) {
        await queryRunner.query(
          'ALTER TABLE `impostor_match_audit_states` RENAME INDEX `IDX_impostor_audit_match_sequence` TO `IDX_maze_audit_match_sequence`'
        );
      }
      await queryRunner.renameTable(auditTable, 'maze_match_audit_states');
    }
  }
}
