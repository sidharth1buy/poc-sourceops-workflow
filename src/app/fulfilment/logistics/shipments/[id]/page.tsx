"use client";

// RETIRED ROUTE. The desk's unit of work is the ORDER, not the shipment — the
// logistics workspace lives at /fulfilment/logistics/orders/[id] and this page
// only forwards old links there (a shipment id resolves to the order that owns
// it). Kept as a redirect rather than deleted so nothing bookmarked breaks.

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/store/store";
import { Panel } from "@/components/ui/primitives";

export default function ShipmentRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const orders = useStore((s) => s.orders);

  const owner = Object.values(orders).find((b) => b.shipments.some((s) => s.id === id));

  useEffect(() => {
    if (owner) router.replace(`/fulfilment/logistics/orders/${owner.id}`);
  }, [owner, router]);

  return (
    <Panel>
      <div className="p-6 text-center text-sm text-muted-foreground">
        {owner ? "Taking you to the order's logistics workspace…" : (
          <>Shipment not found (the demo may have been reset). <Link href="/fulfilment/logistics" className="text-primary hover:underline">Back to Logistics</Link>.</>
        )}
      </div>
    </Panel>
  );
}
