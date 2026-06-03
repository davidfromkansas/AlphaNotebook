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
      <main className="flex flex-1 flex-col p-8">
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
    <main className="flex flex-1 flex-col p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-foreground/50">← Library / Collections</p>
        <div className="flex items-center gap-3">
          {session?.user?.image ? (
            <Image
              src={session.user.image}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-medium text-white">
              {session?.user?.name?.charAt(0) || "U"}
            </div>
          )}
          <span className="text-sm text-foreground/60">
            {session?.user?.name}
          </span>
        </div>
      </div>

      {/* Title row */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">
          All collections ({collections.length})
        </h1>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
        >
          New collection
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-12">
          <svg
            className="mb-4 h-12 w-12 text-foreground/30"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <p className="text-lg font-medium text-foreground/70">
            No collections yet
          </p>
          <p className="mt-1 max-w-sm text-center text-sm text-foreground/50">
            Create your first collection to organize sources, extracted content,
            and grounded questions in one place.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New collection
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <a
              key={collection.id}
              href={`/collections/${collection.id}`}
              className="rounded-xl border border-border bg-white p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">
                  {collection.name}
                </h3>
                <span className="text-sm text-brand">Open →</span>
              </div>
              <p className="mt-2 text-xs text-foreground/50">
                {collection._count.sources} source
                {collection._count.sources !== 1 ? "s" : ""}
              </p>
              <div className="mt-3">
                <p className="text-xs font-medium text-foreground/40">Recent</p>
                {collection.sources.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {collection.sources.slice(0, 2).map((source) => (
                      <li
                        key={source.id}
                        className="truncate text-sm text-foreground/70"
                      >
                        {source.title || "Untitled"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-foreground/40">
                    No sources yet
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>
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
