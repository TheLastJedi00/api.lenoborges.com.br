import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWaitlistEntries1786650577257 implements MigrationInterface {
  name = 'CreateWaitlistEntries1786650577257';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "waitlist_entries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying NOT NULL, "phone" character varying NOT NULL, "email" character varying NOT NULL, "consent" boolean NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_90cae6cb55d051291054d7e8d12" UNIQUE ("email"), CONSTRAINT "PK_bd0ef66fff81d3be7b7a1568a4d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_90cae6cb55d051291054d7e8d1" ON "waitlist_entries" ("email") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_90cae6cb55d051291054d7e8d1"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "waitlist_entries"`);
  }
}
