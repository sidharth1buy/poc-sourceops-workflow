"use client";

// THE LOGISTICS DESK'S PAPER ON ONE ORDER — a register you can scan.
//
// One table, two sections, in the order the desk thinks: COMING IN (the
// supplier's shipping set, the carrier's waybill and delivery order, the
// broker's entry and release, the proof of delivery) and GOING OUT (the
// document request, the shipping instruction, the pre-alert, the waybill
// handover, the receipt, the damage notice). Outstanding rows float to the top
// of their section.
//
// THE TABLE SAYS WHAT; THE ROW OPENS THE DOCUMENT. The listing is sorted by
// the IDEAL CHRONOLOGY of an inbound leg (the # column is that position), so
// reading top to bottom is reading the flow. Clicking a row opens the document
// in a pop-up: the paper itself when it is on file, otherwise the full story —
// why it exists, what stops without it, who has it. Only GOING-OUT rows carry
// an Action column, because only those are this desk's to produce; what is
// coming in is chased from the Communication tab, not buttoned here.

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ArrowRight, Check, Clock, FileText, Minus, PenLine, Send, Zap } from "lucide-react";
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
import { Button, DataTable, Pill, type Col } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { Input, Labeled, Textarea } from "@/components/ui/form";
import { DocPreview } from "@/components/logistics/doc-preview";
import { mockDocContent } from "@/lib/download";
import { cn } from "@/lib/utils";

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
  received: Check, sent: Check, awaited: AlertTriangle, draft: AlertTriangle, not_needed: Minus,
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

/** One table row: a register entry, or a document the desk created ad hoc. */
interface Row {
  key: string;
  section: "IN" | "OUT";
  /** Position in the ideal chronology of the inbound flow. */
  seq: number;
  name: string;
  /** Who it comes from (IN) or goes to (OUT), as display labels. */
  parties: string[];
  status: DocStatus;
  due: string;
  outstanding: boolean;
  /** The register entry behind it, where there is one. */
  spec?: LogisticsDocView;
  /** The ad-hoc document behind it, where there is one. */
  custom?: { name: string; to: string[]; at: string; body: string };
}

const SECTION_TITLE: Record<Row["section"], string> = {
  IN: "Coming in — received from the supplier, the logistics partner and the broker",
  OUT: "Going out — this desk produces and sends; every document names its recipients",
};

