import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableColumn } from 'typeorm';

export class LocalizePointPackages1770150000000 implements MigrationInterface {
  name = 'LocalizePointPackages1770150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('point_packages')) return;

    if (!await queryRunner.hasColumn('point_packages', 'configuration')) {
      await queryRunner.addColumn('point_packages', new TableColumn({
        name: 'configuration',
        type: 'json',
        isNullable: true
      }));
    }

    const hasName = await queryRunner.hasColumn('point_packages', 'name');
    const hasDescription = await queryRunner.hasColumn('point_packages', 'description');
    if (hasName && hasDescription) {
      await queryRunner.query(`
        UPDATE \`point_packages\`
        SET \`configuration\` = JSON_OBJECT(
          'es',
          JSON_OBJECT('name', \`name\`, 'description', \`description\`)
        )
        WHERE \`configuration\` IS NULL
      `);
    }
    await queryRunner.query(`
      UPDATE \`point_packages\`
      SET \`configuration\` = JSON_OBJECT()
      WHERE \`configuration\` IS NULL
    `);

    if (hasName) await queryRunner.dropColumn('point_packages', 'name');
    if (hasDescription) await queryRunner.dropColumn('point_packages', 'description');
    await queryRunner.changeColumn('point_packages', 'configuration', new TableColumn({
      name: 'configuration',
      type: 'json',
      isNullable: false
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('point_packages') ||
      !await queryRunner.hasColumn('point_packages', 'configuration')) return;

    if (!await queryRunner.hasColumn('point_packages', 'name')) {
      await queryRunner.addColumn('point_packages', new TableColumn({
        name: 'name',
        type: 'varchar',
        length: '80',
        isNullable: true
      }));
    }
    if (!await queryRunner.hasColumn('point_packages', 'description')) {
      await queryRunner.addColumn('point_packages', new TableColumn({
        name: 'description',
        type: 'varchar',
        length: '255',
        isNullable: true
      }));
    }

    await queryRunner.query(`
      UPDATE \`point_packages\`
      SET
        \`name\` = COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(\`configuration\`, '$.es.name')),
          JSON_UNQUOTE(JSON_EXTRACT(\`configuration\`, '$.en.name'))
        ),
        \`description\` = COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(\`configuration\`, '$.es.description')),
          JSON_UNQUOTE(JSON_EXTRACT(\`configuration\`, '$.en.description'))
        )
    `);
    await queryRunner.dropColumn('point_packages', 'configuration');
  }
}
