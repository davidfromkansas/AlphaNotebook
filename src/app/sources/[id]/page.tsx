"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";

interface Source {
  id: string;
  url: string;
  title: string | null;
  author: string | null;
  siteName: string | null;
  tags: string[];
  content: string | null;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
  collection: { id: string; name: string };
}

export default function SourceDetailPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const [source, setSource] = useState<Source | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

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
    }
  }, [status, params.id]);

  const handleCopy = async () => {
    if (!source?.content) return;
    await navigator.clipboard.writeText(source.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  return (
    <main className="flex flex-1 flex-col p-4 sm:p-8">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
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
          {source.status === "READY" && source.content && (
            <button
              onClick={handleCopy}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-surface sm:hidden"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
        <h1 className="mt-1 text-xl font-bold text-foreground sm:text-2xl">
          {source.title || "Untitled"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/60 sm:text-sm">
          {source.author && <span>By {source.author}</span>}
          {source.siteName && (
            <>
              {source.author && <span>·</span>}
              <span>{source.siteName}</span>
            </>
          )}
          <span>·</span>
          <span>Added {new Date(source.createdAt).toLocaleDateString()}</span>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline"
          >
            View original
          </a>
        </div>
      </div>

      {source.status === "PENDING" && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-center sm:p-6">
          <p className="font-medium text-yellow-700">Extracting content...</p>
          <p className="mt-1 text-sm text-yellow-600">
            Exa is crawling and extracting the page content. Refresh in a
            moment.
          </p>
        </div>
      )}

      {source.status === "FAILED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center sm:p-6">
          <p className="font-medium text-red-700">Extraction failed</p>
          <p className="mt-1 text-sm text-red-600">
            We couldn&apos;t extract content from this URL. The page may be
            behind a paywall or not accessible.
          </p>
        </div>
      )}

      {source.status === "READY" && source.content && (
        <article className="prose prose-sm max-w-none rounded-xl border border-border bg-white p-4 sm:p-6">
          {/* Desktop copy button */}
          <div className="mb-4 hidden items-center justify-end sm:flex">
            <button
              onClick={handleCopy}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-surface"
            >
              {copied ? "Copied!" : "Copy text"}
            </button>
          </div>
          <div className="whitespace-pre-wrap text-foreground/80">
            {source.content}
          </div>
        </article>
      )}

      {source.status === "READY" && !source.content && (
        <div className="rounded-xl border border-border bg-white p-4 text-center sm:p-6">
          <p className="text-foreground/60">
            No text content was extracted from this page.
          </p>
        </div>
      )}
    </main>
  );
}