export function LogisticsDocumentsTab({ b, onGoToShipment }: { b: OrderBundle; onGoToShipment: () => void }) {
  const requestShippingDocs = useStore((s) => s.requestShippingDocs);
  const sendAwbToCha = useStore((s) => s.sendAwbToCha);
  const createLogisticsDoc = useStore((s) => s.createLogisticsDoc);

  const docs = useMemo(() => logisticsDocuments(b), [b]);
  const [showNa, setShowNa] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);

  const rows = useMemo<Row[]>(() => {
    /* Sorted by the flow's ideal chronology, not by urgency — reading the
     * section top to bottom is reading the leg in order. */
    const bySeq = (a: Row, z: Row) => a.seq - z.seq;
    const fromSpec = (d: LogisticsDocView): Row => ({
      key: d.id,
      /* A document that does not apply still belongs to its direction — it is
       * shown in place (muted, labelled) so the flow reads complete. */
      section: d.direction,
      seq: d.seq,
      name: d.name,
      parties: d.direction === "IN"
        ? (d.from ? [COUNTERPARTY_LABEL[d.from]] : [])
        : (d.to ?? []).map((p) => COUNTERPARTY_LABEL[p]),
      status: d.status,
      due: d.due,
      outstanding: d.status === "awaited" || d.status === "draft",
      spec: d,
    });
    const applies = (d: LogisticsDocView) => showNa || d.status !== "not_needed";
    const incoming = docs.filter((d) => d.direction === "IN" && applies(d)).map(fromSpec).sort(bySeq);
    const outgoing = docs.filter((d) => d.direction === "OUT" && applies(d)).map(fromSpec).sort(bySeq);
    /* Ad-hoc documents the desk created — ordinary rows in Going out, slotted
     * where they happen: after the receipt, before the claim. */
    const custom = (b.logisticsOutbox ?? []).filter((x) => x.docId === "CUSTOM").map((x): Row => ({
      key: x.id,
      section: "OUT",
      seq: 14.5,
      name: x.name,
      parties: x.to.map((k) => LOGISTICS_PARTY_LABEL[k as LogisticsParty] ?? k),
      status: "sent",
      due: "Sent ad hoc",
      outstanding: false,
      custom: x,
    }));
    return [...incoming, ...[...outgoing, ...custom].sort(bySeq)];
  }, [docs, b.logisticsOutbox, showNa]);

  const openRow = open ? rows.find((r) => r.key === open) ?? null : null;
  const awaited = rows.filter((r) => r.section === "IN" && r.outstanding).length;
  const owed = rows.filter((r) => r.section === "OUT" && r.outstanding).length;
  const naCount = docs.filter((d) => d.status === "not_needed").length;

  /** The rendered paper for a row — the record the app holds, as a readable file. */
  const contentFor = (r: Row) => {
    if (r.custom) {
      return mockDocContent(r.custom.name, b.orderNo, { "Sent to": r.parties.join(", "), Date: r.custom.at }, r.custom.body);
    }
    const d = r.spec!;
    const produced = b.logisticsOutbox?.find((x) => x.docId === d.id);
    return mockDocContent(d.name, b.orderNo, {
      Direction: d.direction === "IN" ? `received from ${r.parties.join(", ") || "counterparty"}` : `sent to ${r.parties.join(", ")}`,
      Status: DOC_STATUS_LABEL[d.status],
      "On file": d.evidence,
      "Why it exists": d.why,
    }, produced?.body);
  };

  const columns: Col<Row>[] = [
    {
      key: "seq",
      header: "#",
      render: (r) => (
        /* The document's place in the ideal chronology of the leg. */
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border bg-muted/40 text-[10px] font-bold text-muted-foreground tnum">
          {Math.floor(r.seq)}
        </span>
      ),
    },
    {
      key: "doc",
      header: "Document",
      render: (r) => (
        <div className="flex items-center gap-2">
          {r.status === "not_needed"
            ? <Minus className="h-3.5 w-3.5 shrink-0 text-faint" />
            : r.section === "IN"
              ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-primary" />
              : <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className={cn("text-sm font-medium", r.status === "not_needed" && "text-muted-foreground")}>{r.name}</span>
        </div>
      ),
    },
    {
      key: "party",
      header: "From / goes to",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.section === "IN" ? "from " : "→ "}
          <b className="font-medium text-foreground">{r.parties.join(", ") || "—"}</b>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const Icon = STATUS_ICON[r.status];
        return (
          <Pill tone={STATUS_TONE[r.status]}>
            <Icon className="mr-1 inline h-3 w-3" />
            {DOC_STATUS_LABEL[r.status]}
          </Pill>
        );
      },
    },
    {
      key: "due",
      header: "Wanted",
      render: (r) => <span className="text-xs text-muted-foreground">{r.due}</span>,
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      /* Only the desk's own documents carry an action here — what comes in is
       * chased from the Communication tab, not buttoned on this table. The one
       * exception: a document that does not apply is LABELLED so, whichever
       * direction it belongs to, with the reason on hover. */
      render: (r) =>
        r.status === "not_needed"
          ? <ActionChip icon={Minus} label="Not needed" title={r.spec?.because ?? "Does not apply to this consignment."} />
          : r.section === "OUT" ? <RowAction r={r} /> : null,
    },
  ];

  /*
   * ONE GRAMMAR FOR THE ACTION RAIL. Every going-out row gets exactly one
   * slot of identical size: a real button when there is an act to perform, a
   * quiet chip when the act is automatic, blocked, or already done. Mixed
   * buttons and floating text made the column ragged; a fixed-width slot
   * keeps the rail straight and every state scannable.
   */
  const SLOT = "inline-flex h-8 w-40 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-xs font-medium";

  function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Send; label: string; onClick: (e: React.MouseEvent) => void }) {
    return (
      <button type="button" onClick={onClick} className={cn(SLOT, "border bg-card text-primary transition hover:border-primary hover:bg-muted")}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
    );
  }

  function ActionChip({ icon: Icon, label, title, tone = "muted" }: { icon: typeof Send; label: string; title: string; tone?: "muted" | "ok" }) {
    return (
      <span title={title} className={cn(SLOT, "cursor-help border border-dashed", tone === "ok" ? "border-emerald-400/40 bg-ok-bg/50 text-ok" : "bg-muted/30 text-muted-foreground")}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }

  function RowAction({ r }: { r: Row }) {
    if (!r.outstanding) {
      return <ActionChip icon={Check} label="Sent · open to view" title="Done. Click the row to open the document." tone="ok" />;
    }
    if (r.spec?.id === "DOC_REQUEST") {
      return <ActionButton icon={Send} label="Send request" onClick={(e) => { e.stopPropagation(); requestShippingDocs(b.id); }} />;
    }
    if (r.spec?.id === "AWB_TO_CHA") {
      const c = b.customs?.[0];
      return c
        ? <ActionButton icon={Send} label="Send to broker" onClick={(e) => { e.stopPropagation(); sendAwbToCha(b.id, c.id); }} />
        : <ActionChip icon={Clock} label="Awaiting entry" title="Needs a customs entry to attach to — the Customs desk files it." />;
    }
    if (r.spec?.id === "GRN") {
      return <ActionButton icon={ArrowRight} label="Issue GRN" onClick={(e) => { e.stopPropagation(); onGoToShipment(); }} />;
    }
    if (r.spec?.id === "SHIPPING_INSTRUCTION") {
      return <ActionChip icon={Zap} label="Via booking" title="Produced and sent automatically by the booking form on the Shipment tab." />;
    }
    /* Pre-alert / damage notice — composed in the pop-up. */
    return <ActionButton icon={PenLine} label="Prepare & send" onClick={(e) => { e.stopPropagation(); setOpen(r.key); }} />;
  }

  return (
    <div className="space-y-3">
      {/* ── The header line: counts + the two acts that live above the table ── */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Only this desk&rsquo;s paper. Click a row for the full story — and the document itself.
        </p>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {awaited > 0 && <Pill tone="warn">{awaited} awaited</Pill>}
          {owed > 0 && <Pill tone="warn">{owed} owed</Pill>}
          <Button variant="outline" onClick={() => setShowCustom((v) => !v)}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" />
            {showCustom ? "Close" : "Create a document"}
          </Button>
        </span>
      </div>

      {/* Ad-hoc composer — a card above the table, never a dialog. */}
      {showCustom && (
        <DocComposer
          b={b}
          docId="CUSTOM"
          presetName=""
          presetTo={[]}
          onSend={(doc) => { createLogisticsDoc(b.id, doc); setShowCustom(false); }}
        />
      )}

      <DataTable<Row>
        columns={columns}
        rows={rows}
        sectionOf={(r) => SECTION_TITLE[r.section]}
        onRowClick={(r) => setOpen(r.key)}
        rowMuted={(r) => r.status === "not_needed"}
        empty="No documents apply to this consignment yet."
      />

      {/* The document itself, in a pop-up: the paper when it is on file, the
          full story (and the act, for the desk's own documents) when not. */}
      {openRow && (
        <Dialog open onClose={() => setOpen(null)} title={openRow.name}>
          <DocDialogBody
            r={openRow}
            b={b}
            contentFor={contentFor}
            onGoToShipment={() => { setOpen(null); onGoToShipment(); }}
            onRequestDocs={() => { requestShippingDocs(b.id); setOpen(null); }}
            onSendAwb={() => { const c = b.customs?.[0]; if (c) sendAwbToCha(b.id, c.id); setOpen(null); }}
            hasCustomsEntry={Boolean(b.customs?.[0])}
            onCreate={(doc) => { createLogisticsDoc(b.id, doc); setOpen(null); }}
          />
        </Dialog>
      )}

      {naCount > 0 && (
        <button onClick={() => setShowNa((v) => !v)} className="text-xs text-primary hover:underline">
          {showNa ? "Hide" : "Show"} {naCount} that do not apply — they appear muted in their own sections
        </button>
      )}
    </div>
  );
}

/* ── Inside the pop-up: the why, the consequence, the paper, the work ─────── */
function DocDialogBody({
  r, b, contentFor, onGoToShipment, onRequestDocs, onSendAwb, hasCustomsEntry, onCreate,
}: {
  r: Row;
  b: OrderBundle;
  contentFor: (r: Row) => string;
  onGoToShipment: () => void;
  onRequestDocs: () => void;
  onSendAwb: () => void;
  hasCustomsEntry: boolean;
  onCreate: (doc: { docId: string; name: string; to: LogisticsParty[]; body: string }) => void;
}) {
  const d = r.spec;
  const composerDoc = d && (d.id === "PRE_ALERT" || d.id === "DAMAGE_NOTICE") && r.outstanding;

  return (
    <div className="space-y-2">
      {/* The story, folded off the table. */}
      {d && (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {d.status === "not_needed" ? d.because : d.why}
        </p>
      )}
      {d && r.outstanding && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warn">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{d.ifMissing}</span>
        </p>
      )}
      {d?.evidence && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="font-mono">{d.evidence}</span>
        </p>
      )}

      {/* The one act this row needs, done here. */}
      {r.outstanding && r.section === "IN" && (
        <p className="text-[11px] text-muted-foreground">
          Waiting on <b className="text-foreground">{r.parties.join(", ")}</b> — chase it from the Communication tab; the drafter knows what to ask for.
        </p>
      )}
      {r.outstanding && d?.id === "DOC_REQUEST" && (
        <Button variant="outline" onClick={onRequestDocs}>Send the request to the supplier</Button>
      )}
      {r.outstanding && d?.id === "AWB_TO_CHA" && (
        hasCustomsEntry
          ? <Button variant="outline" onClick={onSendAwb}>Send waybill + invoice to the broker</Button>
          : <p className="text-[11px] text-muted-foreground">Needs a customs entry to attach to — the Customs desk files it.</p>
      )}
      {r.outstanding && d?.id === "SHIPPING_INSTRUCTION" && (
        <p className="text-[11px] text-muted-foreground">Produced by the booking form on the Shipment tab — book, and this sends itself.</p>
      )}
      {r.outstanding && d?.id === "GRN" && (
        <Button variant="outline" onClick={onGoToShipment}>Issue it on the Shipment tab</Button>
      )}
      {composerDoc && (
        <DocComposer
          b={b}
          docId={d!.id}
          presetName={d!.name}
          presetTo={(d!.to ?? []).map((p) => MAILBOX_FOR[p])}
          onSend={onCreate}
        />
      )}

      {/* The paper itself, for anything settled. */}
      {!r.outstanding && r.status !== "not_needed" && (
        <DocPreview title={`${r.name}.pdf`} content={contentFor(r)} onClose={() => undefined} hideClose />
      )}
    </div>
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
    <div className="rounded-lg border bg-card p-2.5" onClick={(e) => e.stopPropagation()}>
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
