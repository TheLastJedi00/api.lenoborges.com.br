import { MigrationInterface, QueryRunner } from 'typeorm';

export class WaitlistCreatedAtTimestamptz1786653255211 implements MigrationInterface {
  name = 'WaitlistCreatedAtTimestamptz1786653255211';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // created_at nasceu como "timestamp without time zone": o valor era gravado
    // no fuso da sessao do banco e lido de volta no fuso do processo Node, o que
    // deslocava o receivedAt que o WaitlistReceiptDto anuncia como UTC.
    // Os valores existentes foram gravados por now() em sessao UTC, entao sao
    // reinterpretados como UTC.
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE USING "created_at" AT TIME ZONE 'UTC'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" ALTER COLUMN "created_at" TYPE TIMESTAMP USING "created_at" AT TIME ZONE 'UTC'`,
    );
  }
}
