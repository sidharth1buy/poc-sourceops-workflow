"use client";

// READ THE DOCUMENT WHERE YOU STAND — download only if you want to keep it.
//
// Clicking a document used to save a file: the reader's actual question ("what
// does it say?") was answered by a trip to the downloads folder. This opens the
// document ON the page, inline under whatever referenced it — no dialog, no
// download — with the download as a button for the times a copy is wanted.

import { Download, FileText, X } from "lucide-react";
import { downloadTextFile } from "@/lib/download";

export function DocPreview({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
        <button
          type="button"
          onClick={() => downloadTextFile(title, content)}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] font-medium text-primary hover:bg-muted"
        >
          <Download className="h-3 w-3" />
          Download
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border bg-card p-1 text-muted-foreground hover:bg-muted"
          aria-label="Close preview"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {/* The paper itself. */}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-card p-3 font-mono text-[11px] leading-relaxed">
        {content}
      </pre>
    </div>
  );
}
