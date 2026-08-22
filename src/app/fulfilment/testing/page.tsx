"use client";

// THE TESTING BOARD — every order with testing, worst first.
//
// Built to the same pattern as the Logistics queue (`lib/logistics-order.ts` +
// `logistics/page.tsx`): a derived per-order view, mutually-exclusive pipeline buckets
// as filter chips with live counts, one search box, one paginated table where the whole
// row is the link, and an "action to perform" column that says the next thing to do
// instead of making the reader infer it. Two desks, one idiom.
//
// Five buckets — Failed / In progress / Booked — not started / Completed / Passed. They
// answer "how far along is it, and how did it come out"; what KIND of attention an order
// wants is the row's own pills, its action sentence and its accent colour, not a filter
// (see lib/testing-queue.ts).
//
// ONE section: the order queue. A second "Lots at the lab" table across every order was
// tried and removed (2026-08-21) — the lots of an order are on that order's own workspace,
// and a cross-order lot list is a different screen's job, not a tail on this one.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, MailQuestion, Lock, Receipt } from "lucide-react";
import { useStore } from "@/store/store";
import { unmatchedEmails, labFeeOutstandingTotal, pendingTestSlot } from "@/store/selectors";
import {
  testingView, nextTestingAction, sortTestingQueue,
  TESTING_PRESSURE_META, TESTING_PRESSURE_ORDER, type TestingPressure, type TestingView,
} from "@/lib/testing-queue";
import type { OrderBundle } from "@/types";
import {
  DataTable, PageHeader, Pagination, Panel, Pill, Progress, RoleLocked, type Col,
} from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { TestingStageBar } from "@/components/order/testing-stages";
import { useRole } from "@/lib/role";
import { cn } from "@/lib/utils";

const ORDER_PAGE_SIZE = 10;

interface OrderRow { b: OrderBundle; view: TestingView }

