"use client";

// THE LOGISTICS DESK'S PAPER ON ONE ORDER — coming in, and going out.
//
// COMING IN is a chase list: the supplier's shipping set, the carrier's waybill
// and delivery order, the broker's entry and release, the proof of delivery.
// Each row names who has it, why it is wanted and what stops without it.
//
// GOING OUT is the desk's own product: the document request, the shipping
// instruction, the pre-alert, the waybill handover, the receipt, the damage
// notice. EVERY ONE NAMES ITS RECIPIENTS — the mapping of whom to send to is
// on the row, because a document produced and not sent is the commonest silent
// failure on an inbound leg. The ones the desk drafts itself are created and
// sent from right here, inline, prefilled from the order's own facts.
//
// Scoped to this desk on purpose: the KRA view. Other desks' documents live on
// their own boards.

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, CircleDashed, Eye, FileText, Minus, PenLine } from "lucide-react";
import { useStore } from "@/store/store";
import {
  COUNTERPARTY_LABEL,
  DOC_STATUS_LABEL,
  logisticsDocuments,
  type Counterparty,
  type DocStatus,
  type LogisticsDocView,
} from "@/lib/logistics-documents";
import { LOGISTICS_PARTY_LABEL, type LogisticsParty } from "@/integrations/logistics";
import type { OrderBundle } from "@/types";
import { Button, Pill } from "@/components/ui/primitives";
import { Input, Labeled, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { mockDocContent } from "@/lib/download";
import { DocPreview } from "@/components/logistics/doc-preview";

/* The register speaks in counterparties; mail is addressed to mailboxes.
 * CUSTOMS itself is never mailed (the broker is), and the plant's mailbox is
 * the warehouse's. */
const MAILBOX_FOR: Record<Counterparty, LogisticsParty> = {
  SUPPLIER: "SUPPLIER", CARRIER: "CARRIER", CHA: "CHA",
  CUSTOMS: "CHA", PLANT: "WAREHOUSE", INSURER: "INSURER", CLIENT: "CLIENT",
};

const STATUS_TONE: Record<DocStatus, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  received: "ok", sent: "ok", awaited: "warn", draft: "warn", not_needed: "neutral",
};
const STATUS_ICON: Record<DocStatus, typeof Check> = {
  received: Check, sent: Check, awaited: AlertTriangle, draft: CircleDashed, not_needed: Minus,
};

/** Prefilled body for the documents the desk drafts itself, from the order's own facts. */
function draftBody(docId: string, b: OrderBundle): string {
  const leg = b.shipments.find((s) => s.leg === "INBOUND");
  const sd = b.shippingDocs;
  switch (docId) {
    case "PRE_ALERT":
      return [
        `Pre-alert · ${b.orderNo}`,
        leg ? `Carrier ${leg.carrier} · AWB ${leg.awb}` : "Carrier / AWB: to follow",
        leg?.estimatedDelivery ? `Expected arrival ${leg.estimatedDelivery}` : "Expected arrival: to follow",
        sd?.docs?.length ? `Attached: ${sd.docs.join(", ")}` : "Attached: Packing List, Commercial Invoice",
        sd?.hsCode ? `HS ${sd.hsCode} · declared ${sd.declaredCurrency ?? ""} ${sd.declaredValue ?? ""}`.trim() : "",
        "Please pre-file the entry so clearance starts before the goods land.",
      ].filter(Boolean).join("\n");
    case "DAMAGE_NOTICE":
      return [
        `Notice of damage / shortage · ${b.orderNo}`,
        leg ? `Consignment ${leg.awb} (${leg.carrier}), delivered to our warehouse.` : "",
        b.grn?.discrepancy ? `Found at the dock: ${b.grn.discrepancy}` : "Found at the dock: (describe what is short or damaged)",
        "This is formal notice within the claims window. Evidence (photos, endorsed consignment note) follows.",
      ].filter(Boolean).join("\n");
    default:
      return "";
  }
}

