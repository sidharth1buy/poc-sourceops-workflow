"use client";

// THE TESTING BOARD — every submission at the lab, worst first.
//
// ONE ROW IS ONE MPN'S TEST SLOT, not an order (redesigned 2026-08-24). The lab does not
// test orders: it tests one part's samples against one work order, and every record we
// keep — lifecycle stage, verdict, report revisions, its own invoice — already hangs off
// that submission. While rows were orders, a cell had to merge several of them ("2 test
// slots · 1 failed") and the reader still had to open the order to learn WHICH part
// failed. Now the row says it, and the party columns (order no / buyer / supplier) put
// the submission in context without a second lookup.
//
// The five buckets are unchanged — Failed / In progress / Not booked / Completed /
// Passed — but they now judge a submission rather than an order, so the chip counts sum
// to the number of test slots. A testable MPN with nothing booked still gets a row: that
// is the whole point of `Not booked`, and a list of only-booked work could never answer
// "which of my parts is not at the lab yet".
//
// Two cuts of the same rows: the flat list (default, worst first across every order) and
// `Group by order`, which stacks an order's submissions under one header — the same
// two-views-one-dataset shape the Payments board uses. In the grouped cut the party
// columns are dropped, because the header already names them.
//
// Board-wide attention cards stay: unmatched WHL mail belongs to no lot by definition
// (that is what makes it unmatched), and money owed across orders is a Finance-shaped
// fact, so neither could ever live on a row.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search, MailQuestion, Lock, Receipt, ChevronDown, ChevronRight, Layers, List, CalendarPlus,
  RotateCcw, type LucideIcon,
} from "lucide-react";
import { useStore } from "@/store/store";
import { unmatchedEmails, labFeeOutstandingTotal, pendingTestSlot } from "@/store/selectors";
import { BookTestSlotModal } from "@/components/order/modals";
import {
  testingSlotRows, slotStatusLine, sortSlotRows, testingView, nextTestingAction, pressureMatches,
  TESTING_PRESSURE_META, TESTING_PRESSURE_ORDER, type TestingPressure, type TestingSlotRow,
} from "@/lib/testing-queue";
import { TESTING_STAGE_META, TEST_SLOT_LABEL, TEST_SLOT_TONE } from "@/data/enums";
import type { OrderBundle } from "@/types";
import {
  Button, DataTable, PageHeader, Pagination, Panel, Pill, RoleLocked, type Col,
} from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { useRole } from "@/lib/role";
import { cn } from "@/lib/utils";

const SLOT_PAGE_SIZE = 20;
const ORDER_PAGE_SIZE = 8;

type BoardView = "flat" | "byOrder";

/**
 * Where a row's click lands: the workspace, scoped to this one submission.
 *
 * `mpn` goes on **every** link, not just as a fallback. A row with nothing booked has no lot and no
 * slot to point at, so before this it opened the whole order — the one case where the reader had
 * clicked a single part and got the part list. The part is the thing that was clicked, so it is
 * always in the URL; `lot`/`slot` narrow it further when they exist.
 */
function rowHref(r: TestingSlotRow) {
  const q = new URLSearchParams({ mpn: r.mpn });
  if (r.lotId) q.set("lot", r.lotId);
  else if (r.slotId) q.set("slot", r.slotId);
  return `/fulfilment/testing/${r.orderId}?${q.toString()}`;
}

