"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileText, MailQuestion, AlertTriangle, ChevronRight, FlaskConical, Lock, Receipt } from "lucide-react";
import { useStore } from "@/store/store";
import {
  allLots, lotTestProgress, currentReport, unmatchedEmails, testingSummary,
  labFeeOutstandingTotal, overdueUpdateRequests, orderPhaseTimings,
} from "@/store/selectors";
import { Panel, Pill, StatusPill, PageHeader, Progress, RoleLocked } from "@/components/ui/primitives";
import { TestingStageBar } from "@/components/order/testing-stages";
import { useRole } from "@/lib/role";
import { cn } from "@/lib/utils";

export default function TestingPage() {
  const orders = useStore((s) => s.orders);
  const setLotStatus = useStore((s) => s.setLotStatus);
  const { canAccessTesting } = useRole();
  const rows = allLots(orders);
  const unmatched = Object.values(orders).flatMap((b) => unmatchedEmails(b).map((m) => ({ ...m, orderId: b.id, orderNo: b.orderNo })));
  const [q, setQ] = useState("");

  // Order-first: testing is worked one order at a time, so the board's first job is
  // picking one. Orders with no testable line and no lot are dropped — there is nothing
  // to test on them.
  const orderRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(orders)
      .filter((b) => b.lots.length > 0 || b.lines.some((l) => l.testingMode !== "NONE"))
      .filter((b) => needle === "" || `${b.orderNo} ${b.buyer.name} ${b.supplier.name} ${b.lots.map((l) => `${l.lotCode} ${l.orderLineMpn}`).join(" ")}`.toLowerCase().includes(needle))
      .map((b) => {
        const sum = testingSummary(b);
        const fees = labFeeOutstandingTotal(b);
        const overdue = overdueUpdateRequests(b).length;
        const testingRisk = orderPhaseTimings(b).find((p) => p.phase === "TESTING")?.atRisk;
        // What needs a human: mail to match, a chase past SLA, a lot the lab is holding,
        // a bad result, an MPN whose test list never parsed.
        const attention = sum.unmatched + overdue + fees.blocking.length + sum.failed + sum.far + sum.gaps + (testingRisk ? 1 : 0);
        return { b, sum, fees, overdue, testingRisk, attention };
      })
      // Live testing first, then whatever needs a human, then newest — an order with no lot
      // and no tests is nothing to work on yet, so it doesn't belong at the top of a
      // pick-one board.
      .sort((x, y) =>
        (y.sum.lots > 0 ? 1 : 0) - (x.sum.lots > 0 ? 1 : 0)
        || y.attention - x.attention
        || (x.b.orderNo < y.b.orderNo ? 1 : -1));
  }, [orders, q]);

  if (!canAccessTesting) {
    return (
      <div className="space-y-5">
        <PageHeader title="Testing" description="WHL testing — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="view or act on testing" /></Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Testing"
        description="Pick an order to work its testing: WHL mail, reports, lab fees, lifecycle and lot verdicts. The same screen is on the order's own Testing tab — this board is the way in when you're working the lab, not one order."
        actions={
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / party / lot / MPN…"
            className="w-60 rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary" />
        } />

      {unmatched.length > 0 && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 text-warn"><MailQuestion className="h-4 w-4" /> {unmatched.length} inbound WHL email(s) await manual matching.</span>
            <span className="flex flex-wrap gap-2">
              {Array.from(new Set(unmatched.map((m) => m.orderId))).map((oid) => (
                <Link key={oid} href={`/fulfilment/testing/${oid}`} className="font-mono text-xs text-primary hover:underline">
                  {orders[oid]?.orderNo}
                </Link>
              ))}
            </span>
          </div>
        </Panel>
      )}

      <Panel title={`Orders with testing · ${orderRows.length}`}>
        {orderRows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {q ? "No order matches that search." : "No order has a testable line yet."}
          </div>
        ) : (
          <div className="space-y-2">
            {orderRows.map(({ b, sum, fees, overdue, testingRisk }) => {
              const pct = sum.tests ? Math.round((sum.passed / sum.tests) * 100) : 0;
              return (
                <Link key={b.id} href={`/fulfilment/testing/${b.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3 transition hover:border-primary hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <FlaskConical className="h-4 w-4 text-primary" />
                      <span className="font-mono text-xs text-primary">{b.orderNo}</span>
                      <StatusPill status={b.status} />
                      <span className="text-faint">·</span>
                      <span className="truncate text-muted-foreground">{b.buyer.name} <span className="text-faint">←</span> {b.supplier.name}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{sum.lots} lot(s) · {sum.tests ? `${sum.passed}/${sum.tests} tests passed` : "no tests on file"}</span>
                      <span>{sum.reports} report(s)</span>
                      {sum.far > 0 && <span className="text-warn">{sum.far} F.A.R.</span>}
                      {sum.failed > 0 && <span className="text-bad">{sum.failed} not acceptable</span>}
                      {overdue > 0 && <span className="text-bad">{overdue} chase overdue</span>}
                    </div>
                    {sum.tests > 0 && <div className="mt-1.5 max-w-xs"><Progress value={pct} /></div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {sum.unmatched > 0 && <Pill tone="warn"><MailQuestion className="h-3 w-3" /> {sum.unmatched} to match</Pill>}
                    {fees.blocking.length > 0
                      ? <Pill tone="bad"><Lock className="h-3 w-3" /> {fees.blocking.length} lot(s) held</Pill>
                      : fees.count > 0 && <Pill tone="warn"><Receipt className="h-3 w-3" /> {fees.currency} {fees.gross.toLocaleString()} fee unpaid</Pill>}
                    {sum.gaps > 0 && <Pill tone="warn">{sum.gaps} MPN gap(s)</Pill>}
                    {testingRisk && <Pill tone="bad" title={testingRisk.reason}>action needed</Pill>}
                    {sum.lots > 0 && sum.open === 0 && sum.failed === 0 && sum.far === 0 && <Pill tone="ok">all settled</Pill>}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                </Link>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Opening an order here gives the full testing workspace — the same tracker, mail thread and
          actions you get from that order&apos;s Testing tab. One screen, two doors.
        </p>
      </Panel>

      <Panel title={`All lots across orders · ${rows.length}`}>
        {rows.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No lots yet.</div> : (
          <div className="space-y-2">
            {rows.map((r) => {
              const p = lotTestProgress(r);
              const rep = currentReport(r);
              const pct = p.total ? Math.round((p.settled / p.total) * 100) : 0;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <Link href={`/fulfilment/testing/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link>
                      <span className="text-faint">·</span> <span className="font-mono text-xs">{r.orderLineMpn}</span>
                      <span className="text-faint">·</span> {r.lotCode}
                      {p.far > 0 && <Pill tone="warn"><AlertTriangle className="h-3 w-3" /> {p.far} F.A.R.</Pill>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.lab ?? "—"} · WO {r.workOrderNo ?? "—"} · {p.total ? `${p.settled}/${p.total} tests passed` : "no tests on file"}
                      {rep ? <> · <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{rep.reportNo} ({rep.conclusion.replace(/_/g, " ").toLowerCase()})</span></> : " · report not available"}
                    </div>
                    {p.total > 0 && <div className="mt-1.5 max-w-xs"><Progress value={pct} /></div>}
                  </div>
                  {/* where the lot sits at the lab — the question the board is usually opened for */}
                  <TestingStageBar lot={r} className="w-52" />
                  <StatusPill status={r.testStatus} />
                  <div className="flex gap-1">
                    {(["PASS", "MAYBE", "FAIL"] as const).map((st) => (
                      <button key={st} onClick={() => setLotStatus(r.orderId, r.id, st)}
                        className={cn("rounded-md border px-2 py-1 text-xs font-medium hover:border-primary", r.testStatus === st && "border-primary bg-accent-soft text-primary")}>{st}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
