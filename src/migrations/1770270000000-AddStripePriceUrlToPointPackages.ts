import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableColumn } from 'typeorm';

export class AddStripePriceUrlToPointPackages1770270000000 implements MigrationInterface {
  name = 'AddStripePriceUrlToPointPackages1770270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!await queryRunner.hasTable('point_packages') ||
      await queryRunner.hasColumn('point_packages', 'StripePriceUrl')) return;

    await queryRunner.addColumn('point_packages', new TableColumn({
      name: 'StripePriceUrl',
      type: 'varchar',
      length: '255',
      default: "''"
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('point_packages') &&
      await queryRunner.hasColumn('point_packages', 'StripePriceUrl')) {
      await queryRunner.dropColumn('point_packages', 'StripePriceUrl');
    }
  }
}
