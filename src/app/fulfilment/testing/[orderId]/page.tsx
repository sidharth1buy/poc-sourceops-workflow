"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, FlaskConical, RotateCcw, Sparkles } from "lucide-react";
import { useStore } from "@/store/store";
import { Button, PageHeader, Panel, Pill, StatusPill, RoleLocked } from "@/components/ui/primitives";
import { TestingTab } from "@/components/order/testing-tab";
import { useRole } from "@/lib/role";

/*
 * useSearchParams() (the ?lot= / ?slot= scope the board links with) opts the tree out of
 * static prerender unless it sits under Suspense — the production build refuses the page
 * otherwise. Same wrapper, same reason as the Logistics queue.
 */
export default function OrderTestingWorkspacePage() {
  return (
    <Suspense fallback={null}>
      <OrderTestingWorkspace />
    </Suspense>
  );
}

/**
 * Testing for one order, reached from the Testing board: the full testing module.
 * The order workspace's own Testing tab mounts the **same** `TestingTab` with the same
 * actions, so this route is a second door to one screen rather than a second screen —
 * whichever way an operator arrives, WHL mail, report fetches, stage moves, lab-fee
 * settlement and lot verdicts all behave identically.
 *
 * **Scoped by default (2026-08-24).** The board's rows are test slots, not orders, so a
 * click arrives with `?lot=<id>` (or `?slot=<id>` while the lab has not confirmed the
 * booking yet) and the screen opens on that submission's own journey — its stages, its
 * report, its fee — rather than on every slot the order happens to carry. Widening back
 * to the order is one click, and the header says so: scoping is a starting point, not a
 * cage. Arriving with no parameter (the attention cards, an old link) still opens the
 * whole order.
 */
function OrderTestingWorkspace() {
  const params = useParams();
  const search = useSearchParams();
  const orderId = params.orderId as string;
  const b = useStore((s) => s.orders[orderId]);
  const { canAccessTesting } = useRole();
  const seedTestingDemo = useStore((s) => s.seedTestingDemo);
  const resetTestingFlow = useStore((s) => s.resetTestingFlow);

  /*
   * The submission the board sent us to, narrowest first — and all three verified against the
   * order, because a stale id after a demo reset must widen the screen, never scope it to nothing.
   *   · `lot`  — the submission itself, once the lab has confirmed it
   *   · `slot` — the booking, before any lot exists to point at
   *   · `mpn`  — the part, which is on every board link and is the only handle a row with nothing
   *              booked has. Without it such a row opened the whole order: click one part, get the
   *              part list.
   */
  const focusLot = b?.lots.find((l) => l.id === search.get("lot"));
  const focusSlot = (b?.testSlots ?? []).find((x) => x.id === (search.get("slot") ?? focusLot?.testSlotId));
  const mpnParam = search.get("mpn") ?? undefined;
  const focusMpn = mpnParam && (b?.lines.some((l) => l.mpn === mpnParam) || b?.lots.some((l) => l.orderLineMpn === mpnParam))
    ? mpnParam : undefined;

  if (!canAccessTesting) {
    return (
      <div className="space-y-5">
        <Link href="/fulfilment/testing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Testing
        </Link>
        <Panel><RoleLocked roleLabel="SC" action="view or act on testing" /></Panel>
      </div>
    );
  }

  if (!b) {
    return (
      <div className="space-y-5">
        <Link href="/fulfilment/testing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Testing
        </Link>
        <Panel>
          <div className="p-6 text-center text-sm text-muted-foreground">
            Order not found (it may have been reset).{" "}
            <Link href="/fulfilment/testing" className="text-primary hover:underline">Back to testing</Link>.
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/fulfilment/testing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Testing
        </Link>
        {/* Demo controls: load a realistic mid-flight state to read end to end,
            or strip back to the start and book the slot by hand. */}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => seedTestingDemo(orderId)} title="Load a realistic mid-flight testing state onto this order — appointment confirmed, samples dispatched, one lot passed and reported, one still on the bench with its verdict to set.">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Load demo flow
          </Button>
          <Button variant="ghost" onClick={() => resetTestingFlow(orderId)} title="Strip this order's testing back to before anything was booked, to run the whole flow step by step.">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset flow
          </Button>
        </div>
      </div>

      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{b.orderNo}</span>
          <span className="text-base font-normal text-muted-foreground">· testing</span>
          <StatusPill status={b.status} />
          <Pill tone={b.paymentMode === "ESCROW" ? "warn" : "neutral"}>{b.paymentMode}</Pill>
        </span>}
        description={<>
          {b.buyer.name} <span className="text-faint">(client)</span> · {b.supplier.name} <span className="text-faint">(supplier)</span>
          {b.supplierPoNo ? <> · Purchase Order <span className="font-mono">{b.supplierPoNo}</span></> : null}
          {" "}— this is where testing is worked: mail WHL, fetch reports, record dispatch, settle the lab fee and set lot verdicts.
        </>}
      />

      {/* Scoped arrival: say which submission is on screen and how to widen it. The board
          sends one test slot, not the order, so without this the screen would silently show
          a subset of the order's lots. */}
      {(focusSlot || focusLot || focusMpn) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border bg-card-2 px-3 py-2 text-xs">
          <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {focusSlot || focusLot ? "Showing one test slot:" : "Showing one part:"}
          </span>
          <b>{focusLot?.orderLineMpn ?? focusMpn}</b>
          {focusSlot && <><span className="text-faint">·</span><b className="font-mono">{focusSlot.slotNo}</b></>}
          {focusLot && <span className="font-mono text-faint">{focusLot.lotCode}{focusLot.workOrderNo ? ` · WO ${focusLot.workOrderNo}` : ""}</span>}
          <Link href={`/fulfilment/testing/${orderId}`} className="ml-auto font-medium text-primary hover:underline">
            show the whole order — {b.lines.filter((l) => l.testingMode !== "NONE").length} testable part
            {b.lines.filter((l) => l.testingMode !== "NONE").length === 1 ? "" : "s"}, {b.lots.length} test slot
            {b.lots.length === 1 ? "" : "s"} →
          </Link>
        </div>
      )}

      {/* No booking control on this screen (2026-08-25): test slots are booked from the Testing
          board, against the part they are for. See the module spec §9.1. */}
      <TestingTab key={focusLot?.id ?? focusSlot?.id ?? focusMpn ?? "ALL"} b={b} id={orderId}
        focusLotId={focusLot?.id} focusSlotId={focusSlot?.id} focusMpn={focusMpn} />
    </div>
  );
}
