-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "IndexStatus" AS ENUM ('PENDING', 'INDEXING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "indexStatus" "IndexStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SourceChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "headingPath" TEXT,
    "text" TEXT NOT NULL,
    "charStart" INTEGER NOT NULL,
    "charEnd" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceChunk_sourceId_idx" ON "SourceChunk"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceChunk_sourceId_ord_key" ON "SourceChunk"("sourceId", "ord");

-- CreateIndex
CREATE INDEX "Conversation_sourceId_userId_idx" ON "Conversation"("sourceId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- AddForeignKey
ALTER TABLE "SourceChunk" ADD CONSTRAINT "SourceChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add pgvector embedding column (1536d for OpenAI text-embedding-3-small)
ALTER TABLE "SourceChunk" ADD COLUMN "embedding" vector(1536);

-- Generated tsvector column for BM25-style full-text search
ALTER TABLE "SourceChunk" ADD COLUMN "textSearch" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("text", ''))) STORED;

-- HNSW index for fast cosine ANN search
CREATE INDEX "SourceChunk_embedding_idx"
  ON "SourceChunk"
  USING hnsw ("embedding" vector_cosine_ops);

-- GIN index for full-text search
CREATE INDEX "SourceChunk_textSearch_idx"
  ON "SourceChunk"
  USING GIN ("textSearch");
