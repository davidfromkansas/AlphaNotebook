-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('URL', 'PDF');

-- AlterTable
ALTER TABLE "Source" ADD COLUMN "sourceType" "SourceType" NOT NULL DEFAULT 'URL',
ADD COLUMN "fileName" TEXT,
ADD COLUMN "pdfData" BYTEA;

-- Make url optional (allow NULL for PDF sources)
ALTER TABLE "Source" ALTER COLUMN "url" DROP NOT NULL;
