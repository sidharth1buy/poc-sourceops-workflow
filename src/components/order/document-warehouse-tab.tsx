"use client";

// THE DOCUMENT WAREHOUSE FOR ONE ORDER — scoped to the desk looking at it.
//
// The old Documents tab was a list of files somebody happened to upload. This
// is the inverse and far more useful: the documents this consignment REQUIRES,
// derived from its own facts, with what is missing named and chargeable to a
// desk. A file list tells you what you have; a warehouse tells you what you owe.
//
// ONE DESK AT A TIME, BY DEFAULT. Twenty-six documents across six teams is a
// list nobody reads to the end of, and most of it belongs to somebody else.
// The desk lands on its own — what it owes leads, what it has settled folds —
// and the other desks are one control away rather than hidden, because "who is
// holding this up" is a question the desk asks about every other desk.
//
// WHAT DOES NOT APPLY IS SHOWN AS NOT APPLYING, not omitted. A warehouse that
// silently drops the certificate of origin on a domestic order looks identical
// to one that forgot it, and the difference is the whole value of the thing.
//
// PRODUCER ≠ ACCOUNTABLE IS FLAGGED. The supplier issues the origin
// certificate; the importer answers for the claim. Those documents need a named
// internal verifier, not a receipt tick, and the row says so.

import { useMemo, useState } from "react";
import { AlertTriangle, Check, CircleDashed, FileText, Minus, ShieldAlert } from "lucide-react";
import {
  DESKS,
  DESK_META,
  PARTY_LABEL,
  STATE_LABEL,
  deskCounts,
  documentWarehouse,
  ownedBy,
  waitedOnBy,
  type Desk,
  type DocState,
  type WarehouseEntry,
} from "@/lib/document-warehouse";
import type { OrderBundle } from "@/types";
import { Panel, Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/** Which desk a persona lands on. The switcher still overrides it. */
const DESK_FOR_ROLE: Record<string, Desk> = {
  SC: "SOURCING",
  Finance: "FINANCE",
  Approver: "CUSTOMS",
  Mgmt: "SOURCING",
};

const STATE_TONE: Record<DocState, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  original_received: "ok",
  verified: "ok",
  draft_received: "info",
  pending: "warn",
  not_required: "neutral",
};

const STATE_ICON: Record<DocState, typeof Check> = {
  original_received: Check,
  verified: Check,
  draft_received: CircleDashed,
  pending: AlertTriangle,
  not_required: Minus,
};

