"use client";

// EVERYTHING SAID ABOUT ONE ORDER, IN ONE THREAD.
//
// The correspondence was in four places that never met: the supplier's
// shipping-document exchange on the logistics board, the laboratory thread on
// the testing screen, the escrow agent's mailbox on the escrow board, and hand-
// written notes in the event log. Each screen showed its own and none showed the
// order's — so "what has been said to anyone about this, and who owes whom a
// reply" could only be answered by opening three boards and reading them side by
// side.
//
// NEWEST FIRST, AND THE DIRECTION IS THE FIRST THING ON THE ROW. An order's
// conversation is read to find out where it stands, and the two facts that
// answer that are which way the last message went and how long ago. A thread
// that opens on the oldest message makes somebody scroll to find out.
//
// FILTERS BY COUNTERPARTY, NOT BY SYSTEM. "Supplier / Laboratory / Escrow" is
// how a person thinks about who they are waiting on; "shippingDocs /
// labEmails / agentEmails" is how the store happens to hold it.
//
// It sends nothing. Every message still lives on the record that owns it, and
// each row says which screen that is, so a reply is composed where the action
// and its audit trail already are.

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Paperclip } from "lucide-react";
import {
  correspondenceCounts,
  counterpartyLabel,
  orderCorrespondence,
  type Correspondence,
  type Counterparty,
} from "@/lib/order-correspondence";
import type { OrderBundle } from "@/types";
import { Panel, Pill } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Filter = "ALL" | Counterparty | "OUT" | "IN";

const PARTY_TONE: Record<Counterparty, "info" | "neutral" | "warn"> = {
  SUPPLIER: "info",
  LAB: "info",
  ESCROW: "warn",
  CLIENT: "info",
  INTERNAL: "neutral",
};

export function CommunicationTab({ b }: { b: OrderBundle }) {
  const items = useMemo(() => orderCorrespondence(b), [b]);
  const counts = useMemo(() => correspondenceCounts(items), [items]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const shown = items.filter((i) => {
    if (filter === "OUT" || filter === "IN") {
      if (i.way !== filter) return false;
    } else if (filter !== "ALL" && i.with !== filter) {
      return false;
    }
    if (!q.trim()) return true;
    const hay = `${i.subject} ${i.who} ${i.body ?? ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <Panel
      title="Communication"
      actions={
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subject, party, text…"
          className="w-56"
        />
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Every message on this order, whoever it was with — the supplier&rsquo;s document exchange, the
        laboratory thread, the escrow agent&rsquo;s mailbox and notes written on the file. Newest
        first. Replies are composed on the screen that owns the conversation, so the action and its
        audit trail stay together.
      </p>

      {/* Who, not which system. */}
      <div className="no-scrollbar mb-3 flex flex-wrap gap-1.5">
        <Chip label="All" count={counts.all} active={filter === "ALL"} onClick={() => setFilter("ALL")} />
        <Chip label="Supplier" count={counts.supplier} active={filter === "SUPPLIER"} onClick={() => setFilter("SUPPLIER")} />
        <Chip label="Laboratory" count={counts.lab} active={filter === "LAB"} onClick={() => setFilter("LAB")} />
        <Chip label="Escrow agent" count={counts.escrow} active={filter === "ESCROW"} onClick={() => setFilter("ESCROW")} />
        <Chip label="Internal notes" count={counts.internal} active={filter === "INTERNAL"} onClick={() => setFilter("INTERNAL")} />
        <span className="mx-1 self-center text-muted-foreground">·</span>
        <Chip label="We sent" count={counts.out} active={filter === "OUT"} onClick={() => setFilter("OUT")} />
        <Chip label="We received" count={counts.in} active={filter === "IN"} onClick={() => setFilter("IN")} />
      </div>

      {shown.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "Nothing has been said about this order yet. Requesting shipping documents, mailing the laboratory or instructing the escrow agent all appear here."
            : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((c) => (
            <Row key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Row({ c, open, onToggle }: { c: Correspondence; open: boolean; onToggle: () => void }) {
  const out = c.way === "OUT";
  const Arrow = out ? ArrowUpRight : ArrowDownLeft;
  const hasBody = Boolean(c.body?.trim());

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasBody}
        className={cn(
          "flex w-full flex-wrap items-center gap-x-2 gap-y-1 p-2.5 text-left text-sm",
          hasBody && "hover:bg-muted",
        )}
      >
        {/* Direction leads: an order's conversation is read to find out which
            way the last message went. */}
        <Arrow className={cn("h-3.5 w-3.5 shrink-0", out ? "text-muted-foreground" : "text-primary")} />
        <Pill tone={PARTY_TONE[c.with]}>{counterpartyLabel(c.with)}</Pill>
        <span className="min-w-0 flex-1 truncate font-medium">{c.subject}</span>
        {c.attachments?.length ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            {c.attachments.length}
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">{c.at || "undated"}</span>
      </button>

      <div className="flex flex-wrap items-center gap-x-2 border-t px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {out ? "to" : "from"} <b className="text-foreground">{c.who}</b>
        </span>
        <span>·</span>
        {/* Where it lives, so a reply is composed where the action is. */}
        <span>on {c.source}</span>
      </div>

      {open && hasBody && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t bg-muted/30 p-2.5 text-[11px] leading-relaxed">
          {c.body}
        </pre>
      )}
    </li>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
        active ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
      <Pill tone="neutral">{count}</Pill>
    </button>
  );
}
