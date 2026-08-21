"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useStore } from "@/store/store";
import { ONEBUY_HUB } from "@/data/fixtures";
import { Panel, Pill, Button, PageHeader, RoleLocked, StatusPill } from "@/components/ui/primitives";
import { OrderStagePill } from "@/components/order/order-stage-pill";
import { money, qtyfmt } from "@/lib/utils";
import { useRole } from "@/lib/role";

export default function SupplierPoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supplierPos = useStore((s) => s.supplierPos);
  const orders = useStore((s) => s.orders);
  const createOrderFromSupplierPo = useStore((s) => s.createOrderFromSupplierPo);
  const { canAccessPurchaseOrders } = useRole();

  function createOrder(poId: string) {
    const orderId = createOrderFromSupplierPo(poId);
    if (orderId) router.push(`/fulfilment/order-flow/${orderId}`);
  }

  if (!canAccessPurchaseOrders) {
    return (
      <div className="space-y-5">
        <PageHeader title="Purchase Order" description="Our purchase orders — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="view or act on purchase orders" /></Panel>
      </div>
    );
  }

  const spo = supplierPos.find((s) => s.id === id);
  if (!spo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Purchase Order" description="This purchase order no longer exists." />
        <Panel>
          <div className="p-6 text-center text-sm text-muted-foreground">
            Not found. <Link href="/fulfilment/supplier-pos" className="text-primary hover:underline">Back to Purchase Orders</Link>.
          </div>
        </Panel>
      </div>
    );
  }

  const linkedCount = spo.lines.filter((l) => l.clientPoNo && l.clientLineMpn).length;
  const b = spo.orderId ? orders[spo.orderId] : undefined;

  return (
    <div className="space-y-5">
      <Link href="/fulfilment/supplier-pos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Purchase Orders
      </Link>

      <PageHeader
        title={<span className="font-mono">{spo.poNo}</span>}
        description={<>{spo.supplier.name} <span className="text-faint">({spo.supplier.country})</span></>}
        actions={
          <span className="flex flex-wrap items-center justify-end gap-2">
            <Pill tone={spo.paymentMode === "ESCROW" ? "warn" : "neutral"}>{spo.paymentMode}</Pill>
            <Pill tone={spo.status === "ORDERED" ? "ok" : "warn"}>PO: {spo.status === "ORDERED" ? "Ordered" : "Draft"}</Pill>
            {b && <StatusPill status={b.status} />}
            {b && <OrderStagePill b={b} />}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Overview" className="lg:col-span-1">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Lines</span><b>{spo.lines.length} · {linkedCount} linked</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Buy total</span><b className="tnum">{money(spo.buyTotal, spo.currency)}</b></div>
            {b ? (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Order</span>
                  <Link href={`/fulfilment/order-flow/${b.id}`} className="font-mono text-primary hover:underline">{b.orderNo}</Link>
                </div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Order status</span>
                  <div className="flex flex-col items-end gap-1"><StatusPill status={b.status} /><OrderStagePill b={b} /></div>
                </div>
              </>
            ) : (
              <div className="flex justify-between"><span className="text-muted-foreground">Order</span><span className="text-faint">Not created yet</span></div>
            )}
          </div>
        </Panel>

        <Panel title="Supplier & terms" className="lg:col-span-2">
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
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
        </Panel>
      </div>

      <Panel title="Lines">
        <div className="space-y-2">
          {spo.lines.map((l, i) => (
            <div key={`${l.mpn}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-sm">
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
            ? <Link href={`/fulfilment/order-flow/${spo.orderId}`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium hover:border-primary">Open order <ArrowRight className="h-4 w-4" /></Link>
            : <Button onClick={() => createOrder(spo.id)}>Create order <ArrowRight className="h-4 w-4" /></Button>}
        </div>
      </Panel>
    </div>
  );
}