export function DocumentWarehouseTab({ b, role }: { b: OrderBundle; role: string }) {
  const entries = useMemo(() => documentWarehouse(b), [b]);
  const counts = useMemo(() => deskCounts(entries), [entries]);
  const [desk, setDesk] = useState<Desk>(DESK_FOR_ROLE[role] ?? "SOURCING");
  const [showSettled, setShowSettled] = useState(false);

  const mine = ownedBy(entries, desk);
  const owed = mine.filter((e) => e.state === "pending" || e.state === "draft_received");
  const settled = mine.filter((e) => e.state === "verified" || e.state === "original_received");
  const na = mine.filter((e) => e.state === "not_required");
  /*
   * Documents another desk answers for, that THIS desk's work stops without.
   *
   * The commercial invoice is Customs' to obtain and the carrier will not
   * accept the consignment without it — so Logistics has to be able to see it,
   * and could not while a document belonged to exactly one desk. Kept as its
   * own group because the two need different behaviour: one is a chase you
   * make, the other is a chase you ask somebody else to make.
   */
  const waiting = waitedOnBy(entries, desk);

  return (
    <Panel title="Document warehouse">
      <p className="mb-3 text-xs text-muted-foreground">
        What this consignment requires, not what happens to have been uploaded. The set is derived
        from its own facts — delivery term, mode, trade type, whether a cell is aboard — so a
        document is either needed here, or shown as not needed with the reason.
      </p>

      {/* ── Whose documents ───────────────────────────────────────────────── */}
      <div className="no-scrollbar mb-1.5 flex flex-wrap gap-1.5">
        {DESKS.map((d) => (
          <button
            key={d}
            onClick={() => setDesk(d)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
              desk === d ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {DESK_META[d].label}
            {counts[d].owed > 0 ? (
              <Pill tone="warn">{counts[d].owed}</Pill>
            ) : (
              <Pill tone="neutral">{counts[d].total}</Pill>
            )}
            {/* A desk with nothing of its own outstanding can still be stopped
                by somebody else's document; the chip has to say so. */}
            {counts[d].waiting > 0 && <Pill tone="info">+{counts[d].waiting}</Pill>}
          </button>
        ))}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">{DESK_META[desk].blurb}</p>

      {/* ── What this desk owes ───────────────────────────────────────────── */}
      <section className="mb-4">
        <h4 className="mb-1.5 text-[13px] font-semibold">
          {owed.length === 0
            ? `${DESK_META[desk].label} owes nothing on this order`
            : `Outstanding · ${owed.length}`}
        </h4>
        {owed.length === 0 ? (
          <p className="rounded-lg border bg-ok-bg p-3 text-xs text-ok">
            Everything this desk is answerable for is either on file or does not apply to this
            consignment.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {owed.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        )}
      </section>

      {/* ── What this desk is waiting on somebody else for ────────────────── */}
      {waiting.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-1 text-[13px] font-semibold">Waiting on another desk · {waiting.length}</h4>
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            Not yours to chase, but your work stops without them. The ones marked{" "}
            <b className="text-foreground">yours to verify</b> land on your desk as work — somebody
            else obtains them, you have to read them before they are relied on.
          </p>
          <ul className="space-y-1.5">
            {waiting.map((e) => (
              <Row key={e.id} e={e} waitingOn />
            ))}
          </ul>
        </section>
      )}

      {/* ── Settled and not-applicable, folded ────────────────────────────── */}
      {(settled.length > 0 || na.length > 0) && (
        <section>
          <button
            onClick={() => setShowSettled((v) => !v)}
            className="text-xs text-primary hover:underline"
          >
            {showSettled ? "Hide" : "Show"} {settled.length} settled
            {na.length > 0 ? ` and ${na.length} that do not apply` : ""}
          </button>
          {showSettled && (
            <ul className="mt-2 space-y-1.5">
              {[...settled, ...na].map((e) => (
                <Row key={e.id} e={e} />
              ))}
            </ul>
          )}
        </section>
      )}
    </Panel>
  );
}

function Row({ e, waitingOn }: { e: WarehouseEntry; waitingOn?: boolean }) {
  const Icon = STATE_ICON[e.state];
  const outstanding = e.state === "pending" || e.state === "draft_received";

  return (
    <li
      className={cn(
        "rounded-lg border p-2.5",
        e.state === "pending" ? "bg-warn-bg" : e.state === "not_required" ? "opacity-70" : "",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            e.state === "pending" ? "text-warn" : e.state === "not_required" ? "text-muted-foreground" : "text-ok",
          )}
        />
        <span className="min-w-0 flex-1 text-sm font-medium">{e.name}</span>
        {/* Which of the two kinds of waiting this is. Verifying produces work
            when it lands — somebody has to read it — where consuming does not. */}
        {waitingOn && e.toVerify && <Pill tone="warn">yours to verify on arrival</Pill>}
        {waitingOn && <Pill tone="info">{DESK_META[e.desk].label} obtains this</Pill>}
        {/*
          The divergence flag. Where the producer and the answerable party
          differ, a receipt tick is not enough — somebody internal has to have
          looked at it, and the row says so rather than leaving it to be known.
        */}
        {e.diverges && e.state !== "not_required" && (
          <Pill tone="warn">
            <ShieldAlert className="mr-1 inline h-3 w-3" />
            verify, don&apos;t just receive
          </Pill>
        )}
        <Pill tone={STATE_TONE[e.state]}>{STATE_LABEL[e.state]}</Pill>
      </div>

      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        {e.state === "not_required" ? e.because : e.why}
      </p>

      {/* Only where something is actually owed. On a settled document the
          consequence is a warning about nothing. */}
      {outstanding && (
        <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warn">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{e.ifMissing}</span>
        </p>
      )}

      {e.evidence && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="font-mono">{e.evidence}</span>
        </p>
      )}

      {e.state !== "not_required" && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>
            from <b className="text-foreground">{PARTY_LABEL[e.providedBy]}</b>
          </span>
          {e.diverges && (
            <>
              <span>·</span>
              <span>
                answerable: <b className="text-foreground">{PARTY_LABEL[e.accountable]}</b>
              </span>
            </>
          )}
          {e.verifiedBy && (
            <>
              <span>·</span>
              <span>
                verified by <b className="text-foreground">{DESK_META[e.verifiedBy].label}</b>
              </span>
            </>
          )}
          <span>·</span>
          <span>needed {e.trigger.toLowerCase()}</span>
          <span>·</span>
          <span>wanted by {e.requiredBy.map((p) => PARTY_LABEL[p]).join(", ")}</span>
          {/* The other desks it holds up — the fact that makes this document
              visible to more than the desk that owes it. */}
          {e.alsoNeededBy.length > 0 && (
            <>
              <span>·</span>
              <span>
                also holds up {e.alsoNeededBy.map((d) => DESK_META[d].label).join(", ")}
              </span>
            </>
          )}
        </p>
      )}
    </li>
  );
}
