"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, Eye, ExternalLink, FileText,
  FlaskConical, Lock, MailQuestion, Receipt,
} from "lucide-react";
import type { OrderBundle, LabEmail } from "@/types";
import { Panel, Pill, StatusPill, Button, Progress, Notice } from "@/components/ui/primitives";
import {
  testingSummary, lotResults, testAutofillGaps, overdueUpdateRequests, reconciliationAlerts,
  unmatchedEmails, labFeeOutstandingTotal,
} from "@/store/selectors";
import { TestingStageBar } from "@/components/order/testing-stages";
import { LotFeeCell } from "@/components/order/test-tables";
import { LotReadOnlyDetail, MpnRequirements } from "@/components/order/testing-readonly";
import { qtyfmt, cn } from "@/lib/utils";

/**
 * PARKED — nothing renders this right now.
 *
 * It was the order workspace's read-only Testing tab; that tab has gone back to mounting the
 * full acting `TestingTab`, so this is kept only because it may be wanted again. The per-lot
 * renderings it uses live in `testing-readonly.tsx` and are still live on the order-flow
 * page's Testing section, so this file is a shell, not a duplicate. Delete it if the
 * read-only tab isn't coming back.
 *
 * The order workspace's Testing tab: everything the testing module knows about this order,
 * and nothing that changes it. Every control that mails WHL, fetches a report, moves a
 * stage, settles the lab's fee or sets a verdict lives in the Testing workspace
 * (Testing → pick the order → /fulfilment/testing/[orderId]), which renders the full
 * `TestingTab`. Keeping the two apart means an operator reading an order can't nudge the
 * lab thread by accident, and the acting surface stays in one place instead of two.
 *
 * It reuses the same selectors and the same display components as that workspace, so the
 * numbers here are the numbers there — this is a different rendering of one dataset, not
 * a second implementation of it.
 */

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold tnum", color)}>{value}</div>
    </div>
  );
}

