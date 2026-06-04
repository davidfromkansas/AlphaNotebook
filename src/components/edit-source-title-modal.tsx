"use client";

import { useState } from "react";

interface EditSourceTitleModalProps {
  sourceId: string;
  currentTitle: string;
  onClose: () => void;
  onSaved: (newTitle: string) => void;
}

export function EditSourceTitleModal({
  sourceId,
  currentTitle,
  onClose,
  onSaved,
}: EditSourceTitleModalProps) {
  const [title, setTitle] = useState(currentTitle);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title cannot be empty");
      return;
    }

    setIsSaving(true);
    setError(null);

    const res = await fetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });

    if (res.ok) {
      onSaved(title.trim());
    } else {
      const data = await res.json();
      setError(data.error || "Failed to update title");
    }

    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl bg-white p-6 shadow-lg sm:max-w-md sm:rounded-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Edit Source Title
          </h2>
          <button
            onClick={onClose}
            className="ml-4 text-xl text-foreground/40 hover:text-foreground/70 sm:hidden"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4">
          <label
            htmlFor="source-title"
            className="block text-sm font-medium text-foreground/70"
          >
            Title
          </label>
          <input
            id="source-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            placeholder="Enter source title"
            autoFocus
          />

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !title.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
