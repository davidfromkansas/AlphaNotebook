"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { AddSourceModal } from "@/components/add-source-modal";
import { EditSourceTitleModal } from "@/components/edit-source-title-modal";

interface Source {
  id: string;
  url: string | null;
  title: string | null;
  author: string | null;
  siteName: string | null;
  sourceType: "URL" | "PDF";
  fileName: string | null;
  status: "PENDING" | "READY" | "FAILED";
  createdAt: string;
}

interface Collection {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  sources: Source[];
}

export default function CollectionDetailPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const handleDelete = useCallback(async (sourceId: string) => {
    const res = await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
    if (res.ok) {
      setCollection((prev) =>
        prev
          ? { ...prev, sources: prev.sources.filter((s) => s.id !== sourceId) }
          : prev
      );
    }
    setOpenMenuId(null);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated" && !hasFetched.current) {
      hasFetched.current = true;
      fetch(`/api/collections/${params.id}`)
        .then((res) => {
          if (!res.ok) throw new Error("Not found");
          return res.json();
        })
        .then((data) => setCollection(data))
        .catch((err) => setError(err.message))
        .finally(() => setIsLoading(false));
    }
  }, [status, params.id]);

  if (status === "loading" || isLoading) {
    return (
      <main className="flex flex-1 flex-col p-4 sm:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 rounded bg-border" />
          <div className="h-8 w-64 rounded bg-border" />
          <div className="h-64 rounded-xl bg-border" />
        </div>
      </main>
    );
  }

  if (error || !collection) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center p-4 sm:p-8">
        <p className="text-lg font-medium text-foreground/70">
          Collection not found
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
    <main className="flex flex-1 flex-col p-4 pb-20 sm:p-8 sm:pb-8">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <Link
              href="/library"
              className="text-sm text-foreground/50 hover:text-brand"
            >
              <span className="sm:hidden">← {collection.name}</span>
              <span className="hidden sm:inline">
                ← Library / Collections
              </span>
            </Link>
            <h1 className="mt-1 text-xl font-bold text-foreground sm:text-2xl">
              {collection.name}
            </h1>
            {collection.description && (
              <p className="mt-1 text-sm text-foreground/60">
                {collection.description}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowAddSource(true)}
            className="ml-4 hidden shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark sm:block"
          >
            Add source
          </button>
        </div>
      </div>

      {collection.sources.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 sm:p-12">
          <p className="text-lg font-medium text-foreground/70">
            No sources yet
          </p>
          <p className="mt-1 text-center text-sm text-foreground/50">
            Add a URL to extract and save content from the web.
          </p>
          <button
            onClick={() => setShowAddSource(true)}
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            Add source
          </button>
        </div>
      ) : (
        <>
          {/* Source count */}
          <p className="mb-3 text-sm text-foreground/50">
            {collection.sources.length} source
            {collection.sources.length !== 1 ? "s" : ""}
          </p>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-border sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface">
                <tr>
                  <th className="px-4 py-3 font-medium text-foreground/70">
                    Title
                  </th>
                  <th className="px-4 py-3 font-medium text-foreground/70">
                    Source
                  </th>
                  <th className="px-4 py-3 font-medium text-foreground/70">
                    Status
                  </th>
                  <th className="px-4 py-3 font-medium text-foreground/70">
                    Added
                  </th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {collection.sources.map((source) => (
                  <tr key={source.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/sources/${source.id}`}
                        className="font-medium text-foreground hover:text-brand"
                      >
                        {source.title || "Untitled"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground/60">
                      {source.sourceType === "PDF"
                        ? source.fileName || "PDF"
                        : source.siteName ||
                          (source.url
                            ? new URL(source.url).hostname
                            : "—")}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={source.status} />
                    </td>
                    <td className="px-4 py-3 text-foreground/60">
                      {new Date(source.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <SourceMenu
                        sourceId={source.id}
                        isOpen={openMenuId === source.id}
                        onToggle={() =>
                          setOpenMenuId(
                            openMenuId === source.id ? null : source.id
                          )
                        }
                        onClose={() => setOpenMenuId(null)}
                        onEdit={() => {
                          setEditingSource(source);
                          setOpenMenuId(null);
                        }}
                        onDelete={() => handleDelete(source.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="space-y-2 sm:hidden">
            {collection.sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-xl border border-border bg-white p-4 transition-colors active:bg-surface/50"
              >
                <Link
                  href={`/sources/${source.id}`}
                  className="min-w-0 flex-1"
                >
                  <p className="font-medium text-foreground">
                    {source.title || "Untitled"}
                  </p>
                  <p className="mt-1 text-xs text-foreground/50">
                    {source.sourceType === "PDF"
                      ? source.fileName || "PDF"
                      : source.siteName ||
                        (source.url
                          ? new URL(source.url).hostname
                          : "—")}
                    {" · "}
                    {new Date(source.createdAt).toLocaleDateString()}
                  </p>
                  <div className="mt-1.5">
                    <StatusBadge status={source.status} />
                  </div>
                </Link>
                <div className="ml-3 shrink-0">
                  <SourceMenu
                    sourceId={source.id}
                    isOpen={openMenuId === source.id}
                    onToggle={() =>
                      setOpenMenuId(
                        openMenuId === source.id ? null : source.id
                      )
                    }
                    onClose={() => setOpenMenuId(null)}
                    onEdit={() => {
                      setEditingSource(source);
                      setOpenMenuId(null);
                    }}
                    onDelete={() => handleDelete(source.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Mobile sticky FAB */}
      {collection.sources.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-white p-4 sm:hidden">
          <button
            onClick={() => setShowAddSource(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            Add Source
          </button>
        </div>
      )}

      {showAddSource && (
        <AddSourceModal
          collectionId={collection.id}
          onClose={() => setShowAddSource(false)}
          onAdded={(source) => {
            setCollection((prev) =>
              prev
                ? {
                    ...prev,
                    sources: [
                      {
                        ...source,
                        author: null,
                        siteName: null,
                        sourceType: source.sourceType || "URL",
                        fileName: source.fileName || null,
                      },
                      ...prev.sources,
                    ],
                  }
                : prev
            );
            setShowAddSource(false);
          }}
        />
      )}

      {editingSource && (
        <EditSourceTitleModal
          sourceId={editingSource.id}
          currentTitle={editingSource.title || ""}
          onClose={() => setEditingSource(null)}
          onSaved={(newTitle) => {
            setCollection((prev) =>
              prev
                ? {
                    ...prev,
                    sources: prev.sources.map((s) =>
                      s.id === editingSource.id
                        ? { ...s, title: newTitle }
                        : s
                    ),
                  }
                : prev
            );
            setEditingSource(null);
          }}
        />
      )}
    </main>
  );
}

function SourceMenu({
  sourceId,
  isOpen,
  onToggle,
  onClose,
  onEdit,
  onDelete,
}: {
  sourceId: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 transition-colors hover:bg-surface hover:text-foreground/70"
        aria-label={`Actions for source ${sourceId}`}
      >
        <svg
          className="h-4 w-4"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          />
          <div
            className="fixed z-50 w-44 rounded-lg border border-border bg-white py-1 shadow-lg"
            style={{ top: position.top, right: position.right }}
          >
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit();
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
            >
              Edit Source Title
            </button>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Delete Source
            </button>
          </div>
        </>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: Source["status"] }) {
  const styles = {
    READY: "bg-green-50 text-green-700 border-green-200",
    PENDING: "bg-yellow-50 text-yellow-700 border-yellow-200",
    FAILED: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status.toLowerCase()}
    </span>
  );
}
