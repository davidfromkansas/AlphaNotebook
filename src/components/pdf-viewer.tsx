"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  fileName?: string;
}

export default function PdfViewer({ url, fileName }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ initialDistance: number; initialScale: number }>({
    initialDistance: 0,
    initialScale: 1,
  });

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;
  const ZOOM_STEP = 0.25;

  // Measure container width for fit-to-width rendering
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: pages }: { numPages: number }) => {
      setNumPages(pages);
    },
    [],
  );

  const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP));
  const zoomOut = () => setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP));
  const resetZoom = () => setScale(1);

  // Pinch-to-zoom handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = {
        initialDistance: Math.hypot(dx, dy),
        initialScale: scale,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.hypot(dx, dy);
      const { initialDistance, initialScale } = pinchRef.current;
      if (initialDistance > 0) {
        const newScale = initialScale * (distance / initialDistance);
        setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale)));
      }
    }
  };

  // The width we pass to each Page = containerWidth * (1/scale) so the
  // rendered page fills the viewport at scale=1 and zooms in/out from there.
  const pageWidth = containerWidth > 0 ? containerWidth / scale : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Zoom controls toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white/95 backdrop-blur px-3 py-2">
        <span className="text-xs text-foreground/50 truncate max-w-[40%]">
          {fileName || "PDF"} · {numPages} page{numPages !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-sm font-medium text-foreground/70 transition-colors hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            onClick={resetZoom}
            className="flex h-7 min-w-[3.5rem] items-center justify-center rounded-md text-xs font-medium text-foreground/60 hover:bg-surface transition-colors"
            aria-label="Reset zoom"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-sm font-medium text-foreground/70 transition-colors hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {/* PDF pages container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-neutral-100 touch-manipulation"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {containerWidth > 0 && (
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center py-12">
                <div className="animate-pulse text-sm text-foreground/50">
                  Loading PDF…
                </div>
              </div>
            }
            error={
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-red-600">
                  Failed to load PDF. Try downloading instead.
                </p>
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                className="flex justify-center py-2 first:pt-3 last:pb-3"
              >
                <Page
                  pageNumber={i + 1}
                  width={pageWidth}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                />
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
