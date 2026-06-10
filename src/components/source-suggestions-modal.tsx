"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SuggestedSource {
  title: string | null;
  url: string;
  author: string | null;
  publishedDate: string | null;
  summary: string | null;
  favicon: string | null;
}

interface SourceSuggestionsModalProps {
  query: string;
  suggestedTitle: string;
  suggestedDescription: string;
  results: SuggestedSource[];
  onClose: () => void;
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

export function SourceSuggestionsModal({
  query,
  suggestedTitle,
  suggestedDescription,
  results,
  onClose,
}: SourceSuggestionsModalProps) {
  const router = useRouter();
  const [name, setName] = useState(suggestedTitle || query);
  const [description, setDescription] = useState(suggestedDescription);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(results.map((r) => r.url))
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectedCount = selected.size;
  const canCreate = selectedCount > 0 && name.trim().length > 0 && !isCreating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create collection");
      }
      const collection = await res.json();

      // Kick off source extraction for every selected URL. The API extracts +
      // indexes content in the background, so we don't await the heavy work —
      // just ensure each source row is created before navigating.
      const urls = results
        .map((r) => r.url)
        .filter((url) => selected.has(url));

      await Promise.allSettled(
        urls.map((url) =>
          fetch("/api/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, collectionId: collection.id }),
          })
        )
      );

      router.push(`/collections/${collection.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-lg sm:max-w-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="border-b border-border p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Collection name"
                className="w-full rounded-lg border border-transparent bg-transparent text-xl font-semibold text-foreground hover:border-border focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={2}
                className="mt-1 w-full resize-none rounded-lg border border-transparent bg-transparent text-sm text-foreground/70 hover:border-border focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-2xl leading-none text-foreground/40 hover:text-foreground/70"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="mt-2 text-xs font-medium text-foreground/50">
            {selectedCount} of {results.length} sources selected
          </p>
        </div>

        {/* Results list */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {results.length === 0 ? (
            <p className="p-6 text-center text-sm text-foreground/50">
              No related links found. Try rephrasing your prompt.
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

        {/* Footer */}
        <div className="border-t border-border p-4 sm:p-5">
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
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
              onClick={handleCreate}
              disabled={!canCreate}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating
                ? "Creating..."
                : `Create collection (${selectedCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
