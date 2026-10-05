import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStripePointPackagePayments1770290000000 implements MigrationInterface {
  name = 'CreateStripePointPackagePayments1770290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const pointPackageForeignKey = await queryRunner.hasTable('point_packages')
      ? `,
        CONSTRAINT \`FK_point_package_payments_package\` FOREIGN KEY (\`pointPackageId\`) REFERENCES \`point_packages\` (\`id\`) ON DELETE SET NULL`
      : '';
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`point_package_payments\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`userId\` varchar(36) NOT NULL,
        \`pointPackageId\` varchar(36) NULL,
        \`points\` int NOT NULL,
        \`amountTotal\` int NOT NULL,
        \`currency\` varchar(3) NOT NULL DEFAULT 'usd',
        \`packageName\` varchar(100) NOT NULL,
        \`stripeCheckoutSessionId\` varchar(255) NULL,
        \`stripePaymentIntentId\` varchar(255) NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'PENDING',
        UNIQUE INDEX \`IDX_point_package_payments_session\` (\`stripeCheckoutSessionId\`),
        UNIQUE INDEX \`IDX_point_package_payments_intent\` (\`stripePaymentIntentId\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_point_package_payments_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE${pointPackageForeignKey}
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`stripe_webhook_events\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`stripeEventId\` varchar(255) NOT NULL,
        \`eventType\` varchar(100) NOT NULL,
        \`checkoutSessionId\` varchar(255) NULL,
        UNIQUE INDEX \`IDX_stripe_webhook_events_event_id\` (\`stripeEventId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `stripe_webhook_events`');
    await queryRunner.query('DROP TABLE IF EXISTS `point_package_payments`');
  }
}
