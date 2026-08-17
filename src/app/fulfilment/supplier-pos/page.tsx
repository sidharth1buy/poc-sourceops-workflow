"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ArrowRight } from "lucide-react";
import { useStore } from "@/store/store";
import { ONEBUY_HUB } from "@/data/fixtures";
import { Panel, Pill, Button, PageHeader } from "@/components/ui/primitives";
import { money, qtyfmt } from "@/lib/utils";

export default function SupplierPosPage() {
  const router = useRouter();
  const supplierPos = useStore((s) => s.supplierPos);
  const createOrderFromSupplierPo = useStore((s) => s.createOrderFromSupplierPo);

  function createOrder(id: string) {
    const orderId = createOrderFromSupplierPo(id);
    if (orderId) router.push(`/fulfilment/orders/${orderId}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase Orders"
        description={<>Our purchase docs to suppliers. Lines can reference one or more sales-order lines (or stay unlinked). Once ready, <b className="text-foreground">create the fulfilment order</b> from a PO to start the journey.</>}
        actions={<Link href="/fulfilment/supplier-pos/new"><Button><Plus className="h-4 w-4" /> New Purchase Order</Button></Link>}
      />

      {supplierPos.length === 0 && (
        <Panel><div className="p-6 text-center text-sm text-muted-foreground">No purchase orders yet. <Link href="/fulfilment/supplier-pos/new" className="text-primary hover:underline">Create one</Link>.</div></Panel>
      )}

      <div className="space-y-4">
        {supplierPos.map((spo) => {
          const linkedCount = spo.lines.filter((l) => l.clientPoNo && l.clientLineMpn).length;
          return (
            <Panel key={spo.id}
              title={<span className="flex items-center gap-2"><span className="font-mono normal-case text-primary">{spo.poNo}</span><span className="text-faint">·</span> {spo.supplier.name} ({spo.supplier.country})</span>}
              actions={
                <span className="flex items-center gap-2">
                  <Pill tone={spo.paymentMode === "ESCROW" ? "warn" : "neutral"}>{spo.paymentMode}</Pill>
                  <Pill tone={spo.status === "ORDERED" ? "ok" : "warn"}>{spo.status === "ORDERED" ? "Ordered" : "Draft"}</Pill>
                </span>
              }>
              {(spo.supplier.gstin || spo.terms) && (
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b pb-2 text-xs text-muted-foreground">
                  {spo.terms?.referenceNo && <span>Raised against <span className="font-mono text-foreground">{spo.terms.referenceNo}</span></span>}
                  {spo.supplier.gstin && <span>GSTIN {spo.supplier.gstin}{spo.supplier.state ? ` · ${spo.supplier.state}` : ""}</span>}
                  {!spo.supplier.gstin && spo.supplier.state && <span>{spo.supplier.state}</span>}
                  <span>{spo.tradeType === "INTERNATIONAL" ? "Intl" : "Domestic"} · {spo.incoterm}</span>
                  <span>Ship to: {ONEBUY_HUB.name}</span>
                  {spo.terms?.paymentMethod && <span>Pay: {spo.terms.paymentMethod}</span>}
                  {spo.paymentMode === "CREDIT" && spo.creditDays && <span>Credit · {spo.creditDays} days</span>}
                  {spo.incoterm === "CIF" && spo.terms?.destinationPort && <span>Ship to: {spo.terms.destinationPort}</span>}
                  {spo.terms?.deliveryTerms && <span>{spo.terms.deliveryTerms}</span>}
                  {spo.terms?.warranty && <span>Warranty {spo.terms.warranty}</span>}
                  {!!spo.termsConditions?.length && <span>{spo.termsConditions.length} T&amp;C</span>}
                  {!!spo.relabelCost && <span>Relabel {spo.relabelCost}</span>}
                </div>
              )}

              <div className="space-y-2">
                {spo.lines.map((l, i) => (
                  <div key={`${l.mpn}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
                    <span className="min-w-[150px] flex-1"><span className="font-mono text-xs">{l.mpn}</span>{l.make && <span className="ml-1.5 text-[11px] text-faint">{l.make}</span>}{l.dateCode && <span className="ml-1.5 text-[11px] text-faint">DC {l.dateCode}</span>}</span>
                    <span className="text-muted-foreground">qty <b className="text-foreground tnum">{qtyfmt(l.qty)}</b></span>
                    <span className="text-faint">@ {money(l.buyUnitPrice, spo.currency)}</span>
                    {l.clientPoNo && l.clientLineMpn
                      ? <Pill tone="info">→ {l.clientPoNo} · {l.clientLineMpn}</Pill>
                      : <Pill tone="warn">unlinked — map later</Pill>}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
                <span className="text-muted-foreground">
                  Buy total <b className="text-foreground tnum">{money(spo.buyTotal, spo.currency)}</b>
                  <span className="ml-2 text-faint">{spo.lines.length} line(s) · {linkedCount} linked</span>
                </span>
                {spo.status === "ORDERED" && spo.orderId
                  ? <Link href={`/fulfilment/orders/${spo.orderId}`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium hover:border-primary">Open order <ArrowRight className="h-4 w-4" /></Link>
                  : <Button onClick={() => createOrder(spo.id)}>Create order <ArrowRight className="h-4 w-4" /></Button>}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
