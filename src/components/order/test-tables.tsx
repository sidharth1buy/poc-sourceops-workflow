"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2, Receipt, Lock } from "lucide-react";
import type { OrderBundle, Lot, TestProcessStatus, MpnTestSpec } from "@/types";
import {
  TEST_PROCESS_STATUSES, statusTone,
  LAB_TERMS_LABEL, LAB_TERMS_TONE, LAB_TERMS_HINT, LAB_PAYMENT_LABEL, LAB_PAYMENT_TONE,
} from "@/data/enums";
import { Pill, StatusPill } from "@/components/ui/primitives";
import { Select } from "@/components/ui/form";
import { useStore } from "@/store/store";
import {
  lotTestRows, lotTestProgress, currentReport, mpnFeeRollup, labPaymentOf, labTerms, labFeeBlocking, labFeeGross,
} from "@/store/selectors";
import { cn } from "@/lib/utils";

/**
 * The test list used to be rendered three times — as the MPN's requirements, as the lot's
 * status tracker, and again as the report's process matrix. They were the same names three
 * times over, because the report's results are rolled onto the tracker the moment it's
 * fetched, and the tracker rows are inherited from the requirements.
 *
 * So there are now exactly two tables, and neither repeats the other:
 *
 *   LotTestTable   — one row per test on ONE lot: requirement, live status, quantities and
 *                    the report line that settled it. The report section keeps the header
 *                    fields and the conclusion; it no longer re-lists the processes.
 *   MpnTestMatrix  — one row per test on ONE MPN, with a column per lot. Answers "is this
 *                    requirement covered on every lot, and what did each one say" — which
 *                    a flat list of names never did.
 */

const resultLabel = (r: string) => (r === "FAR" ? "F.A.R." : r.replace(/_/g, " "));

// ============================ per-lot: the one status tracker ============================

export function LotTestTable({
  orderId, lot, canEdit,
}: { orderId: string; lot: Lot; canEdit: boolean }) {
  const rows = lotTestRows(lot);
  const report = currentReport(lot);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No tests on this lot — the MPN&apos;s test list is empty or failed to auto-fill (see MPNs &amp; tests).
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-card-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left">Test</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Accept / Reject</th>
            {/* the report column replaces the process matrix that used to sit further down */}
            <th className="px-3 py-2 text-left">Per the report</th>
            <th className="px-3 py-2 text-left">Updated</th>
            <th className="px-3 py-2 text-right">Set</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <TestRow key={r.key} orderId={orderId} lotId={lot.id} row={r} canEdit={canEdit} />)}
        </tbody>
      </table>
      <p className="border-t bg-card-2 px-3 py-1.5 text-[11px] text-faint">
        {report
          ? <>Results are from report <b className="text-muted-foreground">{report.reportNo}</b>, process by process — a report can be <b>Acceptable</b> overall while one process is <b>F.A.R.</b>, so these rows are the source of truth, not the headline conclusion.</>
          : <>Statuses come from WHL&apos;s interim mails until the report lands and settles them.</>}
      </p>
    </div>
  );
}

