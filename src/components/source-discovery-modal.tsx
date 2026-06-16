"use client";

import { useState } from "react";

interface ExaSearchResult {
  title: string | null;
  url: string;
  author: string | null;
  publishedDate: string | null;
  summary: string | null;
  favicon: string | null;
}

interface SourceDiscoveryModalProps {
  collectionId: string;
  existingUrls: Set<string>;
  onClose: () => void;
  onSourcesAdded: (
    sources: {
      id: string;
      url: string | null;
      title: string | null;
      status: "PENDING" | "READY" | "FAILED";
      createdAt: string;
      sourceType: "URL" | "PDF";
      fileName: string | null;
    }[]
  ) => void;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceDiscoveryModal({
  collectionId,
  existingUrls,
  onClose,
  onSourcesAdded,
}: SourceDiscoveryModalProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<ExaSearchResult[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;

    setIsSearching(true);
    setSearchError(null);
    setResults(null);
    setAddError(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, numResults: 20, skipMeta: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Search failed");
      }
      const data = await res.json();
      const filtered = (data.results as ExaSearchResult[]).filter(
        (r) => !existingUrls.has(r.url)
      );
      setResults(filtered);
      setSelected(new Set(filtered.map((r) => r.url)));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectedCount = selected.size;

  const handleAdd = async () => {
    if (selectedCount === 0 || isAdding || !results) return;
    setIsAdding(true);
    setAddError(null);

    const urls = results.map((r) => r.url).filter((url) => selected.has(url));

    const responses = await Promise.allSettled(
      urls.map((url) =>
        fetch("/api/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, collectionId }),
        }).then(async (res) => {
          if (!res.ok) throw new Error("Failed");
          return res.json();
        })
      )
    );

    const added = responses
      .filter(
        (r): r is PromiseFulfilledResult<{
          id: string;
          url: string | null;
          title: string | null;
          status: "PENDING" | "READY" | "FAILED";
          createdAt: string;
          sourceType: "URL" | "PDF";
          fileName: string | null;
        }> => r.status === "fulfilled"
      )
      .map((r) => r.value);

    const failedCount = responses.filter(
      (r) => r.status === "rejected"
    ).length;

    if (added.length > 0) {
      onSourcesAdded(added);
    }

    if (failedCount > 0 && added.length === 0) {
      setAddError("Failed to add sources. Please try again.");
      setIsAdding(false);
    } else if (failedCount > 0) {
      onClose();
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-lg sm:max-w-2xl sm:rounded-2xl">
        {/* Header with search */}
        <div className="border-b border-border p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-foreground">
                Find sources
              </h2>
              <p className="mt-0.5 text-sm text-foreground/50">
                Describe what you&apos;re looking for to discover relevant
                sources.
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-2xl leading-none text-foreground/40 hover:text-foreground/70"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Recent advances in transformer architectures"
              disabled={isSearching}
              className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
              autoFocus
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={!query.trim() || isSearching}
              className="shrink-0 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSearching ? (
                <span className="flex items-center gap-1.5">
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Searching...
                </span>
              ) : (
                "Search"
              )}
            </button>
          </div>
          {searchError && (
            <p className="mt-2 text-sm text-red-600">{searchError}</p>
          )}
          {results !== null && (
            <p className="mt-2 text-xs font-medium text-foreground/50">
              {results.length === 0
                ? "No new sources found"
                : `${selectedCount} of ${results.length} sources selected`}
            </p>
          )}
        </div>

        {/* Results list */}
        {results !== null && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {results.length === 0 ? (
              <p className="p-6 text-center text-sm text-foreground/50">
                No new sources found. Try a different search.
              </p>
            ) : (
              <ul className="space-y-2">
                {results.map((r) => {
                  const isSelected = selected.has(r.url);
                  const date = formatDate(r.publishedDate);
                  return (
                    <li key={r.url}>
                      <label
                        className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${
                          isSelected
                            ? "border-brand/40 bg-surface"
                            : "border-border bg-white hover:bg-surface/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(r.url)}
                          className="mt-1 h-4 w-4 shrink-0 accent-brand"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {r.favicon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.favicon}
                                alt=""
                                className="h-4 w-4 shrink-0 rounded-sm"
                              />
                            ) : null}
                            <h3 className="truncate text-sm font-medium text-foreground">
                              {r.title || hostname(r.url)}
                            </h3>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-brand">
                            {hostname(r.url)}
                          </p>
                          {(r.author || date) && (
                            <p className="mt-0.5 text-xs text-foreground/45">
                              {[r.author, date].filter(Boolean).join(" \u00b7 ")}
                            </p>
                          )}
                          {r.summary && (
                            <p className="mt-1 line-clamp-2 text-xs text-foreground/60">
                              {r.summary}
                            </p>
                          )}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Footer */}
        {results !== null && results.length > 0 && (
          <div className="border-t border-border p-4 sm:p-5">
            {addError && <p className="mb-2 text-sm text-red-600">{addError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground/70 transition-colors hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={selectedCount === 0 || isAdding}
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAdding
                  ? "Adding..."
                  : `Add ${selectedCount} source${selectedCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
