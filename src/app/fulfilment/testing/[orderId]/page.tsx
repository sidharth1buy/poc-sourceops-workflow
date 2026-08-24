"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, RotateCcw, Sparkles } from "lucide-react";
import { useStore } from "@/store/store";
import { Button, PageHeader, Panel, Pill, StatusPill, RoleLocked } from "@/components/ui/primitives";
import { TestingTab } from "@/components/order/testing-tab";
import { AddLotModal } from "@/components/order/modals";
import { useRole } from "@/lib/role";

/**
 * Testing for one order, reached from the Testing board: the full testing module.
 * The order workspace's own Testing tab mounts the **same** `TestingTab` with the same
 * actions, so this route is a second door to one screen rather than a second screen —
 * whichever way an operator arrives, WHL mail, report fetches, stage moves, lab-fee
 * settlement and lot verdicts all behave identically.
 */
export default function OrderTestingWorkspacePage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const b = useStore((s) => s.orders[orderId]);
  const [addLot, setAddLot] = useState(false);
  const { canAccessTesting } = useRole();
  const seedTestingDemo = useStore((s) => s.seedTestingDemo);
  const resetTestingFlow = useStore((s) => s.resetTestingFlow);

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

      <TestingTab b={b} id={orderId} onAdd={() => setAddLot(true)} />

      {addLot && <AddLotModal orderId={orderId} onClose={() => setAddLot(false)} />}
    </div>
  );
}
