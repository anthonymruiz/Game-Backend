import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureDefaultPointPackageLocales1770330000000 implements MigrationInterface {
  name = 'EnsureDefaultPointPackageLocales1770330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('point_packages') ||
      !await queryRunner.hasColumn('point_packages', 'configuration')) return;

    const defaults = [
      {
        points: 150,
        priceUsd: 0.99,
        name: 'Basic Package',
        description: 'A starter pack of 150 points to redeem your first item in the store.'
      },
      {
        points: 500,
        priceUsd: 2.49,
        name: 'Tactical Combo',
        description: 'A special pack of 500 points to get walls and Rare tokens.'
      },
      {
        points: 1000,
        priceUsd: 4.99,
        name: 'Master Combo',
        description: 'A large 1,000-point pack for acquiring high-rarity items.'
      }
    ];

    for (const pointPackage of defaults) {
      await queryRunner.query(`
        UPDATE \`point_packages\`
        SET \`configuration\` = JSON_SET(
          \`configuration\`,
          '$.en',
          JSON_OBJECT('name', ?, 'description', ?)
        )
        WHERE \`points\` = ?
          AND \`priceUsd\` = ?
          AND JSON_EXTRACT(\`configuration\`, '$.en.name') IS NULL
      `, [pointPackage.name, pointPackage.description, pointPackage.points, pointPackage.priceUsd]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('point_packages') ||
      !await queryRunner.hasColumn('point_packages', 'configuration')) return;

    await queryRunner.query(`
      UPDATE \`point_packages\`
      SET \`configuration\` = JSON_REMOVE(\`configuration\`, '$.en')
      WHERE JSON_UNQUOTE(JSON_EXTRACT(\`configuration\`, '$.en.name'))
        IN ('Basic Package', 'Tactical Combo', 'Master Combo')
    `);
  }
}