export default function TestingPage() {
  const orders = useStore((s) => s.orders);
  const { canAccessTesting, canEditTests } = useRole();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [pressure, setPressure] = useState<TestingPressure | "ALL">("ALL");
  const [view, setView] = useState<BoardView>("flat");
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /**
   * The booking the board is opening: an order, optionally the part that was clicked, optionally
   * the failed slot being re-run. Booking used to be order-only and reachable **only** from inside
   * the order (the per-line buttons were removed 2026-08-24 as a second way in with nothing to
   * add); it came back the same day at the board's request, and it earns its place here for a
   * reason the old per-line buttons did not have: a row IS one MPN, so the button knows which part
   * it is booking — it is not "book something on this order" with a form to fill in from scratch.
   */
  const [book, setBook] = useState<{ orderId: string; mpn?: string; retestOfSlotId?: string } | null>(null);

  // ---- one row per submission, across every live order, worst first ----
  const rows = useMemo(
    () => sortSlotRows(
      Object.values(orders)
        .filter((b) => b.status !== "CANCELLED")
        .flatMap((b) => testingSlotRows(b)),
    ),
    [orders],
  );

  // per chip, not per bucket — `Completed` counts finished submissions whichever way they came out,
  // so these no longer sum to All (see `pressureMatches`)
  const counts = useMemo(() => {
    const c: Record<TestingPressure, number> = { FAILED: 0, IN_PROGRESS: 0, NOT_BOOKED: 0, COMPLETED: 0, PASSED: 0 };
    for (const r of rows) for (const p of TESTING_PRESSURE_ORDER) if (pressureMatches(p, r.pressure)) c[p]++;
    return c;
  }, [rows]);

  /** One predicate, both cuts — the grouped view is a different shape of the same rows. */
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (pressure !== "ALL" && !pressureMatches(pressure, r.pressure)) return false;
      if (!needle) return true;
      const hay = `${r.orderNo} ${r.supplierPoNo ?? ""} ${r.buyer} ${r.supplier} ${r.mpn} ${r.make ?? ""} ${r.slotNo ?? ""} ${r.lotCode ?? ""} ${r.workOrderNo ?? ""} ${r.lab ?? ""} ${r.invoiceNo ?? ""}`;
      return hay.toLowerCase().includes(needle);
    });
  }, [rows, q, pressure]);

  // grouped cut: an order's submissions under one header, worst order first (the rows are
  // already sorted, so first-seen order is worst-first)
  const groups = useMemo(() => {
    const by = new Map<string, TestingSlotRow[]>();
    for (const r of filtered) {
      const list = by.get(r.orderId);
      if (list) list.push(r); else by.set(r.orderId, [r]);
    }
    return Array.from(by.entries()).map(([orderId, list]) => ({ orderId, rows: list }));
  }, [filtered]);

  const flatPages = Math.max(1, Math.ceil(filtered.length / SLOT_PAGE_SIZE));
  const groupPages = Math.max(1, Math.ceil(groups.length / ORDER_PAGE_SIZE));
  const totalPages = view === "flat" ? flatPages : groupPages;
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * SLOT_PAGE_SIZE, safePage * SLOT_PAGE_SIZE);
  const pageGroups = groups.slice((safePage - 1) * ORDER_PAGE_SIZE, safePage * ORDER_PAGE_SIZE);

  // board-wide facts that belong to no submission — mail nobody filed, money the lab is owed
  const unmatchedAll = useMemo(
    () => Object.values(orders).flatMap((b) => unmatchedEmails(b).map((m) => ({ ...m, orderId: b.id, orderNo: b.orderNo }))),
    [orders],
  );
  const feeAll = useMemo(() => {
    const per = Object.values(orders).map((b) => ({ b, f: labFeeOutstandingTotal(b) }));
    return {
      count: per.reduce((a, x) => a + x.f.count, 0),
      gross: per.reduce((a, x) => a + x.f.gross, 0),
      currency: per.find((x) => x.f.count > 0)?.f.currency ?? "USD",
      held: per.flatMap((x) => x.f.blocking),
      orders: per.filter((x) => x.f.count > 0).map((x) => x.b),
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

  // ---- columns. `partyCols` carries the order context; the grouped cut drops all three
  //      because its header already says them. ----
  const partyCols: Col<TestingSlotRow>[] = [
    {
      key: "order",
      header: "Order no",
      /*
       * Just the order no — the supplier PO number sat under it for a while and cost the table more
       * width than the whole Lab-fee-due column, for a reference nobody scans a lab queue by.
       *
       * It is a **link, and it deliberately goes somewhere else than the row** (2026-08-24): the row
       * opens the one submission that was clicked, the order number opens the whole order — every
       * part, every test slot, the full mail history. Two questions, two targets, and the number is
       * the obvious place for the second.
       */
      render: (r) => (
        <Link href={`/fulfilment/testing/${r.orderId}`} onClick={(e) => e.stopPropagation()}
          title="Open the whole order — every part, every test slot and the full mail history"
          className="whitespace-nowrap font-mono text-xs font-semibold text-primary hover:underline">
          {r.orderNo}
        </Link>
      ),
    },
    { key: "buyer", header: "Buyer", render: (r) => <div className="max-w-[9rem] text-xs">{r.buyer}</div> },
    { key: "supplier", header: "Supplier", render: (r) => <div className="max-w-[9rem] text-xs">{r.supplier}</div> },
  ];

  const slotCols: Col<TestingSlotRow>[] = [
    {
      // the part, set in the plain UI face — a part number reads as a name here, not as an
      // identifier to spell out character by character
      key: "mpn",
      header: "MPN",
      render: (r) => (
        <div className="min-w-[7rem]">
          <div className="whitespace-nowrap text-xs font-semibold text-foreground">{r.mpn}</div>
          {r.make && <div className="text-[10px] text-faint">{r.make}</div>}
        </div>
      ),
    },
    {
      /*
       * Its own column since 2026-08-24 (it was a sub-line under the slot no). The lot code and
       * its work order are the two references the lab, its invoices and its reports all quote, so
       * they are what an operator matches a mail or a bill against — that is a column's job, not a
       * caption's. The sample figure lives here too rather than under the MPN: the lab pulls a
       * sample per LOT, so "20 of 150" is this submission's fact, not the part's.
       */
      key: "lot",
      header: "Lot code",
      render: (r) => {
        if (!r.lotCode) {
          return (
            <span className="text-[11px] text-faint">
              {r.slotId ? "with the confirmation" : "—"}
            </span>
          );
        }
        return (
          <div className="min-w-[7rem]">
            <div className="whitespace-nowrap font-mono text-xs font-semibold">{r.lotCode}</div>
            <div className="text-[10px] text-faint">
              {r.workOrderNo ? `WO ${r.workOrderNo}` : "no work order yet"}
              {r.sampleQty != null && r.qty != null ? ` · ${r.sampleQty}/${r.qty}` : ""}
            </div>
          </div>
        );
      },
    },
    {
      /*
       * This submission's own references — and the control that books one.
       *
       * The booking button lives HERE rather than in a column of its own: booking is what this
       * column is about (an unbooked row's whole content is "not booked"), and a trailing `Book`
       * column put the one control the row offers past the right edge of the viewport, where it
       * needed a horizontal scroll to reach. A row is one MPN, so the button knows the part and
       * the modal opens with it already picked (`presetMpn`) — which is exactly what the per-line
       * buttons removed from the workspace on 2026-08-24 could not do.
       *
       * **Two acts, not three** (2026-08-25): nothing booked ⇒ `Book test` for this part; a FAIL
       * nobody has re-run ⇒ a **re-test** of that slot (`retestOfSlotId`, so the lab is cited its
       * own appointment and work orders). A slot that is *in progress* gets **no booking control at
       * all** — the quiet `Book again` that used to sit there offered to open a second submission
       * for a part the lab is still working on, which is a bill for nothing and reads as if the
       * first one needed replacing. A genuine second submission for the same part is still
       * bookable, from the grouped view's order-level `Book test slot`, where picking the MPN is a
       * deliberate act rather than a button next to a running test.
       *
       * `pendingTestSlot` blocks both: while the lab has not answered there are no work orders to
       * act on and the desk books one at a time. Same rule as the workspace.
       */
      key: "slot",
      header: "Test slot",
      render: (r) => {
        const ob = orders[r.orderId];
        const pending = ob ? pendingTestSlot(ob) : undefined;
        const retest = !!r.slotId && r.verdict === "FAIL" && !r.rebooked;
        // nothing to offer on a slot that is simply running: see the note above
        const canBook = !r.slotId || retest;
        const bookBtn = !canBook
          ? null
          : !canEditTests
            ? <span className="inline-flex items-center gap-1 text-[10px] text-faint"><Lock className="h-3 w-3" /> SC only</span>
            : pending
              ? <span className="text-[10px] text-faint" title={`${pending.slotNo} is still with ${pending.lab} — the desk books one at a time.`}>
                  awaiting {pending.slotNo}&apos;s reply
                </span>
              : (
                <Button variant="outline" className="whitespace-nowrap px-2 py-0.5 text-[11px]"
                  title={retest
                    ? `Re-run ${r.mpn} — cites the lab its own appointment and work orders for ${r.slotNo}`
                    : `Ask the lab for a test slot for ${r.mpn}`}
                  onClick={(e) => {
                    e.stopPropagation();   // the whole row is a link into the slot's workspace
                    setBook({ orderId: r.orderId, mpn: r.mpn, retestOfSlotId: retest ? r.slotId : undefined });
                  }}>
                  {retest ? <><RotateCcw className="h-3 w-3" /> Re-test</> : <><CalendarPlus className="h-3 w-3" /> Book test</>}
                </Button>
              );

        if (!r.slotId) {
          return (
            <div className="min-w-[8rem] space-y-1">
              <div className="text-[10px] text-faint">not booked · {r.testingMode} testing required</div>
              {bookBtn}
            </div>
          );
        }
        return (
          <div className="min-w-[8rem] space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold">{r.slotNo}</span>
              {r.isRetest && <Pill tone="warn">re-test of {r.retestOfSlotNo}</Pill>}
              {r.slotStatus && r.slotStatus !== "CONFIRMED"
                ? <Pill tone={TEST_SLOT_TONE[r.slotStatus]}>{TEST_SLOT_LABEL[r.slotStatus]}</Pill>
                : null}
            </div>
            <div className="text-[10px] text-faint">{r.lab ?? "lab not named"}</div>
            {bookBtn}
          </div>
        );
      },
    },
    {
      // the cost of THIS submission: the lab bills per work order, so a row is one invoice
      key: "fee",
      header: "Lab fee",
      render: (r) => {
        if (r.feeBilled > 0) {
          return (
            <span className="inline-flex flex-col gap-0.5">
              <span className="tnum text-xs font-semibold">{r.feeCurrency} {r.feeBilled.toLocaleString()}</span>
              {/* terms are only called out when they are the ones that can hold a lot — CREDIT
                  changes nothing about how this row is read, and the due column says the rest */}
              <span className="text-[10px] text-faint">
                {r.invoiceNo ?? "invoice on file"}{r.labTerms === "ADVANCE" ? " · advance" : ""}
              </span>
            </span>
          );
        }
        // the lab bills after it issues the report, so "no invoice yet" is the normal state for
        // most of a lot's life — and it is not the same as owing nothing. The pill says that on its
        // own; the "bills after report" line under it was explaining the pill to a reader who had
        // already understood it, on every unbilled row.
        return r.feeAwaiting
          ? <Pill tone="info" title="The lab bills after it issues the report, so no invoice exists yet — that is not the same as owing nothing."><Receipt className="h-3 w-3" /> awaiting</Pill>
          : <span className="text-xs text-faint">none due</span>;
      },
    },
    {
      /*
       * **A dash, never a zero, while no invoice has arrived** — the amount is unknown, not nil, and
       * a `0` there would read as "nothing to pay". It briefly repeated the cost column's `awaiting`
       * pill instead; two identical cells side by side spent the column on a state the column to its
       * left already reported, so the dash is back and the pill stays in one place.
       */
      key: "feeDue",
      header: "Lab fee due",
      render: (r) => {
        if (r.feeBilled === 0) return <span className="text-xs text-faint">—</span>;
        if (r.feeDue === 0) {
          return (
            <span className="inline-flex flex-col gap-0.5">
              <Pill tone="ok">settled</Pill>
              <span className="text-[10px] text-faint">nothing owed</span>
            </span>
          );
        }
        return (
          <span className="inline-flex flex-col gap-0.5">
            {r.held
              ? <Pill tone="bad"><Lock className="h-3 w-3" /> {r.feeCurrency} {r.feeDue.toLocaleString()}</Pill>
              : <Pill tone="warn"><Receipt className="h-3 w-3" /> {r.feeCurrency} {r.feeDue.toLocaleString()}</Pill>}
            <span className="text-[10px] text-faint">
              {r.held ? "advance — lot held" : r.feeToSend ? "not with Finance yet" : "with Finance"}
            </span>
          </span>
        );
      },
    },
    {
      // renamed from "Action to perform" (2026-08-24): at slot altitude most rows are
      // reporting where the submission has got to, and only some are asking for something
      key: "status",
      header: "Status / updates",
      render: (r) => (
        <div className="min-w-[12rem]">
          <span className="inline-flex flex-wrap items-center gap-1">
            <Pill tone={TESTING_PRESSURE_META[r.pressure].tone} title={TESTING_PRESSURE_META[r.pressure].what}>
              {TESTING_PRESSURE_META[r.pressure].label}
            </Pill>
            {r.stage && <Pill tone="neutral">{TESTING_STAGE_META[r.stage].label}</Pill>}
            {r.verdict === "MAYBE" && <Pill tone="warn">F.A.R. follow-up</Pill>}
            {r.atRisk && <Pill tone="bad" title={r.atRisk.reason}>behind clock</Pill>}
          </span>
          <div className="mt-1 text-xs text-muted-foreground">{slotStatusLine(r)}</div>
          {r.tests > 0 && (
            <div className="mt-0.5 text-[10px] text-faint">
              {r.passed}/{r.tests} tests passed{r.open > 0 ? ` · ${r.open} open` : ""}{r.far > 0 ? ` · ${r.far} F.A.R.` : ""}
              {r.reports > 0 ? ` · ${r.reports} report${r.reports === 1 ? "" : "s"}` : ""}
            </div>
          )}
        </div>
      ),
    },
  ];

  /*
   * The part comes first (2026-08-24). A row is one MPN's submission, so `MPN` + `Lot code` are
   * its identity and everything after them is context: which order it belongs to, who is waiting
   * on it, where it is. Reading order no first made the table look order-shaped again, which is
   * exactly what the per-slot redesign moved away from.
   */
  const flatCols = [slotCols[0], slotCols[1], ...partyCols, ...slotCols.slice(2)];
  /*
   * The row's colour IS its bucket (2026-08-25) — red failed · amber in progress or finished-but-not-
   * clean · green passed · plain white not booked. It used to tint only rows that wanted a human,
   * which left a passed slot and an unbooked one looking identical (both plain) even though one is
   * finished and the other has not started. Reading the chip row and then the table now gives the
   * same five states in the same five colours.
   *
   * Two things stay out of it deliberately: `atRisk` (the order's phase clock — it would paint every
   * row of that order, passed ones included, and it has its own pill), and `rowMuted`, which dimmed
   * passed rows. Green already says "done and good", and grey text on a green ground just reads
   * muddy; the sort puts passed last regardless, which is what the dimming was really for.
   */
  const rowAccent = (r: TestingSlotRow) =>
    // a lot the lab is holding over an unpaid advance is red whatever bucket it sits in
    r.pressure === "FAILED" || r.held ? "bad" as const
      : r.pressure === "PASSED" ? "ok" as const
        : r.pressure === "IN_PROGRESS" || r.pressure === "COMPLETED" ? "warn" as const
          : undefined;   // NOT_BOOKED — nothing has happened yet, so no colour claims otherwise

  return (
    <div className="space-y-4">
      <PageHeader
        title="Testing"
        description="One row per test slot — the part, its work order, its report and its own lab fee. Worst first: a failed submission needs a decision now. Click a row to work that slot's journey."
      />

      {/* Board-wide facts that belong to no submission, so they'd be invisible in the table. */}
      {(unmatchedAll.length > 0 || feeAll.count > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* The card IS the door to the queue (2026-08-25): the whole card is a link to the WHL
              inbox screen, which lists every unmatched mail against every test slot on every
              order. It used to link out per order — which put the reader on a screen that could
              only offer that order's lots, and an unroutable mail is exactly the one whose order
              cannot be trusted. */}
          {unmatchedAll.length > 0 && (
            <Link href="/fulfilment/testing/inbox"
              className="block rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg p-3 transition hover:brightness-[0.98]">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-warn">
                <MailQuestion className="h-4 w-4" /> {unmatchedAll.length} WHL email{unmatchedAll.length === 1 ? "" : "s"} await matching
                <span className="ml-auto text-xs font-medium text-primary">open the WHL inbox →</span>
              </div>
              {/* No order numbers (2026-08-25). They were the thread the mail happened to land on,
                  which is the very thing in doubt — an unroutable mail is one WHL filed against the
                  wrong client PO as often as not, so printing an order here invited the reader to
                  assume the answer before opening the queue that exists to determine it. */}
              <p className="mt-1 text-xs text-muted-foreground">
                Unmatched mail belongs to no test slot yet — that is what makes it unmatched — so which order it
                belongs to is part of what the inbox is for. File it there, against any slot on any order.
              </p>
            </Link>
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
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {feeAll.orders.map((o) => (
                  <Link key={o.id} href={`/fulfilment/testing/${o.id}`} className="font-mono text-primary hover:underline">
                    {o.orderNo}
                  </Link>
                ))}
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

      {/* ---------- the queue: one row per submission, flat or grouped by order ---------- */}
      <Panel title={`Test slots · ${filtered.length}`}>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <FilterChip label="All" count={rows.length} active={pressure === "ALL"} onClick={() => { setPressure("ALL"); setPage(1); }} />
          {TESTING_PRESSURE_ORDER.map((p) => (
            <FilterChip key={p} label={TESTING_PRESSURE_META[p].label} count={counts[p]}
              tone={TESTING_PRESSURE_META[p].tone} title={TESTING_PRESSURE_META[p].what}
              active={pressure === p}
              onClick={() => { setPressure(pressure === p ? "ALL" : p); setPage(1); }} />
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* two cuts of the same rows — the same segmented control the rest of the console uses */}
            <div className="inline-flex items-center gap-1 rounded-lg border bg-background p-0.5">
              <ViewTab active={view === "flat"} onClick={() => { setView("flat"); setPage(1); }}
                icon={List} label="All test slots" title="Every submission across every order, worst first" />
              <ViewTab active={view === "byOrder"} onClick={() => { setView("byOrder"); setPage(1); }}
                icon={Layers} label="Group by order" title="Stack each order's test slots under one header" />
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Order, party, MPN, test slot, WO…" className="w-64 pl-8" />
            </div>
          </div>
        </div>

        {view === "flat" ? (
          <DataTable<TestingSlotRow>
            columns={flatCols} rows={pageRows}
            empty={q || pressure !== "ALL" ? "Nothing matches that filter." : "No order has a testable line yet."}
            onRowClick={(r) => router.push(rowHref(r))}
            rowAccent={rowAccent}
          />
        ) : (
          <div className="space-y-3">
            {pageGroups.length === 0 && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {q || pressure !== "ALL" ? "Nothing matches that filter." : "No order has a testable line yet."}
              </div>
            )}
            {pageGroups.map((g) => {
              const b = orders[g.orderId];
              if (!b) return null;
              const open = !collapsed[g.orderId];
              return (
                <OrderGroup key={g.orderId} b={b} rows={g.rows} open={open}
                  onToggle={() => setCollapsed((c) => ({ ...c, [g.orderId]: open }))}
                  cols={slotCols} onRowClick={(r) => router.push(rowHref(r))}
                  rowAccent={rowAccent}
                  canBook={canEditTests} onBook={() => setBook({ orderId: g.orderId })} />
              );
            })}
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {view === "flat"
              ? <>{filtered.length} test slot{filtered.length === 1 ? "" : "s"} across {groups.length} order{groups.length === 1 ? "" : "s"}
                  {filtered.length > SLOT_PAGE_SIZE ? ` · showing ${(safePage - 1) * SLOT_PAGE_SIZE + 1}–${Math.min(safePage * SLOT_PAGE_SIZE, filtered.length)}` : ""}</>
              : <>{groups.length} order{groups.length === 1 ? "" : "s"} · {filtered.length} test slot{filtered.length === 1 ? "" : "s"} between them</>}
            {" · "}opening a row gives that slot&apos;s own journey; widen it to the whole order from inside
          </p>
          <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
        </div>
      </Panel>

      {book && (
        <BookTestSlotModal orderId={book.orderId} presetMpn={book.mpn}
          retestOfSlotId={book.retestOfSlotId} onClose={() => setBook(null)} />
      )}
    </div>
  );
}

/**
 * One order's submissions under one header. Same shape as the Payments board's By-order cut:
 * an accent stripe, a collapsible header naming the parties, then the rows with the three
 * party columns dropped — the header just said all of them.
 *
 * The header carries what is genuinely order-level and so has no row of its own: mail nobody
 * has filed yet, and the order's own next-action sentence.
 */
function OrderGroup({
  b, rows, open, onToggle, cols, onRowClick, rowAccent, canBook, onBook,
}: {
  b: OrderBundle;
  rows: TestingSlotRow[];
  open: boolean;
  onToggle: () => void;
  cols: Col<TestingSlotRow>[];
  onRowClick: (r: TestingSlotRow) => void;
  rowAccent: (r: TestingSlotRow) => "bad" | "warn" | "ok" | undefined;
  canBook: boolean;
  onBook: () => void;
}) {
  const view = testingView(b);
  const pending = pendingTestSlot(b);
  const worst = rows.reduce<TestingPressure>((acc, r) =>
    TESTING_PRESSURE_ORDER.indexOf(r.pressure) < TESTING_PRESSURE_ORDER.indexOf(acc) ? r.pressure : acc,
  rows[0]?.pressure ?? "NOT_BOOKED");
  const bad = rows.some((r) => r.pressure === "FAILED" || r.held);
  const busy = rows.some((r) => r.pressure === "IN_PROGRESS" || r.pressure === "COMPLETED");
  const allPassed = rows.length > 0 && rows.every((r) => r.pressure === "PASSED");

  return (
    <div className="flex overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
      {/* the stripe reads like its rows: red if any failed or held, amber while any is running,
          green only when every one of them passed, otherwise nothing is booked yet */}
      <span className={cn("w-1 shrink-0", bad ? "bg-bad" : busy ? "bg-warn" : allPassed ? "bg-ok" : "bg-border")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", open && "border-b bg-card-2/50")}>
          {/* the order number is a link to the whole order, so it cannot live inside the toggle
              button (nesting is invalid); the chevron and the party line are the toggle */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button onClick={onToggle} aria-expanded={open} aria-label={open ? "Collapse this order" : "Expand this order"}
              className="shrink-0 text-muted-foreground hover:text-foreground">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <span className="min-w-0">
              <Link href={`/fulfilment/testing/${b.id}`}
                title="Open the whole order — every part, every test slot and the full mail history"
                className="block font-mono text-sm font-bold tracking-tight text-primary hover:underline">
                {b.orderNo}
              </Link>
              <button onClick={onToggle} className="block max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground">
                {b.buyer.name} <span className="text-faint">→</span> {b.supplier.name}
              </button>
            </span>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={TESTING_PRESSURE_META[worst].tone} title={TESTING_PRESSURE_META[worst].what}>
              {TESTING_PRESSURE_META[worst].label}
            </Pill>
            <Pill tone="neutral">{rows.length} test slot{rows.length === 1 ? "" : "s"}</Pill>
            {view.unmatched > 0 && (
              <Pill tone="warn" title="Inbound lab mail nobody could file — matched on the WHL inbox screen, from the card at the top of this board">
                <MailQuestion className="h-3 w-3" /> {view.unmatched} to match
              </Pill>
            )}
            {/* the order-level booking: the rows book one part each, this one opens the form with
                the order's first testable line and lets the operator add as many MPNs as the
                submission actually carries — one appointment, several parts */}
            {canBook && (pending
              ? <span className="text-[10px] text-faint" title={`${pending.slotNo} is still with ${pending.lab} — the desk books one at a time.`}>
                  awaiting {pending.slotNo}
                </span>
              : <Button variant="outline" className="whitespace-nowrap px-2 py-1 text-[11px]"
                  title="Ask the lab for a test slot on this order — one appointment can carry several parts"
                  onClick={(e) => { e.stopPropagation(); onBook(); }}>
                  <CalendarPlus className="h-3 w-3" /> Book test slot
                </Button>)}
          </span>
        </div>
        {open && (
          <div className="p-4">
            <p className="mb-2 text-xs text-muted-foreground">{nextTestingAction(b, view)}</p>
            <DataTable<TestingSlotRow>
              columns={cols} rows={rows}
              onRowClick={onRowClick} rowAccent={rowAccent}
              empty="No test slot on this order." />
          </div>
        )}
      </div>
    </div>
  );
}

function ViewTab({
  active, onClick, icon: Icon, label, title,
}: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; title: string }) {
  return (
    <button onClick={onClick} title={title} aria-current={active ? "true" : undefined}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
      <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
    </button>
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
