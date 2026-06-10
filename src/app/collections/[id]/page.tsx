"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { AddSourceModal } from "@/components/add-source-modal";
import { EditSourceTitleModal } from "@/components/edit-source-title-modal";
import { EditCollectionModal } from "@/components/edit-collection-modal";
import CollectionChat from "@/components/collection-chat";

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
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [mobileTab, setMobileTab] = useState<"sources" | "chat">("sources");
  const [showEditCollection, setShowEditCollection] = useState(false);
  const [showCollectionMenu, setShowCollectionMenu] = useState(false);
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

  const handleDeleteCollection = useCallback(async () => {
    if (!collection) return;
    if (!window.confirm("Are you sure you want to delete this collection? This cannot be undone.")) return;
    const res = await fetch(`/api/collections/${collection.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/library");
    }
  }, [collection, router]);

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
        .then((data) => {
          setCollection(data);
          // Select all ready sources by default
          const readySources = data.sources.filter((s: Source) => s.status === "READY");
          setSelectedSourceIds(new Set(readySources.map((s: Source) => s.id)));
        })
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
    <main className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-white sm:px-8 sm:py-3">
      {collection.sources.length === 0 ? (
        <div className="relative flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 sm:p-12">
          <div className="absolute right-4 top-4">
            <CollectionMenu
              isOpen={showCollectionMenu}
              onToggle={() => setShowCollectionMenu(!showCollectionMenu)}
              onClose={() => setShowCollectionMenu(false)}
              onEdit={() => {
                setShowEditCollection(true);
                setShowCollectionMenu(false);
              }}
              onDelete={() => {
                setShowCollectionMenu(false);
                handleDeleteCollection();
              }}
            />
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            {collection.name}
          </h1>
          {collection.description && (
            <p className="mt-1 text-center text-sm text-foreground/50">
              {collection.description}
            </p>
          )}
          <p className="mt-3 text-sm text-foreground/50">
            No sources yet — add a URL to extract and save content from the web.
          </p>
          <button
            onClick={() => setShowAddSource(true)}
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            Add source
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-6 lg:px-6 lg:pb-4">
          {/* Sub-header: back button, title/description, Add Source */}
          <div className="shrink-0 py-3">
            {/* Row 1: navigation + actions */}
            <div className="flex h-10 items-center gap-4">
              <Link
                href="/library"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-3 text-[13px] font-medium text-[#111827] hover:bg-[#F9FAFB]"
              >
                <span className="text-[13px]">←</span>
                <span>All Collections</span>
              </Link>
              {/* Desktop: inline title/description */}
              <div className="hidden flex-1 min-w-0 flex-col gap-0.5 lg:flex">
                <h1 className="truncate text-[18px] font-semibold leading-[1.3] text-[#111827]">
                  {collection.name}
                </h1>
                {collection.description && (
                  <p className="truncate text-[13px] leading-[1.4] text-[#6B7280]">
                    {collection.description}
                  </p>
                )}
              </div>
              <div className="flex-1 lg:hidden" />
              <button
                onClick={() => setShowAddSource(true)}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-[#D1D5DB] bg-white px-3 text-[13px] font-medium text-[#111827] hover:bg-[#F9FAFB]"
              >
                Add Source
              </button>
              <CollectionMenu
                isOpen={showCollectionMenu}
                onToggle={() => setShowCollectionMenu(!showCollectionMenu)}
                onClose={() => setShowCollectionMenu(false)}
                onEdit={() => {
                  setShowEditCollection(true);
                  setShowCollectionMenu(false);
                }}
                onDelete={() => {
                  setShowCollectionMenu(false);
                  handleDeleteCollection();
                }}
              />
            </div>
            {/* Row 2: mobile-only title and description */}
            <div className="mt-2 lg:hidden">
              <h1 className="text-[18px] font-semibold leading-[1.3] text-[#111827]">
                {collection.name}
              </h1>
              {collection.description && (
                <p className="mt-0.5 text-[13px] leading-[1.4] text-[#6B7280]">
                  {collection.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#E5E7EB] bg-white lg:flex-row">
            {/* Left column: Sources list (hidden on mobile when chat tab is active) */}
            <div className={`flex min-h-0 flex-1 flex-col lg:w-[440px] lg:flex-none lg:border-r lg:border-[#E5E7EB] ${mobileTab === "chat" ? "hidden lg:flex" : ""}`}>
              {/* Header */}
              <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4">
                <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={
                      selectedSourceIds.size ===
                      collection.sources.filter((s) => s.status === "READY").length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        const allReady = collection.sources
                          .filter((s) => s.status === "READY")
                          .map((s) => s.id);
                        setSelectedSourceIds(new Set(allReady));
                      } else {
                        setSelectedSourceIds(new Set());
                      }
                    }}
                    className="rounded border-border"
                  />
                </div>
                <span className="text-[11px] uppercase tracking-wider font-semibold text-[#374151]">Sources</span>
                <span className="flex-1 text-[11px] text-[#9CA3AF]">
                  {selectedSourceIds.size} of {collection.sources.filter((s) => s.status === "READY").length} selected
                </span>
                <button className="text-[11px] font-medium text-[#147885] hover:underline">
                  Sort: Recent
                </button>
              </div>

              {/* Source rows */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {collection.sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-start gap-3 border-b border-[#F3F4F6] bg-white px-4 py-3.5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.has(source.id)}
                      disabled={source.status !== "READY"}
                      onChange={(e) => {
                        const newSelected = new Set(selectedSourceIds);
                        if (e.target.checked) {
                          newSelected.add(source.id);
                        } else {
                          newSelected.delete(source.id);
                        }
                        setSelectedSourceIds(newSelected);
                      }}
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border border-brand bg-brand disabled:opacity-50"
                    />
                    <div className="min-w-0 flex-1 max-w-[360px] flex flex-col gap-1">
                      <Link
                        href={`/sources/${source.id}`}
                        className="block text-[13px] font-semibold leading-[18.2px] text-[#111827] hover:text-brand"
                      >
                        {source.title || "Untitled"}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] leading-[14px] text-[#4B5563]">
                          {source.author || source.siteName || (source.url ? new URL(source.url).hostname : "—")}
                        </span>
                        <span className="text-[11px] leading-[14px] text-[#9CA3AF]">·</span>
                        <span className="text-[11px] leading-[14px] text-[#9CA3AF]">
                          {new Date(source.createdAt).toLocaleDateString()}
                        </span>
                        <span className="text-[11px] leading-[14px] text-[#9CA3AF]">·</span>
                        <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-[13px]">
                          {source.sourceType === "PDF" ? "PDF" : "URL"}
                        </span>
                      </div>
                    </div>
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
                ))}
              </div>
            </div>

            {/* Right column: Chat panel (visible on mobile when chat tab is active) */}
            <div className={`min-h-0 flex-1 min-w-0 ${mobileTab === "chat" ? "flex" : "hidden lg:flex"}`}>
              <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-white">
                <CollectionChat
                  collectionId={collection.id}
                  sourceIds={Array.from(selectedSourceIds)}
                  totalSourceCount={collection.sources.filter((s) => s.status === "READY").length}
                  onCitationClick={(citation: { sourceId: string }) => {
                    // Navigate to source page with citation
                    router.push(`/sources/${citation.sourceId}`);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom tab bar */}
      {collection.sources.length > 0 && (
        <div className="flex shrink-0 border-t border-[#E5E7EB] bg-white lg:hidden">
          <button
            onClick={() => setMobileTab("sources")}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              mobileTab === "sources"
                ? "border-t-2 border-brand text-brand"
                : "text-[#6B7280]"
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            Sources
          </button>
          <button
            onClick={() => setMobileTab("chat")}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              mobileTab === "chat"
                ? "border-t-2 border-brand text-brand"
                : "text-[#6B7280]"
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
            </svg>
            Chat
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

      {showEditCollection && (
        <EditCollectionModal
          collectionId={collection.id}
          currentName={collection.name}
          currentDescription={collection.description || ""}
          onClose={() => setShowEditCollection(false)}
          onSaved={(newName, newDescription) => {
            setCollection((prev) =>
              prev
                ? { ...prev, name: newName, description: newDescription }
                : prev
            );
            setShowEditCollection(false);
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

function CollectionMenu({
  isOpen,
  onToggle,
  onClose,
  onEdit,
  onDelete,
}: {
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
        onClick={onToggle}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#D1D5DB] bg-white text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]"
        aria-label="Collection actions"
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
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div
            className="fixed z-50 w-52 rounded-lg border border-border bg-white py-1 shadow-lg"
            style={{ top: position.top, right: position.right }}
          >
            <button
              onClick={onEdit}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
            >
              Edit Title / Description
            </button>
            <button
              onClick={onDelete}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Delete Collection
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
