"use client";

import { Check, FileText, Mail } from "lucide-react";
import type { OrderBundle, CustomsStage } from "@/types";
import { Pill, Button } from "@/components/ui/primitives";
import { money } from "@/lib/utils";
import { useStore } from "@/store/store";

export const CUSTOMS_STAGES: { key: CustomsStage; label: string }[] = [
  { key: "FILED", label: "BoE filed" },
  { key: "IGM_LINKED", label: "IGM linked" },
  { key: "ASSESSED", label: "Assessment" },
  { key: "DUTY_PAID", label: "Duty paid" },
  { key: "CLEARED", label: "Out of charge" },
];
export const cStageIdx = (s?: CustomsStage) => CUSTOMS_STAGES.findIndex((x) => x.key === s);

// One inbound shipment's ICEGATE clearance stepper: file → assess → pay duty → out-of-charge.
// Shared by the order's Customs tab (readOnly — status only) and the cross-order Customs desk
// (/fulfilment/customs — full actions, where the customs/CHA team works).
export function CustomsEntryCard({ c, id, readOnly = false, onFile }: { c: OrderBundle["customs"][number]; id: string; readOnly?: boolean; onFile?: () => void }) {
  const assess = useStore((s) => s.assessCustoms);
  const respond = useStore((s) => s.respondCustomsQuery);
  const payDuty = useStore((s) => s.payCustomsDuty);
  const clear = useStore((s) => s.clearCustoms);
  const sendAwb = useStore((s) => s.sendAwbToCha);
  const linkIgm = useStore((s) => s.linkIgm);
  // A BoE is "filed" once it has a real BE number; older/seeded entries may lack a stage, so infer it.
  const filed = !!c.beNo && c.beNo !== "filing…";
  const stage = c.stage ?? (filed ? "FILED" : undefined);
  const at = cStageIdx(stage);
  const flaggedOpen = c.assessment === "FLAGGED" && !c.queryResolvedAt;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="font-mono text-xs">{c.shipmentNo}</span> · BE {c.beNo || "—"}
          {c.boeType && <Pill tone="neutral">{c.boeType === "PRIOR" ? "Prior BoE" : "On-arrival"}</Pill>}
        </div>
        <div className="text-xs text-muted-foreground">Port {c.portCode ?? "—"} · CHA {c.chaName ?? "—"}{c.icegateAckNo ? ` · ack ${c.icegateAckNo}` : ""}{c.igmNo ? ` · IGM ${c.igmNo}/${c.igmItemNo}` : ""}</div>
      </div>
      {c.docs?.length
        ? <div className="text-xs text-muted-foreground">📎 Docs on file (eSANCHIT): <span className="text-foreground">{c.docs.join(", ")}</span></div>
        : <div className="text-xs text-faint">No supplier docs on file — collect them on the Logistics desk before/at filing.</div>}
      {c.awbSentToChaAt && <div className="text-xs text-muted-foreground">✉️ AWB sent to CHA on {c.awbSentToChaAt}</div>}
      {/* stage chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CUSTOMS_STAGES.map((st, i) => (
          <span key={st.key} className="flex items-center gap-1.5">
            <Pill tone={at >= i ? "ok" : "neutral"}>{st.label}{at >= i ? " ✓" : ""}</Pill>
            {i < CUSTOMS_STAGES.length - 1 && <span className="text-faint">→</span>}
          </span>
        ))}
      </div>
      {/* duty breakdown once assessed */}
      {c.duty && (
        <div className="text-xs text-muted-foreground">
          Duty (BCD {money(c.duty.bcd, c.currency)} + SWS {money(c.duty.sws, c.currency)} + IGST {money(c.duty.igst, c.currency)}) = <b className="text-foreground">{money(c.duty.totalDuty, c.currency)}</b>
          {c.dutyPaidAt && <span className="text-ok"> · paid {c.dutyPaidAt}</span>}
        </div>
      )}
      {/* flagged query */}
      {flaggedOpen && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-warn-bg p-2.5 text-xs text-warn">
          <span>🚩 Flagged in faceless assessment — {c.query}</span>
          {!readOnly && <Button variant="outline" onClick={() => respond(id, c.id)} className="py-1 text-xs">Respond to query</Button>}
        </div>
      )}
      {c.assessment === "FLAGGED" && c.queryResolvedAt && <p className="text-xs text-ok">Query responded on {c.queryResolvedAt} — assessment resolved.</p>}
      {/* IGM linkage — a filed (esp. Prior) BoE stays pending until the AWB matches a filed manifest */}
      {filed && stage === "FILED" && c.igmStatus === "AWAITING" && (
        <div className="rounded-lg border bg-warn-bg p-2.5 text-xs text-warn">
          🔗 Awaiting IGM — the courier files the Import General Manifest when the flight lands. The BoE links (and can be assessed) only once the AWB matches a filed IGM; before that ICEGATE returns “Manifest Not Found”.
        </div>
      )}
      {/* current-stage action (hidden in read-only status view) */}
      <div className="flex flex-wrap items-center gap-2">
        {!filed
          ? (readOnly
              ? <span className="text-xs text-muted-foreground">Bill of Entry not filed yet — the customs team files it on the Customs desk.</span>
              : <>
                  {!c.awbSentToChaAt && <Button variant="outline" onClick={() => sendAwb(id, c.id)}><Mail className="h-4 w-4" /> Send AWB to CHA</Button>}
                  <Button variant="outline" onClick={onFile}><FileText className="h-4 w-4" /> File Bill of Entry (ICEGATE)</Button>
                </>)
          : stage === "CLEARED"
            ? <span className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Out of Charge · ICEGATE {c.icegateRef} · {c.oocDate} — shipment released, journey gate satisfied.</span>
            : readOnly
              ? <span className="text-xs text-muted-foreground">Next: {stage === "FILED" ? "link IGM" : stage === "IGM_LINKED" ? "faceless assessment" : stage === "ASSESSED" ? (flaggedOpen ? "respond to query" : "pay duty") : "get out-of-charge"} — handled at the Customs desk.</span>
              : <>
                  {stage === "FILED" && <Button variant="outline" onClick={() => linkIgm(id, c.id)}>Link IGM (match manifest)</Button>}
                  {stage === "IGM_LINKED" && <Button variant="outline" onClick={() => assess(id, c.id)}>Run faceless assessment</Button>}
                  {stage === "ASSESSED" && !flaggedOpen && <Button variant="outline" onClick={() => payDuty(id, c.id)}>Pay duty on ICEGATE</Button>}
                  {stage === "DUTY_PAID" && <Button variant="outline" onClick={() => clear(id, c.id)}>Get Out-of-Charge</Button>}
                </>}
      </div>
    </div>
  );
}