export function LogisticsDocumentsTab({ b, onGoToShipment }: { b: OrderBundle; onGoToShipment: () => void }) {
  const requestShippingDocs = useStore((s) => s.requestShippingDocs);
  const sendAwbToCha = useStore((s) => s.sendAwbToCha);
  const createLogisticsDoc = useStore((s) => s.createLogisticsDoc);

  const docs = useMemo(() => logisticsDocuments(b), [b]);
  const incoming = docs.filter((d) => d.direction === "IN" && d.status !== "not_needed");
  const outgoing = docs.filter((d) => d.direction === "OUT" && d.status !== "not_needed");
  const na = docs.filter((d) => d.status === "not_needed");

  const [showNa, setShowNa] = useState(false);
  /* Which outbound document's inline composer is open — one at a time. */
  const [composing, setComposing] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);

  const customs = b.customs?.[0];

  /* Render the record the app holds into readable paper. For the desk's own
   * documents the stored body is the content; for received ones it is the
   * facts on file. Shown on the page first; the preview carries the download. */
  const contentFor = (d: LogisticsDocView) => {
    const produced = b.logisticsOutbox?.find((x) => x.docId === d.id);
    return mockDocContent(d.name, b.orderNo, {
      Direction: d.direction === "IN" ? `received from ${d.from ? COUNTERPARTY_LABEL[d.from] : "counterparty"}` : `sent to ${(d.to ?? []).map((p) => COUNTERPARTY_LABEL[p]).join(", ")}`,
      Status: DOC_STATUS_LABEL[d.status],
      "On file": d.evidence,
      "Why it exists": d.why,
    }, produced?.body);
  };
  /* Which register row's paper is open. */
  const [previewing, setPreviewing] = useState<string | null>(null);

  const sortOutstandingFirst = (a: LogisticsDocView, z: LogisticsDocView) => {
    const rank = (d: LogisticsDocView) => (d.status === "awaited" || d.status === "draft" ? 0 : 1);
    return rank(a) - rank(z);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Only this desk&rsquo;s paper — what it receives from the supplier, the logistics partner and
        the customs broker, and what it produces and sends. Each outbound document names its
        recipients; a document sent to nobody is a draft, not a record.
      </p>

      {/* ── Coming in ─────────────────────────────────────────────────────── */}
      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
          <ArrowDownLeft className="h-4 w-4 text-primary" />
          Coming in · {incoming.filter((d) => d.status === "awaited").length} still awaited
        </h4>
        <ul className="space-y-1.5">
          {[...incoming].sort(sortOutstandingFirst).map((d) => (
            <DocRow key={d.id} d={d} previewing={previewing === d.id} onPreview={() => setPreviewing(previewing === d.id ? null : d.id)}>
              {previewing === d.id && <DocPreview title={`${d.name}.pdf`} content={contentFor(d)} onClose={() => setPreviewing(null)} />}
            </DocRow>
          ))}
        </ul>
      </section>

      {/* ── Going out ─────────────────────────────────────────────────────── */}
      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
          <ArrowUpRight className="h-4 w-4 text-primary" />
          Going out · {outgoing.filter((d) => d.status === "draft").length} owed
        </h4>
        <ul className="space-y-1.5">
          {[...outgoing].sort(sortOutstandingFirst).map((d) => {
            const owed = d.status === "draft";
            return (
              <DocRow key={d.id} d={d} previewing={previewing === d.id} onPreview={() => setPreviewing(previewing === d.id ? null : d.id)}>
                {previewing === d.id && <DocPreview title={`${d.name}.pdf`} content={contentFor(d)} onClose={() => setPreviewing(null)} />}
                {owed && d.id === "DOC_REQUEST" && (
                  <Button variant="outline" onClick={() => requestShippingDocs(b.id)}>Send the request to the supplier</Button>
                )}
                {owed && d.id === "AWB_TO_CHA" && (
                  customs ? (
                    <Button variant="outline" onClick={() => sendAwbToCha(b.id, customs.id)}>Send waybill + invoice to the broker</Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Needs a customs entry to attach to — the Customs desk files it.</span>
                  )
                )}
                {owed && d.id === "SHIPPING_INSTRUCTION" && (
                  <span className="text-[11px] text-muted-foreground">Produced by the booking form on the Shipment tab — book, and this sends itself.</span>
                )}
                {owed && d.id === "GRN" && (
                  <Button variant="outline" onClick={onGoToShipment}>Issue it on the Shipment tab</Button>
                )}
                {owed && (d.id === "PRE_ALERT" || d.id === "DAMAGE_NOTICE") && (
                  <Button variant="outline" onClick={() => setComposing(composing === d.id ? null : d.id)}>
                    <PenLine className="mr-1.5 h-3.5 w-3.5" />
                    {composing === d.id ? "Close" : "Prepare & send"}
                  </Button>
                )}
                {composing === d.id && (
                  <DocComposer
                    b={b}
                    docId={d.id}
                    presetName={d.name}
                    presetTo={(d.to ?? []).map((p) => MAILBOX_FOR[p])}
                    onSend={(doc) => { createLogisticsDoc(b.id, doc); setComposing(null); }}
                  />
                )}
              </DocRow>
            );
          })}
        </ul>

        {/* Ad-hoc documents already sent from here. */}
        {(b.logisticsOutbox ?? []).filter((x) => x.docId === "CUSTOM").map((x) => (
          <div key={x.id} className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm">
            <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
            <span className="min-w-0 flex-1 font-medium">{x.name}</span>
            <Pill tone="ok">Sent</Pill>
            <button
              type="button"
              onClick={() => setPreviewing(previewing === x.id ? null : x.id)}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-muted"
              title="Preview this document"
            >
              <Eye className="h-3 w-3" />
              Preview
            </button>
            <span className="w-full text-[11px] text-muted-foreground">
              sent to {x.to.map((k) => LOGISTICS_PARTY_LABEL[k as LogisticsParty] ?? k).join(", ")} · {x.at}
            </span>
            {previewing === x.id && (
              <div className="w-full">
                <DocPreview
                  title={`${x.name}.pdf`}
                  content={mockDocContent(x.name, b.orderNo, { "Sent to": x.to.map((k) => LOGISTICS_PARTY_LABEL[k as LogisticsParty] ?? k).join(", "), Date: x.at }, x.body)}
                  onClose={() => setPreviewing(null)}
                />
              </div>
            )}
          </div>
        ))}

        {/* Anything the register did not foresee. */}
        <div className="mt-2">
          <Button variant="outline" onClick={() => setShowCustom((v) => !v)}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" />
            {showCustom ? "Close" : "Create a document"}
          </Button>
          {showCustom && (
            <DocComposer
              b={b}
              docId="CUSTOM"
              presetName=""
              presetTo={[]}
              onSend={(doc) => { createLogisticsDoc(b.id, doc); setShowCustom(false); }}
            />
          )}
        </div>
      </section>

      {/* ── Not needed here, folded ───────────────────────────────────────── */}
      {na.length > 0 && (
        <section>
          <button onClick={() => setShowNa((v) => !v)} className="text-xs text-primary hover:underline">
            {showNa ? "Hide" : "Show"} {na.length} that do not apply to this consignment
          </button>
          {showNa && (
            <ul className="mt-2 space-y-1.5">
              {na.map((d) => (
                <DocRow key={d.id} d={d} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function DocRow({ d, previewing, onPreview, children }: { d: LogisticsDocView; previewing?: boolean; onPreview?: () => void; children?: React.ReactNode }) {
  const Icon = STATUS_ICON[d.status];
  const outstanding = d.status === "awaited" || d.status === "draft";
  const settled = d.status === "received" || d.status === "sent";
  return (
    <li className={cn("rounded-lg border p-2.5", outstanding && "bg-warn-bg", d.status === "not_needed" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", outstanding ? "text-warn" : d.status === "not_needed" ? "text-muted-foreground" : "text-ok")} />
        <span className="min-w-0 flex-1 text-sm font-medium">{d.name}</span>
        {settled && onPreview && (
          <button
            type="button"
            onClick={onPreview}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted",
              previewing ? "border-primary bg-accent-soft text-primary" : "bg-card text-primary",
            )}
            title="Preview this document — download from inside the preview"
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        )}
        <Pill tone={STATUS_TONE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Pill>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        {d.status === "not_needed" ? d.because : d.why}
      </p>
      {outstanding && (
        <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warn">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{d.ifMissing}</span>
        </p>
      )}
      {d.evidence && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="font-mono">{d.evidence}</span>
        </p>
      )}
      {d.status !== "not_needed" && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {d.direction === "IN" && d.from && (
            <span>from <b className="text-foreground">{COUNTERPARTY_LABEL[d.from]}</b></span>
          )}
          {d.direction === "OUT" && d.to && (
            <span>goes to <b className="text-foreground">{d.to.map((p) => COUNTERPARTY_LABEL[p]).join(", ")}</b></span>
          )}
          <span>·</span>
          <span>wanted {d.due.toLowerCase()}</span>
        </p>
      )}
      {children && <div className="mt-2 space-y-2">{children}</div>}
    </li>
  );
}

/** Inline create-and-send. Recipients preset from the register's own mapping. */
function DocComposer({
  b, docId, presetName, presetTo, onSend,
}: {
  b: OrderBundle;
  docId: string;
  presetName: string;
  presetTo: LogisticsParty[];
  onSend: (doc: { docId: string; name: string; to: LogisticsParty[]; body: string }) => void;
}) {
  const ALL: LogisticsParty[] = ["SUPPLIER", "CARRIER", "CHA", "WAREHOUSE", "CLIENT", "INSURER", "FINANCE"];
  const [name, setName] = useState(presetName);
  const [to, setTo] = useState<LogisticsParty[]>(Array.from(new Set(presetTo)));
  const [body, setBody] = useState(() => draftBody(docId, b));
  const toggle = (p: LogisticsParty) => setTo((t) => (t.includes(p) ? t.filter((x) => x !== p) : [...t, p]));

  return (
    <div className="rounded-lg border bg-card p-2.5">
      <Labeled label="Document name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Delivery appointment request" />
      </Labeled>
      <div className="mt-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Send to — the mapping is the point; pick everyone who needs it</span>
        <div className="flex flex-wrap gap-1.5">
          {ALL.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                to.includes(p) ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {LOGISTICS_PARTY_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2">
        <Labeled label="Content" hint="prefilled from the order — edit before sending">
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </Labeled>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={() => onSend({ docId, name, to, body })} disabled={!name.trim() || !body.trim() || to.length === 0}>
          Send to {to.length === 0 ? "…" : to.map((p) => LOGISTICS_PARTY_LABEL[p]).join(", ")}
        </Button>
      </div>
    </div>
  );
}
