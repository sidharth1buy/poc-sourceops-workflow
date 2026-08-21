"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useStore } from "@/store/store";
import { sourcedForClientLine, clientPoStatus } from "@/store/selectors";
import { Panel, Pill, Button, PageHeader, RoleLocked } from "@/components/ui/primitives";
import { SourceOrderModal } from "@/components/order/modals";
import { prettyStatus } from "@/data/enums";
import { money, qtyfmt, fmtAddress } from "@/lib/utils";
import { useRole } from "@/lib/role";

type SrcTarget = { poNo: string; buyer: string; mpn: string; price: number; remaining: number };

const statusTone = (s: string): "ok" | "warn" | "neutral" => (s === "FULLY_SOURCED" ? "ok" : s === "PARTIALLY_SOURCED" ? "warn" : "neutral");

export default function ClientPoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const clientPos = useStore((s) => s.clientPos);
  const orders = useStore((s) => s.orders);
  const supplierPos = useStore((s) => s.supplierPos);
  const [src, setSrc] = useState<SrcTarget | null>(null);
  const { canAccessSalesOrders } = useRole();

  if (!canAccessSalesOrders) {
    return (
      <div className="space-y-5">
        <PageHeader title="Sales Order" description="Client demand — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="view or act on sales orders" /></Panel>
      </div>
    );
  }

  const cpo = clientPos.find((c) => c.id === id);
  if (!cpo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Sales Order" description="This sales order no longer exists." />
        <Panel>
          <div className="p-6 text-center text-sm text-muted-foreground">
            Not found. <Link href="/fulfilment/client-pos" className="text-primary hover:underline">Back to Sales Orders</Link>.
          </div>
        </Panel>
      </div>
    );
  }

  const status = clientPoStatus(supplierPos, orders, cpo);
  const total = cpo.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const demandQty = cpo.lines.reduce((s, l) => s + l.qty, 0);
  const sourcedQty = cpo.lines.reduce((s, l) => s + sourcedForClientLine(supplierPos, orders, cpo.clientPoNo, l.mpn), 0);
  const serving = supplierPos.filter((spo) =>
    spo.lines.some((l) => l.clientPoNo === cpo.clientPoNo) ||
    (spo.orderId ? !!orders[spo.orderId]?.sourcingAllocations.some((a) => a.clientPoNo === cpo.clientPoNo) : false));

  return (
    <div className="space-y-5">
      <Link href="/fulfilment/client-pos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Sales Orders
      </Link>

      <PageHeader
        title={<span className="inline-flex items-center gap-2 font-mono">{cpo.clientPoNo}</span>}
        description={<>{cpo.client.name} <span className="text-faint">({cpo.client.country})</span></>}
        actions={
          <span className="flex items-center gap-2">
            <Pill tone={cpo.paymentMode === "ESCROW" ? "warn" : "neutral"}>{cpo.paymentMode}</Pill>
            <Pill tone={statusTone(status)}>{prettyStatus(status)}</Pill>
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Overview" className="lg:col-span-1">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Lines</span><b>{cpo.lines.length}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Sourced / demand</span>
              <span className={sourcedQty >= demandQty ? "text-ok" : sourcedQty > 0 ? "text-warn" : "text-faint"}>
                <b className="tnum">{qtyfmt(sourcedQty)}</b><span className="text-faint">/</span><b className="tnum text-foreground">{qtyfmt(demandQty)}</b>
              </span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><b className="tnum">{money(total)}</b></div>
          </div>
        </Panel>

        <Panel title="Client & terms" className="lg:col-span-2">
          {(cpo.client.gstin || cpo.terms || fmtAddress(cpo.deliveryAddress)) ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              {cpo.terms?.referenceNo && <span>Raised against <span className="font-mono text-foreground">{cpo.terms.referenceNo}</span></span>}
              {cpo.client.gstin && <span>GSTIN {cpo.client.gstin}{cpo.client.state ? ` · ${cpo.client.state}` : ""}</span>}
              {cpo.terms?.paymentMethod && <span>Pay: {cpo.terms.paymentMethod}</span>}
              {cpo.terms?.deliveryTerms && <span>{cpo.terms.deliveryTerms}</span>}
              {cpo.terms?.testingTerms && <span>Testing: {cpo.terms.testingTerms}</span>}
              {cpo.terms?.warranty && <span>Warranty {cpo.terms.warranty}</span>}
              {cpo.terms?.gstNote && <span>{cpo.terms.gstNote}</span>}
              {fmtAddress(cpo.deliveryAddress) && <span>Deliver to: {fmtAddress(cpo.deliveryAddress)}</span>}
            </div>
          ) : <p className="text-sm text-muted-foreground">No additional terms on file.</p>}
        </Panel>
      </div>

      <Panel title="Lines">
        <div className="space-y-2">
          {cpo.lines.map((l) => {
            const sourced = sourcedForClientLine(supplierPos, orders, cpo.clientPoNo, l.mpn);
            const remaining = l.qty - sourced;
            return (
              <div key={l.mpn} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-sm">
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
      </Panel>

      {serving.length > 0 && (
        <Panel title="Sourced via (purchase orders)">
          <div className="flex flex-wrap gap-1.5">
            {serving.map((spo) => (
              <Link key={spo.id} href={spo.orderId ? `/fulfilment/order-flow/${spo.orderId}` : `/fulfilment/supplier-pos/${spo.id}`}
                className="rounded-md border bg-card px-2 py-1 text-xs hover:border-primary">
                <span className="font-mono text-primary">{spo.poNo}</span> · {spo.supplier.name}
                {spo.status === "DRAFT" && <span className="ml-1 text-warn">· draft</span>}
              </Link>
            ))}
          </div>
        </Panel>
      )}

      {src && (
        <SourceOrderModal clientPoNo={src.poNo} buyerName={src.buyer} clientLineMpn={src.mpn}
          unitPrice={src.price} remaining={src.remaining} onClose={() => setSrc(null)} />
      )}
    </div>
  );
}
