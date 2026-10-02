import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitDatabase1700000000000 implements MigrationInterface {
  name = 'InitDatabase1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`preferences\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`language\` varchar(255) NOT NULL DEFAULT 'en',
        \`theme\` varchar(255) NOT NULL DEFAULT 'light',
        \`fcmToken\` varchar(255) NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`stats\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`totalGames\` int NOT NULL DEFAULT 0,
        \`wins\` int NOT NULL DEFAULT 0,
        \`losses\` int NOT NULL DEFAULT 0,
        \`wallsPlaced\` int NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`email\` varchar(255) NOT NULL,
        \`username\` varchar(255) NOT NULL,
        \`password\` varchar(255) NULL,
        \`provider\` varchar(255) NULL,
        \`role\` varchar(255) NOT NULL DEFAULT 'user',
        \`avatarUrl\` varchar(255) NULL,
        \`hasUsernameSet\` boolean NOT NULL DEFAULT 1,
        \`isOnline\` boolean NOT NULL DEFAULT 1,
        \`presenceStatus\` varchar(20) NOT NULL DEFAULT 'offline',
        \`lastSeen\` datetime NULL,
        \`preferencesId\` varchar(36) NULL,
        \`statsId\` varchar(36) NULL,
        UNIQUE INDEX \`IDX_users_email\` (\`email\`),
        UNIQUE INDEX \`IDX_users_username\` (\`username\`),
        UNIQUE INDEX \`REL_users_preferences\` (\`preferencesId\`),
        UNIQUE INDEX \`REL_users_stats\` (\`statsId\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_users_preferences\` FOREIGN KEY (\`preferencesId\`) REFERENCES \`preferences\` (\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_users_stats\` FOREIGN KEY (\`statsId\`) REFERENCES \`stats\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`reports\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`reporterId\` varchar(36) NOT NULL,
        \`reportedUserId\` varchar(36) NOT NULL,
        \`category\` varchar(50) NOT NULL,
        \`details\` text NOT NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'pending',
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_reports_reporter\` FOREIGN KEY (\`reporterId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_reports_reportedUser\` FOREIGN KEY (\`reportedUserId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`bans\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`userId\` varchar(36) NULL,
        \`reason\` varchar(255) NOT NULL,
        \`expiresAt\` datetime NULL,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_bans_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`notifications\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`userId\` varchar(36) NULL,
        \`type\` varchar(255) NOT NULL,
        \`title\` varchar(255) NOT NULL,
        \`message\` text NOT NULL,
        \`isRead\` boolean NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_notifications_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`match_history\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`userId\` varchar(36) NULL,
        \`mode\` varchar(255) NOT NULL,
        \`result\` varchar(255) NOT NULL,
        \`durationSeconds\` int NOT NULL,
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_match_history_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`friendships\` (
        \`id\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`requesterId\` varchar(36) NOT NULL,
        \`addresseeId\` varchar(36) NOT NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'PENDING',
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_friendships_requester\` FOREIGN KEY (\`requesterId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_friendships_addressee\` FOREIGN KEY (\`addresseeId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`match_history\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`notifications\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`bans\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`reports\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`users\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`stats\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`preferences\``);
  }
}
