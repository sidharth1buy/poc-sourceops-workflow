"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useStore } from "@/store/store";
import { weClearImportCustoms } from "@/lib/incoterm";
import { Panel, Pill, Button, PageHeader } from "@/components/ui/primitives";
import { CustomsEntryCard } from "@/components/order/customs-card";
import { FileBOEModal } from "@/components/order/modals";

export default function CustomsDeskPage() {
  return (
    <Suspense fallback={<PageHeader title="Customs" description="Loading…" />}>
      <CustomsDesk />
    </Suspense>
  );
}

function CustomsDesk() {
  const orders = useStore((s) => s.orders);
  const router = useRouter();
  const params = useSearchParams();

  // orders 1Buy actually clears (international, not DDP) that have an inbound shipment
  const jobs = Object.values(orders).filter(
    (b) => weClearImportCustoms(b) && b.shipments.some((s) => s.leg === "INBOUND"),
  );
  const focusId = params.get("order") ?? "";

  // deep link to file straight away: ?order=…&file=1
  const fileParam = params.get("file") === "1" ? focusId : "";
  const [fileFor, setFileFor] = useState(fileParam);
  const closeFile = () => { setFileFor(""); router.replace("/fulfilment/customs"); };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customs"
        description={<>India import clearance for every order <b className="text-foreground">1Buy clears</b> (ICEGATE). File the Bill of Entry, run faceless assessment, pay duty and get <b className="text-foreground">Out-of-Charge</b> — which releases the shipment from customs. DDP orders (supplier clears) never appear here.</>}
      />

      {jobs.length === 0 ? (
        <Panel><div className="p-6 text-center text-sm text-muted-foreground">No customs work — no international orders that 1Buy clears have an inbound shipment yet. Book one on the <Link href="/fulfilment/logistics" className="text-primary hover:underline">Logistics desk</Link> first.</div></Panel>
      ) : (
        jobs.map((b) => {
          const inbound = b.shipments.filter((s) => s.leg === "INBOUND");
          // a shipment still needs a BoE if it has no entry, or an entry that isn't filed yet
          const needsFiling = inbound.filter((s) => {
            const c = b.customs.find((x) => x.shipmentNo === s.shipmentNo);
            return !c || !c.beNo || c.beNo === "filing…";
          });
          const cleared = b.customs.length > 0 && b.customs.every((c) => c.stage === "CLEARED");
          return (
            <Panel
              key={b.id}
              className={focusId === b.id ? "ring-2 ring-primary/40" : undefined}
              title={b.orderNo}
              actions={needsFiling.length > 0 ? <Button variant="outline" onClick={() => setFileFor(b.id)}><Plus className="h-4 w-4" /> File BoE</Button> : undefined}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/fulfilment/orders/${b.id}`} className="font-mono text-xs text-primary hover:underline">{b.orderNo}</Link>
                <Pill tone="neutral">Incoterm {b.incoterm}</Pill>
                <span className="text-xs text-muted-foreground">{b.supplier.name} → 1Buy hub</span>
                {cleared && <Pill tone="ok">cleared</Pill>}
              </div>
              {b.customs.length === 0 ? (
                <div className="rounded-lg border bg-warn-bg p-2.5 text-xs text-warn">
                  {inbound.length} inbound shipment(s) awaiting clearance — <b>File BoE</b> to start (Prior or on-arrival).
                </div>
              ) : (
                <div className="space-y-3">
                  {b.customs.map((c) => <CustomsEntryCard key={c.id} c={c} id={b.id} onFile={() => setFileFor(b.id)} />)}
                </div>
              )}
            </Panel>
          );
        })
      )}

      {fileFor && <FileBOEModal orderId={fileFor} onClose={closeFile} />}
    </div>
  );
}
