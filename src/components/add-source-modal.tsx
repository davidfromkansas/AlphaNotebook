"use client";

import { useState, useRef, useCallback } from "react";

interface AddSourceModalProps {
  collectionId: string;
  onClose: () => void;
  onAdded: (source: {
    id: string;
    url: string | null;
    title: string | null;
    status: "PENDING" | "READY" | "FAILED";
    createdAt: string;
    sourceType: "URL" | "PDF";
    fileName: string | null;
  }) => void;
}

export function AddSourceModal({
  collectionId,
  onClose,
  onAdded,
}: AddSourceModalProps) {
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValidUrl = (str: string) => {
    try {
      const parsed = new URL(str);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const handleFileSelect = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File size exceeds 10 MB limit");
      return;
    }
    setSelectedFile(file);
    setUrl("");
    setError(null);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedFile) {
      return handlePdfSubmit();
    }

    if (!url.trim() || !isValidUrl(url.trim())) {
      setError("Enter a valid URL starting with http:// or https://");
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

  const handlePdfSubmit = async () => {
    if (!selectedFile) return;

    setIsSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("collectionId", collectionId);

    const res = await fetch("/api/sources", {
      method: "POST",
      body: formData,
    });

    if (res.ok) {
      const source = await res.json();
      onAdded(source);
    } else {
      const data = await res.json();
      setError(
        data.error ||
          "We couldn't read content from this PDF. Check the file and try again."
      );
    }

    setIsSubmitting(false);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full rounded-t-2xl bg-white p-6 shadow-lg sm:max-w-md sm:rounded-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Add source
            </h2>
            <p className="mt-0.5 text-sm text-foreground/50">
              Paste a link or upload a PDF to add one source to your library.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-xl text-foreground/40 hover:text-foreground/70 sm:hidden"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              !
            </span>
            <div>
              <p className="text-sm font-medium text-red-800">
                Couldn&apos;t add this source
              </p>
              <p className="mt-0.5 text-xs text-red-600">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* URL input */}
          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium text-foreground/70"
            >
              Source URL
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="url"
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (selectedFile) clearFile();
                  setError(null);
                }}
                placeholder="https://example.com/article"
                disabled={!!selectedFile || isSubmitting}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
                autoFocus
              />
              <button
                type="submit"
                disabled={
                  (!url.trim() && !selectedFile) ||
                  isSubmitting ||
                  !!selectedFile
                }
                className="shrink-0 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
              >
                {isSubmitting && !selectedFile ? (
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
                    Extracting...
                  </span>
                ) : (
                  "Add source"
                )}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-foreground/40">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* PDF upload zone */}
          {selectedFile ? (
            <div className="flex items-center justify-between rounded-lg border border-brand bg-brand/5 px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  className="h-5 w-5 shrink-0 text-brand"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                  />
                </svg>
                <span className="truncate text-sm font-medium text-foreground">
                  {selectedFile.name}
                </span>
              </div>
              <button
                type="button"
                onClick={clearFile}
                disabled={isSubmitting}
                className="ml-2 shrink-0 text-foreground/40 hover:text-foreground/70 disabled:opacity-50"
                aria-label="Remove file"
              >
                ×
              </button>
            </div>
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
                isDragging
                  ? "border-brand bg-brand/5"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              <svg
                className="mb-2 h-8 w-8 text-foreground/30"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z"
                />
              </svg>
              <p className="text-sm text-foreground/60">
                <span className="hidden sm:inline">
                  Drag and drop a PDF, or{" "}
                </span>
                <span className="sm:hidden">Tap to upload, or </span>
                <span className="font-medium text-brand">browse</span>
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Submit for PDF */}
          {selectedFile && (
            <button
              type="button"
              onClick={handlePdfSubmit}
              disabled={isSubmitting}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50 sm:w-auto sm:ml-auto sm:flex"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-1.5">
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
                  Uploading...
                </span>
              ) : (
                "Add source"
              )}
            </button>
          )}

          <p className="text-center text-xs text-foreground/40">
            Add one source at a time — article, webpage, or PDF.
          </p>
        </form>
      </div>
    </div>
  );
}
