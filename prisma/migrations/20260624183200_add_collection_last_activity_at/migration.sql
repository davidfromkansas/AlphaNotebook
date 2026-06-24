-- AlterTable
ALTER TABLE "Collection" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: set lastActivityAt to createdAt for existing rows
UPDATE "Collection" SET "lastActivityAt" = "createdAt";