export function TestingViewTab({ b, id }: { b: OrderBundle; id: string }) {
  const [open, setOpen] = useState<{ lotId: string } | null>(null);   // expanded lot
  const toggle = (lotId: string) => setOpen((p) => (p?.lotId === lotId ? null : { lotId }));
  const workspace = `/fulfilment/testing/${id}`;

  const sum = testingSummary(b);
  const rows = lotResults(b);
  const fees = labFeeOutstandingTotal(b);
  const alerts = reconciliationAlerts(b);
  const overdue = overdueUpdateRequests(b);
  const gaps = testAutofillGaps(b);
  const unmatched = unmatchedEmails(b);
  const testedPct = sum.tests ? Math.round((sum.passed / sum.tests) * 100) : 0;
  const hasPass = b.lots.some((l) => l.testStatus === "PASS");

  return (
    <div className="space-y-4">
      {/* where to go to actually do something — stated once, at the top */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-primary/40 bg-accent-soft px-4 py-3 text-sm">
        <span className="inline-flex items-start gap-2 text-primary">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>View only.</b> This tab reports where testing stands on {b.orderNo}. Mailing WHL,
            fetching reports, recording dispatch, settling the lab&apos;s fee and setting a lot verdict
            are done in the testing workspace.
          </span>
        </span>
        <Link href={workspace}>
          <Button><FlaskConical className="h-4 w-4" /> Open testing workspace <ExternalLink className="h-3.5 w-3.5" /></Button>
        </Link>
      </div>

      <Panel title="WHL testing — where this order stands">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Lots" value={String(sum.lots)} />
          <Stat label="Tests tracked" value={String(sum.tests)} />
          <Stat label="Passed" value={`${sum.passed}/${sum.tests}`} tone={sum.tests && sum.passed === sum.tests ? "ok" : undefined} />
          <Stat label="F.A.R." value={String(sum.far)} tone={sum.far ? "warn" : undefined} />
          <Stat label="Not acceptable" value={String(sum.failed)} tone={sum.failed ? "bad" : undefined} />
          <Stat label="Reports on file" value={String(sum.reports)} />
        </div>
        <div className="mt-3"><Progress value={testedPct} /></div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {sum.passed}/{sum.tests} required tests passed across {sum.lots} lot(s).
          {sum.open > 0 && ` ${sum.open} still open.`}
          {(sum.far > 0 || sum.notConducted > 0) && " F.A.R. and Not-Conducted results still need follow-up before release."}
        </p>

        {/* the same automatic alerts as the workspace, stated rather than actionable */}
        {(alerts.length > 0 || overdue.length > 0 || gaps.length > 0 || unmatched.length > 0 || fees.count > 0) && (
          <div className="mt-3 space-y-1.5">
            {alerts.map((a, i) => (
              <Notice key={`al-${i}`} tone={a.kind === "MPN" ? "bad" : "warn"} icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
                <b>{a.lotCode} · {a.reportNo}</b> — {a.message}
              </Notice>
            ))}
            {overdue.map((o) => (
              <Notice key={`sla-${o.lot.id}`} tone="warn" icon={<Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
                <b>{o.lot.lotCode}</b> — update requested {o.lot.lastUpdateRequestAt}, unanswered for {o.days} business day(s).
              </Notice>
            ))}
            {gaps.length > 0 && (
              <Notice tone="warn" icon={<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
                Auto-fill failed / incomplete for <b>{gaps.map((g) => g.mpn).join(", ")}</b> — the test list needs manual review.
              </Notice>
            )}
            {unmatched.length > 0 && (
              <Notice tone="info" icon={<MailQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
                {unmatched.length} inbound WHL email(s) couldn&apos;t be matched to a lot — held in the workspace&apos;s match queue.
              </Notice>
            )}
            {fees.blocking.length > 0 && (
              <Notice tone="bad" icon={<Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
                <b>{fees.blocking.join(", ")} held at the lab</b> — invoiced on <b>advance</b>{" "}
                terms and unpaid, so testing hasn&apos;t started.
              </Notice>
            )}
            {fees.count - fees.blocking.length > 0 && (
              <Notice tone="warn" icon={<Receipt className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
                <b>{fees.count} WHL invoice(s) unpaid</b> — {fees.currency} {fees.gross.toLocaleString()} owed to the lab
                {fees.blocking.length > 0 ? ` (incl. the ${fees.blocking.length} held above)` : " on credit terms, so nothing is blocked"}.
              </Notice>
            )}
          </div>
        )}

        {hasPass && b.paymentMode === "ESCROW" && b.escrow && b.escrow.status !== "RELEASED_TO_SELLER" && (
          <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-ok-bg p-2.5 text-sm text-ok">
            A lot PASSED — this satisfies the escrow release condition. The milestone is released from the Escrow tab.
          </p>
        )}
      </Panel>

      <Panel title={`Lots · ${b.lots.length}`}
        actions={<Link href={workspace} className="text-xs font-medium text-primary hover:underline">act on a lot →</Link>}>
        {b.lots.length === 0 ? (
          <Empty text="No lots on this order yet — lots are created in the testing workspace." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-card-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left">Lot</th>
                    <th className="px-3 py-2 text-left">MPN</th>
                    <th className="px-3 py-2 text-left">Verdict</th>
                    <th className="px-3 py-2 text-left">Tests</th>
                    <th className="px-3 py-2 text-left">Lab fee</th>
                    <th className="px-3 py-2 text-left">Current report</th>
                    <th className="px-3 py-2 text-left">Outstanding</th>
                    <th className="px-3 py-2 text-left">Lifecycle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOpen = open?.lotId === r.lot.id;
                    return (
                      <Fragment key={r.lot.id}>
                        <tr onClick={() => toggle(r.lot.id)}
                          title={isOpen ? "Hide this lot's detail" : "Show this lot's lifecycle, tests and reports"}
                          className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/60", isOpen && "bg-accent-soft/60")}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              {r.lot.lotCode}
                            </div>
                            <div className="pl-5 text-[11px] text-faint">{r.lot.lab ?? "—"} · WO {r.lot.workOrderNo ?? "—"} · qty {qtyfmt(r.lot.qty)} / sample {r.lot.sampleQty}</div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{r.lot.orderLineMpn}</td>
                          <td className="px-3 py-2"><StatusPill status={r.lot.testStatus} /></td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="tnum text-xs">{r.progress.settled}/{r.progress.total}</span>
                              <span className="w-20"><Progress value={r.pct} /></span>
                            </div>
                            {(r.progress.far > 0 || r.progress.failed > 0 || r.progress.notConducted > 0) && (
                              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                                {r.progress.far > 0 && <span className="text-warn">{r.progress.far} F.A.R.</span>}
                                {r.progress.failed > 0 && <span className="text-bad">{r.progress.failed} not acc.</span>}
                                {r.progress.notConducted > 0 && <span className="text-faint">{r.progress.notConducted} not cond.</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs"><LotFeeCell lot={r.lot} /></td>
                          <td className="px-3 py-2 text-xs">
                            {r.report ? (
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                <span className="font-mono">{r.report.reportNo}</span>
                                <Pill tone={r.report.conclusion === "ACCEPTABLE" ? "ok" : "bad"}>{r.report.conclusion.replace(/_/g, " ")}</Pill>
                                {r.revisions > 1 && <span className="text-faint">{r.revisions} rev.</span>}
                              </span>
                            ) : <span className="text-warn">not available</span>}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <span className={r.blocker ? "text-warn" : "text-ok"}>{r.blocker ?? "clear"}</span>
                            {r.overdueDays > 0 && <span className="ml-1 text-bad">· chase {r.overdueDays}d overdue</span>}
                            {r.awaiting > 0 && r.overdueDays === 0 && <span className="ml-1 text-muted-foreground">· awaiting reply</span>}
                          </td>
                          <td className="px-3 py-2"><TestingStageBar lot={r.lot} className="w-44" /></td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b bg-card-2/60 last:border-0">
                            <td colSpan={8} className="px-3 py-3">
                              <LotReadOnlyDetail orderId={id} lot={r.lot} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-faint">Click a lot for its lifecycle and its report.</p>
          </>
        )}
      </Panel>

      <Panel title="Test requirements by MPN"><MpnRequirements b={b} /></Panel>
      <MailPanel b={b} workspace={workspace} />
    </div>
  );
}

const MAIL_KIND_LABEL: Partial<Record<LabEmail["kind"], string>> = {
  INVOICE: "invoice", PAYMENT: "payment", DISPATCH: "dispatch", REPORT: "report",
};

const MAIL_KIND_TONE: Record<string, "ok" | "warn" | "info" | "neutral"> = {
  INVOICE: "warn", PAYMENT: "ok", DISPATCH: "info", REPORT: "ok",
};

/** The WHL thread, read. Composing, syncing and matching all happen in the workspace. */
function MailPanel({ b, workspace }: { b: OrderBundle; workspace: string }) {
  const [all, setAll] = useState(false);
  const thread = (b.labEmails ?? []).filter((m) => !!m.lotId);
  const RECENT = 4;
  const visible = all ? thread : thread.slice(0, RECENT);
  const hidden = Math.max(0, thread.length - RECENT);
  const lotCode = (m: LabEmail) => m.lotCode ?? b.lots.find((l) => l.id === m.lotId)?.lotCode;

  return (
    <Panel title="WHL communication"
      actions={<Link href={workspace} className="text-xs font-medium text-primary hover:underline">compose / sync in the workspace →</Link>}>
      {thread.length === 0 ? <Empty text="No communication with WHL yet." /> : (
        <>
          <ol className="space-y-3">
            {visible.map((m) => (
              <li key={m.id} className="flex gap-3">
                <div className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", m.direction === "OUT" ? "bg-primary" : "bg-ok")} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={m.direction === "OUT" ? "info" : "neutral"}>{m.direction === "OUT" ? "sent" : "received"}</Pill>
                    {MAIL_KIND_LABEL[m.kind] && <Pill tone={MAIL_KIND_TONE[m.kind]}>{MAIL_KIND_LABEL[m.kind]}</Pill>}
                    <StatusPill status={m.status} />
                    <span className="text-xs text-faint tnum">{m.at}</span>
                    {lotCode(m) && <span className="text-xs text-muted-foreground">{lotCode(m)}{m.mpn ? <> · <span className="font-mono">{m.mpn}</span></> : null}</span>}
                  </div>
                  <div className="text-sm font-medium">{m.subject}</div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{m.body}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-faint">
                    <span>{m.by}</span>
                    {m.attachments?.length ? <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> {m.attachments.join(", ")}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <button onClick={() => setAll((v) => !v)}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              {all ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {all ? `Hide the earlier ${hidden} message(s)` : `Show ${hidden} earlier message(s)`}
            </button>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        This thread is what drives the lifecycle — the invoice and its terms, the supplier&apos;s dispatch
        advice, receipt confirmations, interim updates, the payment acknowledgement and the report.
        Bodies are clamped here; the full mail, the match queue and the templates are in the workspace.
      </p>
    </Panel>
  );
}
