"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useState, useRef } from "react";
import { CreateCollectionModal } from "@/components/create-collection-modal";

interface Collection {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  sources: { id: string; title: string | null }[];
  _count: { sources: number };
}

export default function LibraryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const hasFetched = useRef(false);

  useEffect(() => {
    if (status === "authenticated" && !hasFetched.current) {
      hasFetched.current = true;
      fetch("/api/collections")
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setCollections(data))
        .finally(() => setIsLoading(false));
    }
  }, [status]);

  const handleCreated = (newCollection: Collection) => {
    setCollections((prev) => [newCollection, ...prev]);
    setShowModal(false);
  };

  if (status === "loading" || isLoading) {
    return (
      <main className="flex flex-1 flex-col p-4 sm:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-border" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-border" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col p-4 pb-20 sm:p-8 sm:pb-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white sm:hidden">
            A
          </div>
          <div>
            <p className="hidden text-sm text-foreground/50 sm:block">
              ← Library / Collections
            </p>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">
              Library
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-foreground/60 sm:inline">
            {session?.user?.name}
          </span>
          {session?.user?.image ? (
            <Image
              src={session.user.image}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-medium text-white">
              {session?.user?.name?.charAt(0) || "?"}
            </div>
          )}
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 sm:p-12">
          <p className="text-lg font-medium text-foreground/70">
            No collections yet
          </p>
          <p className="mt-1 text-center text-sm text-foreground/50">
            Create your first collection to organize sources, extracted content,
            and grounded questions in one place.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            New collection
          </button>
        </div>
      ) : (
        <>
          {/* Collection count + new button (desktop) */}
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-foreground/50">
              All collections {collections.length}
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="hidden rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark sm:block"
            >
              New collection
            </button>
          </div>

          {/* Collection cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {collections.map((collection) => (
              <a
                key={collection.id}
                href={`/collections/${collection.id}`}
                className="rounded-xl border border-border bg-white p-4 transition-shadow hover:shadow-md sm:p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-foreground">
                      {collection.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-foreground/50">
                      {collection._count.sources} source
                      {collection._count.sources !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className="ml-2 shrink-0 text-sm text-foreground/40 sm:hidden">
                    Open →
                  </span>
                </div>
                {collection.sources.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-1 text-xs font-medium text-foreground/40">
                      Recent
                    </p>
                    <ul className="space-y-0.5">
                      {collection.sources.slice(0, 2).map((source) => (
                        <li
                          key={source.id}
                          className="truncate text-sm text-foreground/70"
                        >
                          {source.title || "Untitled"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </a>
            ))}
          </div>

          {/* Mobile sticky FAB */}
          <div className="fixed inset-x-0 bottom-0 border-t border-border bg-white p-4 sm:hidden">
            <button
              onClick={() => setShowModal(true)}
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
              New collection
            </button>
          </div>
        </>
      )}

      {showModal && (
        <CreateCollectionModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </main>
  );
}
