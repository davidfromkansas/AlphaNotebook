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

  if (status === "loading" || isLoading) {
    return (
      <main className="flex flex-1 flex-col p-8">
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
      <main className="flex flex-1 flex-col items-center justify-center p-8">
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
    <main className="flex flex-1 flex-col p-8">
      <div className="mb-6">
        <Link
          href={`/collections/${source.collection.id}`}
          className="text-sm text-foreground/50 hover:text-brand"
        >
          ← {source.collection.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">
          {source.title || "Untitled"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-foreground/60">
          {source.author && <span>By {source.author}</span>}
          {source.siteName && <span>{source.siteName}</span>}
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
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-6 text-center">
          <p className="font-medium text-yellow-700">Extracting content...</p>
          <p className="mt-1 text-sm text-yellow-600">
            Exa is crawling and extracting the page content. Refresh in a
            moment.
          </p>
        </div>
      )}

      {source.status === "FAILED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-700">Extraction failed</p>
          <p className="mt-1 text-sm text-red-600">
            We couldn&apos;t extract content from this URL. The page may be
            behind a paywall or not accessible.
          </p>
        </div>
      )}

      {source.status === "READY" && source.content && (
        <article className="prose prose-sm max-w-none rounded-xl border border-border bg-white p-6">
          <div className="whitespace-pre-wrap text-foreground/80">
            {source.content}
          </div>
        </article>
      )}

      {source.status === "READY" && !source.content && (
        <div className="rounded-xl border border-border bg-white p-6 text-center">
          <p className="text-foreground/60">
            No text content was extracted from this page.
          </p>
        </div>
      )}
    </main>
  );
}