function TestRow({
  orderId, lotId, row, canEdit,
}: { orderId: string; lotId: string; row: ReturnType<typeof lotTestRows>[number]; canEdit: boolean }) {
  const setLotTestStatus = useStore((s) => s.setLotTestStatus);
  const [open, setOpen] = useState(false);
  const t = row.test;
  const history = t?.history ?? [];

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="px-3 py-2">
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-start gap-1 text-left hover:text-primary">
            {open ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>
              {row.name}
              {/* standard + provenance ride with the name instead of owning two columns */}
              <span className="ml-1.5 whitespace-nowrap text-[11px] text-faint">
                {t?.standard ?? ""}
                {t ? (t.source === "MANUAL" ? " · manual" : "") : " · report only"}
              </span>
            </span>
          </button>
        </td>
        <td className="px-3 py-2"><StatusPill status={t?.status ?? row.report?.result} /></td>
        <td className="px-3 py-2 text-right tnum text-xs">
          {row.acceptQty === undefined && row.rejectQty === undefined ? "—" : `${row.acceptQty ?? 0} / ${row.rejectQty ?? 0}`}
        </td>
        <td className="px-3 py-2 text-xs">
          {row.report ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Pill tone={statusTone(row.report.result)}>{resultLabel(row.report.result)}</Pill>
              <span className="font-mono text-faint">{row.report.reportNo}</span>
              {row.report.note && <span className="text-muted-foreground">{row.report.note}</span>}
            </span>
          ) : <span className="text-faint">not reported yet</span>}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{t?.updatedAt ?? "—"}</td>
        <td className="px-3 py-2 text-right">
          {t ? (
            <Select className="w-36 py-1 text-xs" value={t.status} disabled={!canEdit}
              onChange={(e) => setLotTestStatus(orderId, lotId, t.id, e.target.value as TestProcessStatus, "Set manually on the tracker.")}>
              {TEST_PROCESS_STATUSES.map((s) => <option key={s} value={s}>{s === "FAR" ? "F.A.R." : s.replace(/_/g, " ")}</option>)}
            </Select>
          ) : <span className="text-[11px] text-faint">not on the PO</span>}
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-card-2 last:border-0">
          <td colSpan={6} className="px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status history</div>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t ? "No history yet." : "This process is on the report but was never on the PO's test list — nothing was tracked against it."}
              </p>
            ) : (
              <ol className="space-y-1.5">
                {history.slice().reverse().map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="tnum text-faint">{h.at}</span>
                    {h.before && <><StatusPill status={h.before} /><span className="text-faint">→</span></>}
                    <StatusPill status={h.after} />
                    <span className="text-muted-foreground">{h.by}{h.note ? ` · ${h.note}` : ""}{h.sourceEmailId ? " · from inbound email" : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ==================== per-MPN: requirements × lots, plus what it costs ====================

/**
 * What the lab charges to test this MPN and how it wants paying — both read off its
 * invoice mails, never entered here. Sits with the tests because the bill *is* the test
 * list priced: amount = processes × rate.
 */
export function MpnFeeStrip({ b, mpn }: { b: OrderBundle; mpn: string }) {
  const fee = mpnFeeRollup(b, mpn);
  if (fee.invoiced === 0) {
    return (
      <p className="text-[11px] text-faint">
        No WHL invoice for this MPN yet — the amount and the payment mode both arrive on the lab&apos;s invoice mail.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide">
        <Receipt className="h-3.5 w-3.5" /> Testing fee
      </span>
      <span className="tnum text-foreground">{fee.currency} {fee.gross.toLocaleString()}</span>
      {fee.ratePerProcess !== undefined && <span>{fee.currency} {fee.ratePerProcess} per process</span>}
      {fee.terms.length === 1
        ? <Pill tone={LAB_TERMS_TONE[fee.terms[0]]} title={LAB_TERMS_HINT[fee.terms[0]]}>{LAB_TERMS_LABEL[fee.terms[0]]}</Pill>
        : fee.terms.length > 1 && <Pill tone="warn" title="This MPN's lots were invoiced on different terms — check each lot.">mixed terms</Pill>}
      {fee.unpaid > 0
        ? <span className="text-warn">{fee.currency} {fee.unpaidGross.toLocaleString()} unpaid across {fee.unpaid} lot(s)</span>
        : <span className="text-ok">settled</span>}
      {fee.blocked.length > 0 && (
        <span className="inline-flex items-center gap-1 text-bad">
          <Lock className="h-3 w-3" /> {fee.blocked.join(", ")} held for advance payment
        </span>
      )}
      {fee.invoiced < fee.lots && <span className="text-faint">{fee.lots - fee.invoiced} lot(s) not invoiced yet</span>}
    </div>
  );
}

/**
 * The MPN's required tests as rows, with a column per lot of that MPN carrying that lot's
 * live status. This is the coverage question — "is every requirement actually being tested
 * on every lot, and where does each stand" — which is why it earns its place next to the
 * per-lot tracker instead of repeating it.
 */
export function MpnTestMatrix({
  b, orderId, mpn, spec, canEdit, editing,
}: {
  b: OrderBundle; orderId: string; mpn: string; spec: MpnTestSpec;
  canEdit: boolean; editing: boolean;
}) {
  const removeMpnTest = useStore((s) => s.removeMpnTest);
  const lots = b.lots.filter((l) => l.orderLineMpn === mpn);
  const rate = mpnFeeRollup(b, mpn).ratePerProcess;

  const statusOn = (lot: Lot, name: string) => (lot.tests ?? []).find((t) => t.name === name)?.status;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-card-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left">Required test</th>
            <th className="px-3 py-2 text-left">Source</th>
            {rate !== undefined && <th className="px-3 py-2 text-right">Rate</th>}
            {lots.map((l) => (
              <th key={l.id} className="px-3 py-2 text-left">
                <span className="block">{l.lotCode}</span>
                <LotFeeCaption lot={l} />
              </th>
            ))}
            {lots.length === 0 && <th className="px-3 py-2 text-left">Lots</th>}
            {editing && <th className="w-8 px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {spec.tests.map((t) => (
            <tr key={t.id} className="border-b last:border-0">
              <td className="px-3 py-2">
                {t.name}
                {t.standard && <span className="ml-1.5 text-[11px] text-faint">{t.standard}</span>}
              </td>
              <td className="px-3 py-2">
                <Pill tone={t.source === "AUTO_PO" ? "info" : "warn"}>{t.source === "AUTO_PO" ? "from PO" : "manual"}</Pill>
                {t.source === "MANUAL" && t.addedBy && <span className="ml-1.5 text-[11px] text-faint">{t.addedBy} · {t.addedAt}</span>}
              </td>
              {rate !== undefined && <td className="px-3 py-2 text-right tnum text-xs text-muted-foreground">{rate}</td>}
              {lots.map((l) => {
                const st = statusOn(l, t.name);
                return (
                  <td key={l.id} className="px-3 py-2">
                    {st ? <StatusPill status={st} /> : <span className="text-[11px] text-warn">not on lot</span>}
                  </td>
                );
              })}
              {lots.length === 0 && <td className="px-3 py-2 text-[11px] text-faint">no lots yet</td>}
              {editing && (
                <td className="px-3 py-2">
                  <button onClick={() => removeMpnTest(orderId, mpn, t.id)} disabled={!canEdit}
                    className="text-bad hover:opacity-70 disabled:opacity-40" title="Delete test (logged)">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {lots.length > 0 && (
          <tfoot>
            <tr className="border-t bg-card-2 text-[11px] text-muted-foreground">
              <td className="px-3 py-1.5 font-medium" colSpan={rate !== undefined ? 3 : 2}>passed / tracked</td>
              {lots.map((l) => {
                const p = lotTestProgress(l);
                return (
                  <td key={l.id} className={cn("px-3 py-1.5 tnum", p.total > 0 && p.settled === p.total && "text-ok")}>
                    {p.settled}/{p.total}
                  </td>
                );
              })}
              {editing && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Per-lot fee under its matrix column header: amount, mode, and whether it's settled. */
function LotFeeCaption({ lot }: { lot: Lot }) {
  const pay = labPaymentOf(lot);
  const terms = labTerms(lot);
  const gross = labFeeGross(lot);
  if (!pay.invoice) return <span className="block font-normal normal-case tracking-normal text-faint">no invoice</span>;
  return (
    <span className="block font-normal normal-case tracking-normal">
      <span className="tnum text-muted-foreground">{pay.invoice.currency} {gross.toLocaleString()}</span>
      {terms && <span className={cn("ml-1", labFeeBlocking(lot) ? "text-bad" : LAB_TERMS_TONE[terms] === "warn" ? "text-warn" : "text-faint")}>
        {LAB_TERMS_LABEL[terms].toLowerCase()}
      </span>}
      <span className={cn("ml-1", LAB_PAYMENT_TONE[pay.status] === "ok" ? "text-ok" : "text-faint")}>
        · {LAB_PAYMENT_LABEL[pay.status].toLowerCase()}
      </span>
    </span>
  );
}
