-- Restore vector and tsvector columns + indexes
ALTER TABLE "SourceChunk" ADD COLUMN "embedding" vector(1536);

ALTER TABLE "SourceChunk" ADD COLUMN "textSearch" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("text", ''))) STORED;

CREATE INDEX "SourceChunk_embedding_idx"
  ON "SourceChunk"
  USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "SourceChunk_textSearch_idx"
  ON "SourceChunk"
  USING GIN ("textSearch");
