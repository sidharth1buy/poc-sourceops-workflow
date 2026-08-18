"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw, Stamp, FileDown } from "lucide-react";
import { useStore } from "@/store/store";
import { allShipments } from "@/store/selectors";
import { shipmentStage, STAGE_META } from "@/lib/shipment-stage";
import { customsBucket, BUCKET_META } from "@/lib/customs-bucket";
import { Panel, Pill, StatusPill, Button, Field } from "@/components/ui/primitives";
import { TrackingTimeline } from "@/components/order/tracking-timeline";
import { qtyfmt, money } from "@/lib/utils";

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orders = useStore((s) => s.orders);
  const poll = useStore((s) => s.pollShipmentTracking);
  const retrieveDocs = useStore((s) => s.retrieveCarrierDocs);

  const row = allShipments(orders).find((r) => r.id === id);
  if (!row) {
    return (
      <div className="space-y-4">
        <Link href="/fulfilment/logistics" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Logistics</Link>
        <Panel><div className="p-6 text-center text-sm text-muted-foreground">Shipment not found (it may have been reset). <Link href="/fulfilment/logistics" className="text-primary hover:underline">Back to Logistics</Link>.</div></Panel>
      </div>
    );
  }
  const order = orders[row.orderId];
  const stage = shipmentStage(row);
  const meta = STAGE_META[stage];
  const isImport = row.leg === "INBOUND" && row.tradeType === "INTERNATIONAL";
  const booked = row.awb !== "booking…" && row.awb !== "booking failed";
  const terminal = row.status === "DELIVERED" || row.status === "CANCELLED";
  const ce = order?.customs.find((c) => c.shipmentNo === row.shipmentNo);

  return (
    <div className="space-y-5">
      <Link href="/fulfilment/logistics" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Logistics</Link>

      {/* header */}
      <div className="rounded-[var(--radius)] border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold">{row.shipmentNo}</h1>
              <Pill tone={row.leg === "INBOUND" ? "info" : "neutral"}>{row.leg === "INBOUND" ? "Inbound" : "Outbound"}</Pill>
              <StatusPill status={row.status} />
              <Pill tone={meta.tone}>{meta.label}</Pill>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <Link href={`/fulfilment/orders/${row.orderId}`} className="font-mono text-primary hover:underline">{row.orderNo}</Link>
              {" · "}{row.carrier}{" · "}
              {row.trackingUrl
                ? <a href={row.trackingUrl} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">{row.awb}</a>
                : <span className="font-mono">{row.awb}</span>}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{row.fromLocation} → {row.toLocation}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {row.leg === "INBOUND" && booked && !terminal && <Button onClick={() => poll(row.orderId, row.id)}><RefreshCw className="h-4 w-4" /> Refresh tracking</Button>}
            {booked && !row.carrierDocs?.length && <Button variant="outline" onClick={() => retrieveDocs(row.orderId, row.id)}><FileDown className="h-4 w-4" /> Retrieve waybill + CI</Button>}
            {isImport && <Button variant="outline" onClick={() => { location.href = `/fulfilment/customs?order=${row.orderId}`; }}><Stamp className="h-4 w-4" /> Customs</Button>}
          </div>
        </div>
        {row.lastLocation && <p className="mt-3 text-xs text-muted-foreground">Currently at: <b className="text-foreground">{row.lastLocation}</b></p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* details */}
        <div className="space-y-4">
          <Panel title="Shipment">
            <Field label="Order"><Link href={`/fulfilment/orders/${row.orderId}`} className="font-mono text-primary hover:underline">{row.orderNo}</Link> · {order?.supplier.name}</Field>
            <Field label="Route">{row.fromLocation} → {row.toLocation}</Field>
            <Field label="Cargo">{row.boxCount} pcs · {row.grossWeightKg} kg{row.dimensions ? ` · ${row.dimensions}` : ""}</Field>
            {(row.packages?.length ?? 0) > 1 && (
              <Field label="Boxes">
                <span className="space-y-0.5">{row.packages!.map((p, i) => (
                  <span key={i} className="block text-xs text-muted-foreground">{p.count}× {p.dimensions || "—"} · {p.weightKg} kg/box</span>
                ))}</span>
              </Field>
            )}
            <Field label="Lines">{row.lines.map((l) => `${l.mpn} ×${qtyfmt(l.qty)}`).join(" · ") || "—"}</Field>
            {row.goodsDescription && <Field label="Goods">{row.goodsDescription}{row.hsCode ? ` · HS ${row.hsCode}` : ""}</Field>}
            {!!row.declaredValue && <Field label="Declared value">{money(row.declaredValue, row.declaredCurrency)}</Field>}
          </Panel>

          {(row.productName || row.pickupConfirmationNo) && (
            <Panel title="DHL booking">
              {row.productName && <Field label="Product">{row.productName}{row.productCode ? ` (${row.productCode})` : ""}{row.estimatedDelivery ? ` · ETA ${row.estimatedDelivery}` : ""}</Field>}
              {!!row.rateAmount && <Field label="Rate">{money(row.rateAmount, row.rateCurrency)}</Field>}
              {row.pickupConfirmationNo
                ? <Field label="Pickup"><span className="font-mono">{row.pickupConfirmationNo}</span> · {row.pickupWindow} · {row.bookingMode === "SEPARATE" ? "separate" : "combined"}</Field>
                : row.pickupReadyDate ? <Field label="Pickup">ready {row.pickupReadyDate}</Field> : null}
            </Panel>
          )}

          {(row.bookingDocs?.length || row.carrierDocs?.length) && (
            <Panel title="Documents">
              {row.bookingDocs?.length ? <Field label="Filed at booking">{row.bookingDocs.join(", ")}</Field> : null}
              {row.carrierDocs?.length ? <Field label="From DHL">{row.carrierDocs.map((d) => d.fileName).join(", ")}</Field> : null}
            </Panel>
          )}

          {isImport && (
            <Panel title="Customs">
              {ce
                ? <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>BE {ce.beNo || "—"}</span>
                    <Pill tone={BUCKET_META[customsBucket(ce)].tone}>{BUCKET_META[customsBucket(ce)].label}</Pill>
                    {ce.duty && <span className="text-xs text-muted-foreground">duty {money(ce.duty.totalDuty, ce.currency)}{ce.dutyPaidAt ? " · paid" : " · due"}</span>}
                    <Link href={`/fulfilment/customs?order=${row.orderId}`} className="text-primary hover:underline">open Customs desk →</Link>
                  </div>
                : <p className="text-sm text-muted-foreground">No BoE filed yet. <Link href={`/fulfilment/customs?order=${row.orderId}`} className="text-primary hover:underline">Customs desk →</Link></p>}
            </Panel>
          )}
        </div>

        {/* tracking */}
        <Panel title="Tracking">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">DHL scan history</span>
            {row.leg === "INBOUND" && booked && !terminal && <button className="text-xs text-primary hover:underline" onClick={() => poll(row.orderId, row.id)}>refresh</button>}
          </div>
          <TrackingTimeline s={row} isImport={isImport} />
        </Panel>
      </div>
    </div>
  );
}
