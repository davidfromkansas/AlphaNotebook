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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-foreground/50">← Library / Collections</p>
          <h1 className="text-2xl font-bold text-foreground">Library</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-foreground/60">
            {session?.user?.name}
          </span>
          {session?.user?.image && (
            <Image
              src={session.user.image}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
            />
          )}
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-12">
          <p className="text-lg font-medium text-foreground/70">
            No collections yet
          </p>
          <p className="mt-1 text-sm text-foreground/50">
            Create your first collection to start organizing sources.
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
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => setShowModal(true)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              New collection
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <a
                key={collection.id}
                href={`/collections/${collection.id}`}
                className="rounded-xl border border-border bg-white p-5 transition-shadow hover:shadow-md"
              >
                <h3 className="font-semibold text-foreground">
                  {collection.name}
                </h3>
                <p className="mt-1 text-xs text-foreground/50">
                  {collection._count.sources} source
                  {collection._count.sources !== 1 ? "s" : ""}
                </p>
                {collection.sources.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {collection.sources.map((source) => (
                      <li
                        key={source.id}
                        className="truncate text-sm text-foreground/70"
                      >
                        {source.title || "Untitled"}
                      </li>
                    ))}
                  </ul>
                )}
              </a>
            ))}
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
