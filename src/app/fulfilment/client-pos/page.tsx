"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/store/store";
import { sourcedForClientLine, clientPoStatus } from "@/store/selectors";
import { Panel, Pill, Button, PageHeader } from "@/components/ui/primitives";
import { SourceOrderModal } from "@/components/order/modals";
import { prettyStatus } from "@/data/enums";
import { money, qtyfmt, fmtAddress } from "@/lib/utils";

type SrcTarget = { poNo: string; buyer: string; mpn: string; price: number; remaining: number };

export default function ClientPosPage() {
  const clientPos = useStore((s) => s.clientPos);
  const orders = useStore((s) => s.orders);
  const supplierPos = useStore((s) => s.supplierPos);
  const [src, setSrc] = useState<SrcTarget | null>(null);

  const statusTone = (s: string): "ok" | "warn" | "neutral" => (s === "FULLY_SOURCED" ? "ok" : s === "PARTIALLY_SOURCED" ? "warn" : "neutral");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Orders"
        description={<>The demand we fulfil. <b className="text-foreground">Source</b> each line to one or more suppliers (split a PO across suppliers, or reuse an order for several POs).</>}
        actions={<Link href="/fulfilment/client-pos/new"><Button><Plus className="h-4 w-4" /> New Sales Order</Button></Link>}
      />

      <div className="space-y-4">
        {clientPos.map((cpo) => {
          const status = clientPoStatus(supplierPos, orders, cpo);
          const serving = supplierPos.filter((spo) =>
            spo.lines.some((l) => l.clientPoNo === cpo.clientPoNo) ||
            (spo.orderId ? !!orders[spo.orderId]?.sourcingAllocations.some((a) => a.clientPoNo === cpo.clientPoNo) : false));
          return (
            <Panel key={cpo.id}
              title={<span className="flex items-center gap-2"><span className="font-mono normal-case text-primary">{cpo.clientPoNo}</span><span className="text-faint">·</span> {cpo.client.name} ({cpo.client.country})</span>}
              actions={<span className="flex items-center gap-2"><Pill tone={cpo.paymentMode === "ESCROW" ? "warn" : "neutral"}>{cpo.paymentMode}</Pill><Pill tone={statusTone(status)}>{prettyStatus(status)}</Pill></span>}>
              {(cpo.client.gstin || cpo.terms || fmtAddress(cpo.deliveryAddress)) && (
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b pb-2 text-xs text-muted-foreground">
                  {cpo.terms?.referenceNo && <span>Raised against <span className="font-mono text-foreground">{cpo.terms.referenceNo}</span></span>}
                  {cpo.client.gstin && <span>GSTIN {cpo.client.gstin}{cpo.client.state ? ` · ${cpo.client.state}` : ""}</span>}
                  {cpo.terms?.paymentMethod && <span>Pay: {cpo.terms.paymentMethod}</span>}
                  {cpo.terms?.deliveryTerms && <span>{cpo.terms.deliveryTerms}</span>}
                  {cpo.terms?.testingTerms && <span>Testing: {cpo.terms.testingTerms}</span>}
                  {cpo.terms?.warranty && <span>Warranty {cpo.terms.warranty}</span>}
                  {cpo.terms?.gstNote && <span>{cpo.terms.gstNote}</span>}
                  {fmtAddress(cpo.deliveryAddress) && <span>Deliver to: {fmtAddress(cpo.deliveryAddress)}</span>}
                </div>
              )}
              <div className="space-y-2">
                {cpo.lines.map((l) => {
                  const sourced = sourcedForClientLine(supplierPos, orders, cpo.clientPoNo, l.mpn);
                  const remaining = l.qty - sourced;
                  return (
                    <div key={l.mpn} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
                      <span className="min-w-[140px] flex-1"><span className="font-mono text-xs">{l.mpn}</span>{l.make && <span className="ml-1.5 text-[11px] text-faint">{l.make}</span>}{l.dateCode && <span className="ml-1.5 text-[11px] text-faint">DC {l.dateCode}</span>}</span>
                      <span className="text-muted-foreground">demand <b className="text-foreground tnum">{qtyfmt(l.qty)}</b></span>
                      <span className={sourced >= l.qty ? "text-ok" : sourced > 0 ? "text-warn" : "text-faint"}>sourced <b className="tnum">{qtyfmt(sourced)}</b></span>
                      <span className="text-muted-foreground">remaining <b className="text-foreground tnum">{qtyfmt(remaining)}</b></span>
                      <span className="text-faint">@ {money(l.unitPrice)}</span>
                      {remaining > 0
                        ? <Button variant="outline" onClick={() => setSrc({ poNo: cpo.clientPoNo, buyer: cpo.client.name, mpn: l.mpn, price: l.unitPrice, remaining })}>Source →</Button>
                        : <Pill tone="ok">fully sourced</Pill>}
                    </div>
                  );
                })}
              </div>

              {serving.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sourced via (purchase orders)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {serving.map((spo) => (
                      <Link key={spo.id} href={spo.orderId ? `/fulfilment/orders/${spo.orderId}` : "/fulfilment/supplier-pos"}
                        className="rounded-md border px-2 py-1 text-xs hover:border-primary">
                        <span className="font-mono text-primary">{spo.poNo}</span> · {spo.supplier.name}
                        {spo.status === "DRAFT" && <span className="ml-1 text-warn">· draft</span>}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      {src && (
        <SourceOrderModal clientPoNo={src.poNo} buyerName={src.buyer} clientLineMpn={src.mpn}
          unitPrice={src.price} remaining={src.remaining} onClose={() => setSrc(null)} />
      )}
    </div>
  );
}
