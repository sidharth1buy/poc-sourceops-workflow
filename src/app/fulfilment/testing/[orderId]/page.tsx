"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useStore } from "@/store/store";
import { PageHeader, Panel, Pill, StatusPill, Button } from "@/components/ui/primitives";
import { TestingTab } from "@/components/order/testing-tab";
import { AddLotModal } from "@/components/order/modals";

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
      <Link href="/fulfilment/testing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Testing
      </Link>

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
        actions={
          <Link href={`/fulfilment/orders/${orderId}?tab=Testing`}>
            <Button variant="outline">Order workspace <ExternalLink className="h-3.5 w-3.5" /></Button>
          </Link>
        }
      />

      <TestingTab b={b} id={orderId} onAdd={() => setAddLot(true)} />

      {addLot && <AddLotModal orderId={orderId} onClose={() => setAddLot(false)} />}
    </div>
  );
}
