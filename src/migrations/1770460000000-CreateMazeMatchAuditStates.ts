import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMazeMatchAuditStates1770460000000 implements MigrationInterface {
  name = 'CreateMazeMatchAuditStates1770460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`maze_match_audit_states\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`matchId\` varchar(100) NOT NULL,
        \`sequence\` int NOT NULL,
        \`event\` varchar(64) NOT NULL,
        \`snapshot\` json NOT NULL,
        UNIQUE INDEX \`IDX_maze_audit_match_sequence\` (\`matchId\`, \`sequence\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS \`maze_match_audit_states\`');
  }
}
