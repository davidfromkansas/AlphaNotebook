"use client";

import { useEffect, useRef } from "react";

interface PollableSource {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
}

interface SourceUpdate {
  id: string;
  title: string | null;
  author: string | null;
  siteName: string | null;
  status: "PENDING" | "READY" | "FAILED";
  content?: string | null;
}

const INITIAL_INTERVAL = 2000;
const MAX_INTERVAL = 15000;
const BACKOFF_FACTOR = 1.5;

/**
 * Polls GET /api/sources/{id} for every source whose status is "PENDING".
 * Calls `onUpdate` when a source transitions to READY or FAILED.
 * Automatically cleans up on unmount or when no PENDING sources remain.
 */
export function usePollPendingSources(
  sources: PollableSource[],
  onUpdate: (updated: SourceUpdate) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const intervalsRef = useRef<Map<string, number>>(new Map());
  const pollRef = useRef<(sourceId: string) => void>();

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    pollRef.current = (sourceId: string) => {
      fetch(`/api/sources/${sourceId}`)
        .then((res) => {
          if (!res.ok) return null;
          return res.json();
        })
        .then((data: SourceUpdate | null) => {
          if (!data) return;

          if (data.status !== "PENDING") {
            onUpdateRef.current(data);
            timersRef.current.delete(sourceId);
            intervalsRef.current.delete(sourceId);
            return;
          }

          const currentInterval =
            intervalsRef.current.get(sourceId) ?? INITIAL_INTERVAL;
          const nextInterval = Math.min(
            currentInterval * BACKOFF_FACTOR,
            MAX_INTERVAL,
          );
          intervalsRef.current.set(sourceId, nextInterval);

          const timer = setTimeout(
            () => pollRef.current?.(sourceId),
            nextInterval,
          );
          timersRef.current.set(sourceId, timer);
        })
        .catch(() => {
          const currentInterval =
            intervalsRef.current.get(sourceId) ?? INITIAL_INTERVAL;
          const nextInterval = Math.min(
            currentInterval * BACKOFF_FACTOR,
            MAX_INTERVAL,
          );
          intervalsRef.current.set(sourceId, nextInterval);

          const timer = setTimeout(
            () => pollRef.current?.(sourceId),
            nextInterval,
          );
          timersRef.current.set(sourceId, timer);
        });
    };
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const intervals = intervalsRef.current;

    const pendingIds = sources
      .filter((s) => s.status === "PENDING")
      .map((s) => s.id);

    for (const id of pendingIds) {
      if (!timers.has(id)) {
        intervals.set(id, INITIAL_INTERVAL);
        const timer = setTimeout(
          () => pollRef.current?.(id),
          INITIAL_INTERVAL,
        );
        timers.set(id, timer);
      }
    }

    const pendingSet = new Set(pendingIds);
    for (const [id, timer] of timers) {
      if (!pendingSet.has(id)) {
        clearTimeout(timer);
        timers.delete(id);
        intervals.delete(id);
      }
    }
  }, [sources]);

  useEffect(() => {
    const timers = timersRef.current;
    const intervals = intervalsRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      intervals.clear();
    };
  }, []);
}