export default function TestingPage() {
  const orders = useStore((s) => s.orders);
  const { canAccessTesting } = useRole();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [pressure, setPressure] = useState<TestingPressure | "ALL">("ALL");
  const [page, setPage] = useState(1);

  // ---- orders: only those with something to test, worst first ----
  const rows = useMemo<OrderRow[]>(() => {
    const all = Object.values(orders)
      .filter((b) => b.status !== "CANCELLED")
      .filter((b) => b.lots.length > 0 || b.lines.some((l) => l.testingMode !== "NONE"))
      .map((b) => ({ b, view: testingView(b) }));
    return sortTestingQueue(all);
  }, [orders]);

  const counts = useMemo(() => {
    const c: Record<TestingPressure, number> = { FAILED: 0, IN_PROGRESS: 0, BOOKED: 0, COMPLETED: 0, PASSED: 0 };
    for (const r of rows) c[r.view.pressure]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (pressure !== "ALL" && r.view.pressure !== pressure) return false;
      if (!needle) return true;
      const hay = `${r.b.orderNo} ${r.b.buyer.name} ${r.b.supplier.name} ${r.b.lots.map((l) => `${l.lotCode} ${l.orderLineMpn} ${l.workOrderNo ?? ""}`).join(" ")}`;
      return hay.toLowerCase().includes(needle);
    });
  }, [rows, q, pressure]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ORDER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * ORDER_PAGE_SIZE, safePage * ORDER_PAGE_SIZE);

  // board-wide facts that aren't order buckets — mail nobody filed, money the lab is owed
  const unmatchedAll = useMemo(
    () => Object.values(orders).flatMap((b) => unmatchedEmails(b).map((m) => ({ ...m, orderId: b.id, orderNo: b.orderNo }))),
    [orders],
  );
  const feeAll = useMemo(() => {
    const per = Object.values(orders).map((b) => labFeeOutstandingTotal(b));
    return {
      count: per.reduce((a, f) => a + f.count, 0),
      gross: per.reduce((a, f) => a + f.gross, 0),
      currency: per.find((f) => f.count > 0)?.currency ?? "USD",
      held: per.flatMap((f) => f.blocking),
    };
  }, [orders]);

  if (!canAccessTesting) {
    return (
      <div className="space-y-5">
        <PageHeader title="Testing" description="WHL testing — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="view or act on testing" /></Panel>
      </div>
    );
  }

  const orderCols: Col<OrderRow>[] = [
    {
      key: "order",
      header: "Order",
      render: (r) => (
        <div>
          <div className="font-mono text-[13px] font-semibold">{r.b.orderNo}</div>
          <div className="text-[11px] text-muted-foreground">{r.b.supplier.name} → {r.view.slowestLotCode ? (r.b.lots.find((l) => l.lotCode === r.view.slowestLotCode)?.lab ?? "lab") : "lab"}</div>
        </div>
      ),
    },
    {
      key: "tests",
      header: "Tests passed",
      render: (r) => (
        <div className="min-w-[7.5rem]">
          <div className="text-sm font-semibold tnum">
            {r.view.tests ? `${r.view.passed}/${r.view.tests}` : <span className="text-xs font-normal text-faint">no tests on file</span>}
          </div>
          {r.view.tests > 0 && <div className="mt-1"><Progress value={r.view.pct} /></div>}
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {r.view.lots} test lot{r.view.lots === 1 ? "" : "s"} · {r.view.reports} report{r.view.reports === 1 ? "" : "s"}
          </div>
        </div>
      ),
    },
    {
      key: "stage",
      header: "Slowest test lot",
      render: (r) => r.view.slowestStage ? (
        <div className="min-w-[13rem]">
          <div className="text-[11px] font-medium">{r.view.slowestLotCode}</div>
          <TestingStageBar lot={r.b.lots.find((l) => l.lotCode === r.view.slowestLotCode)!} className="mt-0.5 w-full" />
        </div>
      ) : <span className="text-xs text-faint">No test lot raised</span>,
    },
    {
      key: "fee",
      header: "Lab fee",
      render: (r) => r.view.held.length > 0
        ? <Pill tone="bad"><Lock className="h-3 w-3" /> {r.view.held.length} held</Pill>
        : r.view.feeCount > 0
          ? <Pill tone="warn"><Receipt className="h-3 w-3" /> {r.view.feeCurrency} {r.view.feeGross.toLocaleString()}</Pill>
          : <span className="text-xs text-faint">none due</span>,
    },
    {
      key: "book",
      header: "Test slot",
      // Read-only: booking a slot moved inside the order (2026-08-22), where the MPN lines it is
      // booked against actually live. A button here could only ever book "something on this order",
      // which is not a booking anyone can fill in from a queue row.
      render: (r) => {
        const pending = pendingTestSlot(r.b);
        if (pending) {
          return (
            <span className="inline-flex flex-col gap-0.5">
              <Pill tone="warn" title={`Requested ${pending.requestedAt} from ${pending.lab}. The lab's confirmation is what creates the test lots.`}>
                {pending.slotNo} awaiting
              </Pill>
              <span className="text-[10px] text-faint">check mail to confirm</span>
            </span>
          );
        }
        const slots = r.b.testSlots ?? [];
        if (slots.length === 0) return <span className="text-xs text-faint">not booked</span>;
        const latest = slots[0];
        return (
          <span className="inline-flex flex-col gap-0.5">
            <span className="font-mono text-xs">{latest.slotNo}</span>
            <span className="text-[10px] text-faint">
              {slots.length > 1 ? `${slots.length} slots · ` : ""}{latest.appointmentNo ?? "confirmed"}
            </span>
          </span>
        );
      },
    },
    {
      key: "action",
      header: "Action to perform",
      render: (r) => (
        <div className="min-w-[15rem]">
          <span className="inline-flex flex-wrap items-center gap-1">
            <Pill tone={TESTING_PRESSURE_META[r.view.pressure].tone} title={TESTING_PRESSURE_META[r.view.pressure].what}>
              {TESTING_PRESSURE_META[r.view.pressure].label}
            </Pill>
            {r.view.unmatched > 0 && <Pill tone="warn"><MailQuestion className="h-3 w-3" /> {r.view.unmatched}</Pill>}
            {r.view.far > 0 && <Pill tone="warn">{r.view.far} F.A.R.</Pill>}
            {r.view.failed > 0 && <Pill tone="bad">{r.view.failed} not acc.</Pill>}
            {r.view.atRisk && <Pill tone="bad" title={r.view.atRisk.reason}>behind clock</Pill>}
          </span>
          <div className="mt-1 text-xs text-muted-foreground">{nextTestingAction(r.b, r.view)}</div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Testing"
        description="Worst first: a failed lot needs a decision now, then the orders still running with the most on them. Click an order to work its testing — WHL mail, reports, lab fees, lifecycle and verdicts."
      />

      {/* Board-wide facts that aren't per-order buckets, so they'd be invisible in the table. */}
      {(unmatchedAll.length > 0 || feeAll.count > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {unmatchedAll.length > 0 && (
            <div className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg p-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-warn">
                <MailQuestion className="h-4 w-4" /> {unmatchedAll.length} WHL email{unmatchedAll.length === 1 ? "" : "s"} await matching
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {Array.from(new Set(unmatchedAll.map((m) => m.orderId))).map((oid) => (
                  <Link key={oid} href={`/fulfilment/testing/${oid}`} className="font-mono text-primary hover:underline">
                    {orders[oid]?.orderNo}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {feeAll.count > 0 && (
            <div className={cn("rounded-[var(--radius)] border p-3",
              feeAll.held.length > 0
                ? "border-[color-mix(in_srgb,var(--bad)_40%,transparent)] bg-bad-bg"
                : "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg")}>
              <div className={cn("flex items-center gap-1.5 text-sm font-semibold", feeAll.held.length > 0 ? "text-bad" : "text-warn")}>
                {feeAll.held.length > 0 ? <Lock className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
                {feeAll.currency} {feeAll.gross.toLocaleString()} owed to WHL across {feeAll.count} invoice{feeAll.count === 1 ? "" : "s"}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {feeAll.held.length > 0
                  ? <>On advance terms, so <b className="text-bad">{feeAll.held.join(", ")}</b> are held off the bench until paid.</>
                  : "All on credit terms — owed, but nothing is blocked."}{" "}
                Finance settles these on the <Link href="/fulfilment/payments?tab=whl" className="text-primary hover:underline">Payments board</Link>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---------- section 1 · pick an order ---------- */}
      <Panel title={`Orders with testing · ${filtered.length}`}>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <FilterChip label="All" count={rows.length} active={pressure === "ALL"} onClick={() => { setPressure("ALL"); setPage(1); }} />
          {TESTING_PRESSURE_ORDER.map((p) => (
            <FilterChip key={p} label={TESTING_PRESSURE_META[p].label} count={counts[p]}
              tone={TESTING_PRESSURE_META[p].tone} title={TESTING_PRESSURE_META[p].what}
              active={pressure === p}
              onClick={() => { setPressure(pressure === p ? "ALL" : p); setPage(1); }} />
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Order, party, test lot, MPN, WO…" className="w-64 pl-8" />
          </div>
        </div>

        <DataTable<OrderRow>
          columns={orderCols} rows={pageRows}
          empty={q || pressure !== "ALL" ? "Nothing matches that filter." : "No order has a testable line yet."}
          onRowClick={(r) => router.push(`/fulfilment/testing/${r.b.id}`)}
          /* a clean pass is terminal and good — dim it so the live work reads first */
          rowMuted={(r) => r.view.pressure === "PASSED"}
          /* the buckets no longer name the problem, so the accent reads the signals directly:
             a lot the lab is holding or a phase behind its clock is red, anything else that
             wants a human is amber */
          rowAccent={(r) => r.view.pressure === "FAILED" || r.view.held.length > 0 || r.view.atRisk ? "bad"
            : r.view.attention > 0 ? "warn" : undefined}
        />

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {filtered.length} order{filtered.length === 1 ? "" : "s"}
            {filtered.length > ORDER_PAGE_SIZE ? ` · showing ${(safePage - 1) * ORDER_PAGE_SIZE + 1}–${Math.min(safePage * ORDER_PAGE_SIZE, filtered.length)}` : ""}
            {" · "}opening one gives the full testing workspace, the same screen as that order&apos;s Testing tab
          </p>
          <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
        </div>
      </Panel>

    </div>
  );
}

function FilterChip({
  label, count, active, onClick, tone, title,
}: { label: string; count: number; active: boolean; onClick: () => void; tone?: string; title?: string }) {
  return (
    <button onClick={onClick} title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
        active ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
      )}>
      {label}
      <span className={cn("rounded-full px-1.5 text-[10px] font-semibold",
        tone === "bad" && count > 0 ? "bg-bad-bg text-bad"
          : tone === "warn" && count > 0 ? "bg-warn-bg text-warn"
          : tone === "ok" && count > 0 ? "bg-ok-bg text-ok"
          : "bg-muted text-muted-foreground")}>
        {count}
      </span>
    </button>
  );
}
