"use client";

import { useState } from "react";

interface AddSourceModalProps {
  collectionId: string;
  onClose: () => void;
  onAdded: (source: {
    id: string;
    url: string;
    title: string | null;
    status: "PENDING" | "READY" | "FAILED";
    createdAt: string;
  }) => void;
}

export function AddSourceModal({
  collectionId,
  onClose,
  onAdded,
}: AddSourceModalProps) {
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidUrl = (str: string) => {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !isValidUrl(url.trim())) {
      setError("Please enter a valid URL");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim(), collectionId }),
    });

    if (res.ok) {
      const source = await res.json();
      onAdded(source);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to add source");
    }

    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-foreground">Add source</h2>
        <p className="mt-1 text-sm text-foreground/50">
          Enter a URL to extract and save its content.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium text-foreground/70"
            >
              URL <span className="text-red-500">*</span>
            </label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim() || isSubmitting}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {isSubmitting ? "Adding..." : "Add source"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
