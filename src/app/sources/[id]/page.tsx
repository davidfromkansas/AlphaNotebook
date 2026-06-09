"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import SourceChat, { type Citation } from "@/components/source-chat";
import type { ChunkSpan } from "@/components/markdown-renderer";

const MarkdownRenderer = dynamic(
  () => import("@/components/markdown-renderer"),
  { ssr: false }
);

const PdfViewer = dynamic(() => import("@/components/pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <div className="animate-pulse text-sm text-foreground/50">
        Loading PDF viewer…
      </div>
    </div>
  ),
});

interface Source {
  id: string;
  url: string | null;
  title: string | null;
  author: string | null;
  siteName: string | null;
  sourceType: "URL" | "PDF";
  fileName: string | null;
  tags: string[];
  content: string | null;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
  collection: { id: string; name: string };
}

type ViewTab = "extracted" | "pdf";

export default function SourceDetailPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const [source, setSource] = useState<Source | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("extracted");
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chunks, setChunks] = useState<ChunkSpan[]>([]);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [activeRange, setActiveRange] = useState<{
    key: string;
    charStart: number;
    charEnd: number;
  } | null>(null);
  const activeChunkTimerRef = useRef<number | null>(null);
  const activeRangeTimerRef = useRef<number | null>(null);
  const hasFetched = useRef(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const mobileReaderRef = useRef<HTMLDivElement>(null);
  const autoOpenedRef = useRef<string | null>(null);

  const sourceId = params.id as string;

  // Track the mobile breakpoint so we can swap to the bottom-sheet layout.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Restore the collapsed/split choice persisted per source.
  useEffect(() => {
    if (!sourceId) return;
    const saved = localStorage.getItem(`source-chat-collapsed:${sourceId}`);
    if (saved !== null) setCollapsed(saved === "true");
  }, [sourceId]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(`source-chat-collapsed:${sourceId}`, String(next));
      return next;
    });
  };

  // On mobile, auto-open the Ask sheet the first time each source becomes
  // ready (always-open behavior, but respects a manual dismiss in-session).
  useEffect(() => {
    if (
      isMobile &&
      source?.status === "READY" &&
      autoOpenedRef.current !== source.id
    ) {
      autoOpenedRef.current = source.id;
      setSheetOpen(true);
    }
  }, [isMobile, source?.status, source?.id]);

  const flashChunk = (chunkId: string) => {
    setActiveChunkId(chunkId);
    if (activeChunkTimerRef.current !== null) {
      window.clearTimeout(activeChunkTimerRef.current);
    }
    activeChunkTimerRef.current = window.setTimeout(() => {
      setActiveChunkId(null);
      activeChunkTimerRef.current = null;
    }, 1800);
  };

  const scrollToChunk = (chunkId: string) => {
    // Wait a tick so the reader pane is visible if it was collapsed.
    requestAnimationFrame(() => {
      const el = document.getElementById(`chunk-${chunkId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        flashChunk(chunkId);
      } else {
        // Fallback: scroll reader to top if the anchor isn't rendered yet.
        const reader = isMobile ? mobileReaderRef.current : readerRef.current;
        reader?.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  const flashRange = (range: {
    key: string;
    charStart: number;
    charEnd: number;
  }) => {
    setActiveRange(range);
    if (activeRangeTimerRef.current !== null) {
      window.clearTimeout(activeRangeTimerRef.current);
    }
    activeRangeTimerRef.current = window.setTimeout(() => {
      setActiveRange(null);
      activeRangeTimerRef.current = null;
    }, 2200);
  };

  const scrollToRange = (range: {
    key: string;
    charStart: number;
    charEnd: number;
  }) => {
    flashRange(range);
    // The DOM mounts the new range anchor on the next render — wait for it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`range-${range.key}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          const reader = isMobile
            ? mobileReaderRef.current
            : readerRef.current;
          reader?.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });
  };

  const handleCitationClick = (citation: Citation) => {
    // Ensure we're on the extracted (markdown) view, not the PDF tab.
    if (activeTab !== "extracted") setActiveTab("extracted");
    if (isMobile) setSheetOpen(false);
    else if (collapsed) toggleCollapsed();

    // Prefer exact-line range scroll when the citation includes char offsets;
    // fall back to chunk-level anchor otherwise.
    if (
      typeof citation.charStart === "number" &&
      typeof citation.charEnd === "number" &&
      citation.charEnd > citation.charStart
    ) {
      const key = `${citation.charStart}-${citation.charEnd}`;
      scrollToRange({
        key,
        charStart: citation.charStart,
        charEnd: citation.charEnd,
      });
      return;
    }
    if (citation.anchor) scrollToChunk(citation.anchor);
  };

  useEffect(() => {
    if (status === "authenticated" && !hasFetched.current) {
      hasFetched.current = true;
      fetch(`/api/sources/${params.id}`)
        .then((res) => {
          if (!res.ok) throw new Error("Not found");
          return res.json();
        })
        .then((data) => setSource(data))
        .catch((err) => setError(err.message))
        .finally(() => setIsLoading(false));
      // Fetch chunk spans for in-reader anchoring (separate, non-blocking).
      fetch(`/api/sources/${params.id}/chunks`)
        .then((res) => (res.ok ? res.json() : { chunks: [] }))
        .then((data: { chunks: ChunkSpan[] }) => setChunks(data.chunks || []))
        .catch(() => {});
    }
  }, [status, params.id]);

  const handleCopy = async () => {
    if (!source?.content) return;
    await navigator.clipboard.writeText(source.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!source) return;
    const link = document.createElement("a");
    link.href = `/api/sources/${source.id}/pdf`;
    link.download = source.fileName || "document.pdf";
    link.click();
  };

  const isPdf = source?.sourceType === "PDF";

  if (status === "loading" || isLoading) {
    return (
      <main className="flex flex-1 flex-col p-4 sm:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-48 rounded bg-border" />
          <div className="h-8 w-80 rounded bg-border" />
          <div className="h-96 rounded-xl bg-border" />
        </div>
      </main>
    );
  }

  if (error || !source) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-4 sm:p-8">
        <p className="text-lg font-medium text-foreground/70">
          Source not found
        </p>
        <Link
          href="/library"
          className="mt-2 text-sm text-brand hover:underline"
        >
          ← Back to Library
        </Link>
      </main>
    );
  }

  const sourceTitle = source.title || source.fileName || "Untitled";

  // Single source-of-truth for the reader content, reused by both the desktop
  // split pane and the mobile full-screen reader (only one renders at a time).
  const readerBody =
    activeTab === "pdf" && isPdf ? (
      <PdfViewer
        url={`/api/sources/${source.id}/pdf`}
        fileName={source.fileName || undefined}
      />
    ) : source.content ? (
      <article className="prose prose-sm max-w-none p-5 sm:p-6">
        <MarkdownRenderer
          content={source.content}
          chunks={chunks}
          activeChunkId={activeChunkId}
          activeRange={activeRange}
        />
      </article>
    ) : (
      <div className="p-6 text-center text-foreground/60">
        No text content was extracted from this {isPdf ? "PDF" : "page"}.
      </div>
    );

  return (
    <main className="flex h-[100dvh] min-h-0 flex-col overflow-hidden p-4 sm:p-8">
      {/* Header */}
      <div className="mb-4 shrink-0 sm:mb-6">
        <div className="flex items-center justify-between">
          <Link
            href={`/collections/${source.collection.id}`}
            className="text-sm text-foreground/50 hover:text-brand"
          >
            <span className="sm:hidden">← {source.collection.name}</span>
            <span className="hidden sm:inline">
              ← {source.collection.name}
            </span>
          </Link>
          {/* Mobile action button */}
          {source.status === "READY" && (
            <div className="sm:hidden">
              {activeTab === "pdf" && isPdf ? (
                <button
                  onClick={handleDownload}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-surface"
                >
                  Download
                </button>
              ) : (
                source.content && (
                  <button
                    onClick={handleCopy}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-surface"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                )
              )}
            </div>
          )}
        </div>
        <h1 className="mt-1 text-xl font-bold text-foreground sm:text-2xl">
          {source.title || source.fileName || "Untitled"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/60 sm:text-sm">
          {source.author && <span>By {source.author}</span>}
          {isPdf ? (
            <>
              {source.author && <span>·</span>}
              <span>{source.fileName}</span>
            </>
          ) : (
            source.siteName && (
              <>
                {source.author && <span>·</span>}
                <span>{source.siteName}</span>
              </>
            )
          )}
          <span>·</span>
          <span>Added {new Date(source.createdAt).toLocaleDateString()}</span>
          {!isPdf && source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              View original
            </a>
          )}
        </div>
      </div>

      {source.status === "PENDING" && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-center sm:p-6">
          <p className="font-medium text-yellow-700">Extracting content...</p>
          <p className="mt-1 text-sm text-yellow-600">
            {isPdf
              ? "Extracting text from your PDF. This may take a moment."
              : "Exa is crawling and extracting the page content. Refresh in a moment."}
          </p>
        </div>
      )}

      {source.status === "FAILED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center sm:p-6">
          <p className="font-medium text-red-700">Extraction failed</p>
          <p className="mt-1 text-sm text-red-600">
            {isPdf
              ? "We couldn\u2019t extract text from this PDF. The file may be encrypted or corrupted."
              : "We couldn\u2019t extract content from this URL. The page may be behind a paywall or not accessible."}
          </p>
        </div>
      )}

      {/* Source reader + Ask AI chat */}
      {source.status === "READY" &&
        (isMobile ? (
          /* ---------- Mobile: full-screen reader + Ask bottom sheet ---------- */
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
              {/* Mobile reader header */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E5E7EB] px-3 py-2.5">
                {isPdf ? (
                  <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
                    <button
                      onClick={() => setActiveTab("extracted")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        activeTab === "extracted"
                          ? "bg-white text-foreground shadow-sm"
                          : "text-foreground/50"
                      }`}
                    >
                      Extracted
                    </button>
                    <button
                      onClick={() => setActiveTab("pdf")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        activeTab === "pdf"
                          ? "bg-white text-foreground shadow-sm"
                          : "text-foreground/50"
                      }`}
                    >
                      Original
                    </button>
                  </div>
                ) : (
                  <span className="text-xs font-medium uppercase tracking-wider text-foreground/40">
                    Extracted content
                  </span>
                )}

                <div className="flex items-center gap-2">
                  {activeTab === "pdf" && isPdf ? (
                    <button
                      onClick={handleDownload}
                      className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-xs font-medium text-foreground/70"
                    >
                      Download
                    </button>
                  ) : (
                    source.content && (
                      <button
                        onClick={handleCopy}
                        className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-xs font-medium text-foreground/70"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => setSheetOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-dark"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
                        fill="currentColor"
                      />
                    </svg>
                    Ask source
                  </button>
                </div>
              </div>

              {/* Mobile reader content */}
              <div
                ref={mobileReaderRef}
                className="min-h-0 flex-1 overflow-y-auto"
              >
                {readerBody}
              </div>
            </div>

            {/* Scrim */}
            <div
              onClick={() => setSheetOpen(false)}
              className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
                sheetOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            />

            {/* Ask bottom sheet (auto-opens on mobile) */}
            <div
              className={`fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col overflow-hidden rounded-t-[22px] bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out ${
                sheetOpen ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Dismiss"
                className="flex shrink-0 justify-center pb-1.5 pt-2.5"
              >
                <span className="h-[5px] w-9 rounded-full bg-[#D1D5DB]" />
              </button>
              <SourceChat
                sourceId={source.id}
                sourceTitle={sourceTitle}
                collapsed={false}
                rootedInStrip
                onClose={() => setSheetOpen(false)}
                onCitationClick={handleCitationClick}
              />
            </div>
          </>
        ) : (
          /* ---------- Desktop: split reader (left) + Ask chat (right) ---------- */
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
            {/* Collapsed source rail (56px) */}
            {collapsed && (
              <button
                onClick={toggleCollapsed}
                aria-label="Expand source"
                title="Expand source"
                className="group flex w-14 shrink-0 flex-col items-center gap-3 border-r border-[#E5E7EB] bg-[#F7F8FA] py-4"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-foreground/50 transition-colors group-hover:border-brand group-hover:text-brand">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M9 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/40 [writing-mode:vertical-rl]">
                  Source
                </span>
              </button>
            )}

            {/* Source reader pane (½ width) — kept mounted across collapse so
                toggling does not reload the PDF or re-render the content */}
            <div
              className={`min-h-0 w-1/2 shrink-0 flex-col border-r border-[#E5E7EB] ${
                collapsed ? "hidden" : "flex"
              }`}
            >
              {/* Reader header */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-2.5">
                {isPdf ? (
                  <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
                    <button
                      onClick={() => setActiveTab("extracted")}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        activeTab === "extracted"
                          ? "bg-white text-foreground shadow-sm"
                          : "text-foreground/50 hover:text-foreground/70"
                      }`}
                    >
                      Extracted content
                    </button>
                    <button
                      onClick={() => setActiveTab("pdf")}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        activeTab === "pdf"
                          ? "bg-white text-foreground shadow-sm"
                          : "text-foreground/50 hover:text-foreground/70"
                      }`}
                    >
                      Original PDF
                    </button>
                  </div>
                ) : (
                  <span className="text-xs font-medium uppercase tracking-wider text-foreground/40">
                    Extracted content
                  </span>
                )}

                <div className="flex items-center gap-2">
                  {activeTab === "pdf" && isPdf ? (
                    <button
                      onClick={handleDownload}
                      className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-[#F7F8FA]"
                    >
                      Download
                    </button>
                  ) : (
                    source.content && (
                      <button
                        onClick={handleCopy}
                        className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-[#F7F8FA]"
                      >
                        {copied ? "Copied!" : "Copy text"}
                      </button>
                    )
                  )}
                  <button
                    onClick={toggleCollapsed}
                    className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-[#F7F8FA]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M15 6l-6 6 6 6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Collapse
                  </button>
                </div>
              </div>

              {/* Reader content (scrolls independently) */}
              <div ref={readerRef} className="min-h-0 flex-1 overflow-y-auto">
                {readerBody}
              </div>
            </div>

            {/* Ask AI chat pane */}
            <SourceChat
              sourceId={source.id}
              sourceTitle={sourceTitle}
              collapsed={collapsed}
              onCitationClick={handleCitationClick}
            />
          </div>
        ))}
    </main>
  );
}
