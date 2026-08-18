"use client";

import { useState } from "react";
import { AlertTriangle, Check, Download, Eye, Lock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { OrderBundle, Lot, WhlReport } from "@/types";
import { WHL_CONTACT, statusTone } from "@/data/enums";
import { Pill, Button, Field, Notice } from "@/components/ui/primitives";
import { useStore } from "@/store/store";
import { currentReport } from "@/store/selectors";
import { qtyfmt, cn } from "@/lib/utils";

/**
 * A lot's WHL reports: every revision, with the header fields parsed on screen so nobody has
 * to open the PDF, plus the NDA access log.
 *
 * Shared by the acting testing workspace and the two read-only surfaces (the order's Testing
 * tab and the order-flow page), because §9.4's field list should exist once — three copies of
 * it would drift the moment WHL changes a report header.
 *
 * `readOnly` drops the one *acting* affordance here — reconciling a parse flag against the PO
 * on file, which edits the report and writes an audit row. **Viewing and downloading stay**:
 * the report is the deliverable those pages exist to show, and both are access-logged either
 * way, which is exactly what the NDA requires (invariant: no unlogged look at a report).
 */
export function ReportRepository({
  b, orderId, lot, readOnly,
}: { b: OrderBundle; orderId: string; lot: Lot; readOnly?: boolean }) {
  const logReportAccess = useStore((s) => s.logReportAccess);
  const reports = (lot.reports ?? []).slice().sort((a, c) => c.revision - a.revision);
  const [shown, setShown] = useState<string | null>(null);
  const current = currentReport(lot);
  const active = reports.find((r) => r.id === (shown ?? current?.id));

  // No chase button here: on the acting screen the card footer already carries "Request
  // update" while there's no report, and two buttons firing the same mail two inches apart
  // is just a second thing to read.
  if (reports.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <div className="text-sm font-medium">WHL report — <span className="text-warn">Not Available</span></div>
        <p className="text-xs text-muted-foreground">
          Nothing received by email for WO {lot.workOrderNo ?? "—"} yet.
          {lot.lastUpdateRequestAt && <> Update requested {lot.lastUpdateRequestAt}.</>}
          {readOnly
            ? <> Chase {WHL_CONTACT} from the testing workspace.</>
            : <> Use <b className="text-foreground">Request update</b> below to chase {WHL_CONTACT}.</>}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card-2 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          WHL report repository · {reports.length} version(s)
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {reports.map((r) => (
            <button key={r.id} onClick={() => { setShown(r.id); logReportAccess(orderId, lot.id, r.id, "VIEW"); }}
              title={`Open ${r.reportNo} — the look is access-logged`}
              className={cn("rounded-md border px-2 py-0.5 text-xs font-medium",
                active?.id === r.id ? "border-primary bg-accent-soft text-primary" : "hover:border-primary")}>
              {r.reportNo}{r.current && <Check className="ml-1 inline h-3 w-3 text-ok" />}
            </button>
          ))}
        </div>
      </div>
      {active && <ReportSummary b={b} orderId={orderId} lot={lot} r={active} readOnly={readOnly} />}
    </div>
  );
}

const CONCLUSION_TONE = (c: WhlReport["conclusion"]): "ok" | "bad" => (c === "ACCEPTABLE" ? "ok" : "bad");

/** Everything the operator needs without opening the PDF. */
function ReportSummary({
  b, orderId, lot, r, readOnly,
}: { b: OrderBundle; orderId: string; lot: Lot; r: WhlReport; readOnly?: boolean }) {
  const logReportAccess = useStore((s) => s.logReportAccess);
  const reconcileReportPo = useStore((s) => s.reconcileReportPo);
  const [showAccess, setShowAccess] = useState(false);
  const poOnFile = lot.clientPoNo ?? b.sourcingAllocations.find((a) => a.orderLineMpn === lot.orderLineMpn)?.clientPoNo;

  // The PDF is a mock — there's no file to hand over — so say what was logged instead of
  // silently doing nothing, which reads as a broken button.
  const download = () => {
    logReportAccess(orderId, lot.id, r.id, "DOWNLOAD");
    toast.success(`${r.fileName} — download logged`, {
      description: `${r.reportNo} · ${lot.lotCode} · recorded on the report's NDA access log.`,
    });
  };

  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{r.reportNo}</span>
          {!r.current && <Pill tone="neutral">superseded</Pill>}
          {r.current && <Pill tone="info">current</Pill>}
          <Pill tone={CONCLUSION_TONE(r.conclusion)}>{r.conclusion.replace(/_/g, " ")}</Pill>
          {r.anyFar && <Pill tone="warn">F.A.R. on a process — follow up</Pill>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowAccess((s) => !s)} title="Access log (NDA)"><ShieldAlert className="h-4 w-4" /> {r.accessLog.length}</Button>
          <Button variant="outline" onClick={() => logReportAccess(orderId, lot.id, r.id, "VIEW")} title="Open the report — the look is access-logged">
            <Eye className="h-4 w-4" /> Open PDF
          </Button>
          <Button variant="outline" onClick={download} title={`Download ${r.fileName} — access-logged`}>
            <Download className="h-4 w-4" /> Download
          </Button>
        </div>
      </div>

      {r.revisionNote && <p className="mb-3 rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">{r.revisionNote}</p>}

      {r.parseFlags.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {r.parseFlags.map((f, i) => (
            <Notice key={i} tone="warn" icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              action={!readOnly && f.toLowerCase().includes("client p/o") && poOnFile
                ? <button className="font-medium underline" onClick={() => reconcileReportPo(orderId, lot.id, r.id)}>Set to {poOnFile}</button>
                : undefined}>
              {f}
            </Notice>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <Field label="Report no · date">{r.reportNo} · {r.reportDate}</Field>
        <Field label="Work order">{r.workOrderNo}</Field>
        <Field label="Part number (MPN)">
          <span className={cn("font-mono", r.partNumber !== lot.orderLineMpn && "text-bad")}>{r.partNumber}</span>
        </Field>
        <Field label="Manufacturer">{r.manufacturer}</Field>
        <Field label="Lot qty">{qtyfmt(r.lotQty)}{r.lotQty !== lot.qty && <span className="ml-1 text-xs text-warn">(lot on file {qtyfmt(lot.qty)})</span>}</Field>
        <Field label="Client">{r.client}</Field>
        <Field label="Client P/O">
          <span className={cn(r.clientPo === "PO Unknown" && "text-warn")}>{r.clientPo}</span>
        </Field>
        <Field label="Approved by">{r.approvedBy} · {r.approverTitle}</Field>
        <Field label="Standards">{r.standards.join(", ")}</Field>
        <Field label="Risk classification">{r.riskClass ?? "—"}</Field>
        <Field label="MSL">{r.msl ?? "—"}</Field>
        <Field label="Package type">{r.packageType ?? "—"}</Field>
        <Field label="File">{r.fileName}</Field>
        <Field label="Received">{r.receivedAt}</Field>
      </div>

      {/* The process matrix used to be repeated here. It isn't any more: fetching a report
          rolls every process onto the lot's tracker above, so that table is the matrix —
          with the report number and the process note on each row. Only the roll-up stays. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card-2 px-3 py-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">{r.processes.length} process(es) reported</span>
        {(["ACCEPTABLE", "FAR", "NOT_ACCEPTABLE", "NOT_CONDUCTED"] as const).map((res) => {
          const n = r.processes.filter((p) => p.result === res).length;
          return n === 0 ? null : (
            <Pill key={res} tone={statusTone(res)}>{n} {res === "FAR" ? "F.A.R." : res.replace(/_/g, " ").toLowerCase()}</Pill>
          );
        })}
        <span className="text-faint">per-process results, quantities and notes are on the test tracker</span>
      </div>

      {showAccess && (
        <div className="mt-3 rounded-lg border bg-card-2 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Access log</div>
          {r.accessLog.length === 0 ? <p className="text-xs text-muted-foreground">No views recorded.</p> : (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {r.accessLog.map((a, i) => <li key={i}><span className="tnum text-faint">{a.at}</span> · {a.by} · {a.action.toLowerCase()}</li>)}
            </ul>
          )}
        </div>
      )}
      {r.confidentialityNote && (
        <p className="mt-3 inline-flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" /> {r.confidentialityNote}
        </p>
      )}
    </div>
  );
}
