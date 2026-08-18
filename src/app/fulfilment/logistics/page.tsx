"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Truck, FlaskConical, Mail, Stamp } from "lucide-react";
import { useStore } from "@/store/store";
import { allShipments, currentReport, remainingToShipLeg } from "@/store/selectors";
import { incotermPlan } from "@/lib/incoterm";
import { shipmentStage, STAGE_META, STAGE_ORDER, type ShipmentStage, type StageTone } from "@/lib/shipment-stage";
import { Panel, Pill, StatusPill, Button, DataTable, PageHeader, type Col } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { CreateShipmentModal, RequestDocsModal } from "@/components/order/modals";
import { DhlBookingWizard } from "@/components/order/dhl-booking-wizard";
import { qtyfmt, cn } from "@/lib/utils";

const LOGI_TABS = ["Overview", "To Book", "Shipments", "Pickups", "Documents", "Supplier Comms", "Exceptions"] as const;
type LogiTab = (typeof LOGI_TABS)[number];

export default function LogisticsBoardPage() {
  return (
    <Suspense fallback={<PageHeader title="Logistics" description="Loading…" />}>
      <LogisticsBoard />
    </Suspense>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "ok" | "info" }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "warn" && value > 0 ? "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg" : "bg-card")}>
      <div className={cn("text-2xl font-bold tabular-nums", tone === "warn" && value > 0 ? "text-warn" : tone === "ok" ? "text-ok" : "text-foreground")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function LogisticsBoard() {
  const orders = useStore((s) => s.orders);
  const poll = useStore((s) => s.pollShipmentTracking);
  const receiveDocs = useStore((s) => s.receiveShippingDocs);
  const reschedule = useStore((s) => s.reschedulePickup);
  const cancelPickup = useStore((s) => s.cancelPickup);
  const retrieveDocs = useStore((s) => s.retrieveCarrierDocs);
  const correctCI = useStore((s) => s.correctCarrierInvoice);
  const router = useRouter();
  const params = useSearchParams();

  const [composeFor, setComposeFor] = useState("");
  const [reschedId, setReschedId] = useState<string | null>(null);
  const [reschedDate, setReschedDate] = useState("");
  const [stageFilter, setStageFilter] = useState<ShipmentStage | "ALL" | "AWAITING">("ALL");

  // newest activity first — most-recently created / status-changed / tracked shipment on top
  const rows = [...allShipments(orders)].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  const inb = rows.filter((r) => r.leg === "INBOUND");

  // deep link from the testing screen: ?order=…&lot=… (one lot) or ?order=…&lots=a,b,c (bulk)
  const orderId = params.get("order") ?? "";
  const lotIds = (params.get("lots") ?? params.get("lot") ?? "").split(",").filter(Boolean);
  const order = orders[orderId];
  const lots = (order?.lots ?? []).filter((l) => lotIds.includes(l.id));
  const [modalOpen, setModalOpen] = useState(lots.length > 0);

  // deep link from an order's Shipments tab: ?order=…&book=1 → open booking (DHL wizard if we book,
  // else the record-supplier-AWB modal)
  const initialBookId = params.get("book") === "1" ? orderId : "";
  const initialWeBook = !!initialBookId && incotermPlan(orders[initialBookId]?.incoterm ?? "").weBookFreight;
  const [bookFor, setBookFor] = useState(initialWeBook ? "" : initialBookId);
  const [wizardFor, setWizardFor] = useState(initialWeBook ? initialBookId : "");
  const bookOrder = orders[bookFor];
  const wizardOrder = orders[wizardFor];

  // Pending inbound bookings — the logistics team's work queue (no Order-page access needed): every
  // active order that still has inbound qty to move and no inbound shipment booked yet.
  const toBook = Object.values(orders).filter((o) =>
    !["CLOSED", "CANCELLED"].includes(o.status) &&
    !o.shipments.some((s) => s.leg === "INBOUND") &&
    o.lines.some((l) => remainingToShipLeg(o, l.mpn, "INBOUND") > 0),
  ).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); // newest orders first

  // KPIs / derived work-lists
  const awaitingDocs = Object.values(orders).filter((o) => o.shippingDocs?.status === "REQUESTED");
  const readyToBook = toBook.filter((o) => o.shippingDocs?.status === "RECEIVED");
  const inTransit = inb.filter((r) => ["DISPATCHED", "IN_TRANSIT"].includes(r.status));
  const atCustoms = inb.filter((r) => r.status === "AT_CUSTOMS");
  const delivered = inb.filter((r) => ["ARRIVED", "DELIVERED"].includes(r.status));
  const bookingFailed = inb.filter((r) => r.awb === "booking failed");
  const comms = Object.values(orders).filter((o) => o.shippingDocs).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const docShipments = inb.filter((r) => (r.bookingDocs?.length ?? 0) > 0);
  const pickups = inb.filter((r) => r.pickupConfirmationNo);
  const stageCounts = Object.fromEntries(STAGE_ORDER.map((st) => [st, rows.filter((r) => shipmentStage(r) === st).length])) as Record<ShipmentStage, number>;
  const filteredRows = stageFilter === "ALL" || stageFilter === "AWAITING" ? rows : rows.filter((r) => shipmentStage(r) === stageFilter);

  const [tab, setTab] = useState<LogiTab>(lots.length > 0 || initialBookId ? "To Book" : "Overview");

  const clearLink = () => { setModalOpen(false); router.replace("/fulfilment/logistics"); };
  const clearBook = () => { setBookFor(""); router.replace("/fulfilment/logistics"); };
  const clearWizard = () => { setWizardFor(""); router.replace("/fulfilment/logistics"); };

  const cols: Col<(typeof rows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/orders/${r.orderId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "leg", header: "Leg", render: (r) => <Pill tone={r.leg === "INBOUND" ? "info" : "neutral"}>{r.leg === "INBOUND" ? "Inbound" : "Outbound"}</Pill> },
    { key: "carrier", header: "Carrier", render: (r) => r.carrier },
    { key: "awb", header: "AWB", render: (r) => r.trackingUrl
      ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-primary hover:underline">{r.awb}</a>
      : <span className="font-mono text-xs text-muted-foreground">{r.awb}</span> },
    { key: "qty", header: "Qty", align: "right", render: (r) => qtyfmt(r.lines.reduce((a, l) => a + l.qty, 0)) },
    { key: "status", header: "Tracking", render: (r) => <StatusPill status={r.status} /> },
    { key: "stage", header: "Stage", render: (r) => { const st = shipmentStage(r); return <Pill tone={STAGE_META[st].tone}>{STAGE_META[st].label}</Pill>; } },
    { key: "loc", header: "Location", render: (r) => {
      const loc = r.lastLocation || (r.status === "PLANNED" ? r.fromLocation : "");
      return loc ? <span className="text-xs text-muted-foreground">{loc}</span> : <span className="text-xs text-faint">—</span>;
    } },
    { key: "customs", header: "Customs", render: (r) => !r.needsCustoms ? <span className="text-xs text-faint">n/a</span> : r.hasCustoms ? <Pill tone="ok">cleared</Pill> : <Pill tone="warn">pending</Pill> },
    { key: "act", header: "", align: "right", render: (r) => {
      const terminal = r.status === "DELIVERED" || r.status === "CANCELLED";
      const booked = r.awb !== "booking…" && r.awb !== "booking failed";
      return <Button variant="outline" onClick={(e) => { e.stopPropagation(); if (booked) poll(r.orderId, r.id); }} disabled={terminal || !booked} title={!booked ? "AWB not booked" : terminal ? "Terminal status" : "Poll carrier"}>Refresh tracking</Button>;
    } },
  ];

  // several lots of the same MPN collapse into one shipment line, capped by what's left to move
  const perMpn = order
    ? Array.from(new Set(lots.map((l) => l.orderLineMpn))).map((mpn) => {
        const want = lots.filter((l) => l.orderLineMpn === mpn).reduce((a, l) => a + l.qty, 0);
        const cap = remainingToShipLeg(order, mpn, "INBOUND");
        return { mpn, want, qty: Math.max(0, Math.min(want, cap)), cap };
      })
    : [];
  const totalToMove = perMpn.reduce((a, r) => a + r.qty, 0);
  const origins = Array.from(new Set(lots.map((l) => l.lab ?? order?.supplier.name ?? "—")));
  const failed = lots.filter((l) => l.testStatus === "FAIL");
  const noReport = lots.filter((l) => (l.reports ?? []).length === 0);

  const badge: Partial<Record<LogiTab, number>> = {
    "To Book": toBook.length, Shipments: rows.length, "Supplier Comms": comms.length,
    Exceptions: bookingFailed.length + atCustoms.length,
  };

  // reusable "orders awaiting a booking" list (used in the To Book tab + the Awaiting-booking stage)
  const toBookListEl = toBook.length === 0
    ? <p className="p-4 text-center text-sm text-muted-foreground">No pending bookings — every active order with inbound goods has an AWB.</p>
    : <div className="space-y-2">
        {toBook.map((o) => {
          const qty = o.lines.reduce((a, l) => a + remainingToShipLeg(o, l.mpn, "INBOUND"), 0);
          const weBook = incotermPlan(o.incoterm).weBookFreight;
          const sd = o.shippingDocs;
          return (
            <div key={o.id} className="rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/fulfilment/orders/${o.id}`} className="font-mono text-xs font-medium text-primary hover:underline">{o.orderNo}</Link>
                  <Pill tone="neutral">Incoterm {o.incoterm}</Pill>
                  <span className="text-xs text-muted-foreground">{o.supplier.name} → 1Buy hub · {qtyfmt(qty)} to move</span>
                </div>
                <div className="flex items-center gap-2">
                  {!weBook ? (
                    <Button onClick={() => setBookFor(o.id)}><Truck className="h-4 w-4" /> Record supplier AWB</Button>
                  ) : !sd ? (
                    <Button onClick={() => setComposeFor(o.id)}><Mail className="h-4 w-4" /> Request docs from supplier</Button>
                  ) : sd.status === "REQUESTED" ? (
                    <Button variant="outline" onClick={() => receiveDocs(o.id)}>Check supplier reply</Button>
                  ) : (
                    <Button onClick={() => setWizardFor(o.id)}><Truck className="h-4 w-4" /> Book with DHL</Button>
                  )}
                </div>
              </div>
              {weBook && sd && (
                <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                  {sd.status === "REQUESTED"
                    ? <>📧 Requested <b className="text-foreground">{sd.requested.join(", ")}</b> from {o.supplier.name} — awaiting reply.</>
                    : <>✓ Supplier replied: <b className="text-foreground">{sd.pieces} pcs · {sd.grossWeightKg} kg · {sd.dimensions}</b> · docs: {sd.docs?.join(", ")}.</>}
                </div>
              )}
            </div>
          );
        })}
      </div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Logistics" description={<>The forwarding desk for the <b className="text-foreground">supplier → 1Buy</b> inbound leg: request docs, book the carrier (DHL), manage pickups, track, and hand the waybill + invoice to the CHA. Inbound AWBs are hidden from the client; outbound from the supplier.</>} />

      {/* module sub-nav */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b">
        {LOGI_TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm transition",
              tab === t ? "border-primary bg-accent-soft font-semibold text-primary" : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {t}
            {badge[t] ? <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{badge[t]}</span> : null}
          </button>
        ))}
      </div>

      {/* ───────────────── Overview ───────────────── */}
      {tab === "Overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Stat label="To book" value={toBook.length} tone="warn" />
            <Stat label="Awaiting docs" value={awaitingDocs.length} />
            <Stat label="Ready to book" value={readyToBook.length} tone="ok" />
            <Stat label="In transit" value={inTransit.length} />
            <Stat label="At customs" value={atCustoms.length} tone="warn" />
            <Stat label="Delivered" value={delivered.length} tone="ok" />
            <Stat label="Exceptions" value={bookingFailed.length} tone="warn" />
          </div>
          <Panel title="Needs attention">
            {toBook.length + awaitingDocs.length + bookingFailed.length === 0
              ? <p className="p-4 text-center text-sm text-muted-foreground">Nothing waiting — all inbound shipments booked & moving.</p>
              : <div className="space-y-1.5 text-sm">
                  {readyToBook.map((o) => <AttnRow key={o.id} tone="ok" text={<>Docs received for <OrderLink o={o} /> — ready to book.</>} onGo={() => { setTab("To Book"); }} />)}
                  {awaitingDocs.filter((o) => o.shippingDocs?.status === "REQUESTED").map((o) => <AttnRow key={o.id} text={<>Awaiting supplier docs for <OrderLink o={o} />.</>} onGo={() => setTab("Supplier Comms")} />)}
                  {toBook.filter((o) => !o.shippingDocs).map((o) => <AttnRow key={o.id} tone="warn" text={<>No shipment booked for <OrderLink o={o} /> — start the request.</>} onGo={() => setTab("To Book")} />)}
                  {bookingFailed.map((r) => <AttnRow key={r.id} tone="warn" text={<>Booking failed for <span className="font-mono text-xs">{r.orderNo} · {r.shipmentNo}</span>.</>} onGo={() => setTab("Exceptions")} />)}
                </div>}
          </Panel>
        </div>
      )}

      {/* ───────────────── To Book ───────────────── */}
      {tab === "To Book" && (
        <div className="space-y-4">
          {/* arrived here from the testing screen — book the movement without hunting for the order */}
          {lots.length > 0 && order && (
            <Panel title={`Create logistics for ${lots.length === 1 ? "a tested lot" : `${lots.length} tested lots`}`}
              actions={<div className="flex gap-2">
                <Button variant="ghost" onClick={clearLink}>Dismiss</Button>
                <Button onClick={() => setModalOpen(true)} disabled={totalToMove <= 0}>
                  <Truck className="h-4 w-4" /> {totalToMove > 0 ? "Create shipment" : "Fully shipped"}
                </Button>
              </div>}>
              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="text-muted-foreground">order <Link href={`/fulfilment/orders/${order.id}`} className="font-mono text-primary hover:underline">{order.orderNo}</Link></span>
                <span className="text-muted-foreground">lots <b className="text-foreground">{lots.length}</b></span>
                <span className="text-muted-foreground">to move <b className="text-foreground tnum">{qtyfmt(totalToMove)}</b> across <b className="text-foreground">{perMpn.length}</b> MPN(s)</span>
                <span className="text-muted-foreground">from <b className="text-foreground">{origins.join(" · ")}</b></span>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-card-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left">Lot</th><th className="px-3 py-2 text-left">MPN</th><th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-left">Verdict</th><th className="px-3 py-2 text-left">Report</th><th className="px-3 py-2 text-left">Currently at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((l) => {
                      const r = currentReport(l);
                      return (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5 text-primary" />{l.lotCode}</span></td>
                          <td className="px-3 py-2 font-mono text-xs">{l.orderLineMpn}</td>
                          <td className="px-3 py-2 text-right tnum">{qtyfmt(l.qty)}</td>
                          <td className="px-3 py-2"><StatusPill status={l.testStatus} /></td>
                          <td className="px-3 py-2 text-xs">{r ? <span className="font-mono">{r.reportNo}</span> : <span className="text-warn">none</span>}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{l.lab ?? order.supplier.name}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Lots of the same MPN are merged into one shipment line: {perMpn.map((r) => `${r.mpn} ×${qtyfmt(r.qty)}${r.want > r.cap ? ` (capped from ${qtyfmt(r.want)})` : ""}`).join(" · ") || "—"}. Destination is the 1Buy hub.</p>
              {origins.length > 1 && <p className="mt-1 text-xs text-warn">These lots sit at {origins.length} locations — one AWB collects from one origin. Book separately.</p>}
              {failed.length > 0 && <p className="mt-1 text-xs text-bad">{failed.map((l) => l.lotCode).join(", ")} did not pass — book the return leg instead.</p>}
              {noReport.length > 0 && <p className="mt-1 text-xs text-warn">{noReport.map((l) => l.lotCode).join(", ")} have no report yet.</p>}
            </Panel>
          )}

          <Panel title={`To book · ${toBook.length}`}>
            {toBook.length > 0 && <p className="mb-3 text-xs text-muted-foreground">Active orders with inbound goods to move and no AWB yet. Request docs from the supplier, then book the carrier.</p>}
            {toBookListEl}
          </Panel>
        </div>
      )}

      {/* ───────────────── Shipments (stage pipeline) ───────────────── */}
      {tab === "Shipments" && (
        <div className="space-y-3">
          {/* stage filter bar */}
          <div className="no-scrollbar flex flex-wrap gap-1.5">
            <StageChip label="All" count={rows.length} tone="neutral" active={stageFilter === "ALL"} onClick={() => setStageFilter("ALL")} />
            <StageChip label="Awaiting booking" count={toBook.length} tone="warn" active={stageFilter === "AWAITING"} onClick={() => setStageFilter("AWAITING")} />
            {STAGE_ORDER.map((st) => (
              <StageChip key={st} label={STAGE_META[st].label} count={stageCounts[st]} tone={STAGE_META[st].tone} active={stageFilter === st} onClick={() => setStageFilter(st)} />
            ))}
          </div>

          {stageFilter === "AWAITING" ? (
            <Panel title={`Awaiting booking · ${toBook.length}`}>{toBookListEl}</Panel>
          ) : (
            <Panel>
              <p className="mb-2 text-xs text-muted-foreground">Click a shipment to open its detail page (full tracking + docs + customs). <b>Refresh tracking</b> polls the carrier.</p>
              <DataTable columns={cols} rows={filteredRows}
                onRowClick={(r) => router.push(`/fulfilment/logistics/shipments/${r.id}`)}
                empty={stageFilter === "ALL" ? "No shipments yet — book one from Awaiting booking." : "No shipments in this stage."} />
            </Panel>
          )}
        </div>
      )}

      {/* ───────────────── Pickups ───────────────── */}
      {tab === "Pickups" && (
        <Panel title={`Pickups · ${pickups.length}`}>
          {pickups.length === 0
            ? <p className="p-4 text-center text-sm text-muted-foreground">No pickups scheduled — booking a DHL shipment with a pickup date schedules one here.</p>
            : <div className="space-y-2">
                {pickups.map((r) => (
                  <div key={r.id} className="rounded-lg border p-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{r.orderNo} · {r.shipmentNo}</span>
                        <span className="text-xs text-muted-foreground">{r.fromLocation}</span>
                        <Pill tone="neutral">{r.bookingMode === "SEPARATE" ? "separate" : "combined"}</Pill>
                        <span className="text-xs text-muted-foreground">Pickup <b className="font-mono text-foreground">{r.pickupConfirmationNo}</b> · {r.pickupWindow}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => { setReschedId(r.id); setReschedDate(""); }}>Reschedule</Button>
                        <Button variant="ghost" onClick={() => cancelPickup(r.orderId, r.id)}>Cancel</Button>
                      </div>
                    </div>
                    {reschedId === r.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input type="date" value={reschedDate} onChange={(e) => setReschedDate(e.target.value)} className="w-40" />
                        <Button onClick={() => { if (reschedDate) { reschedule(r.orderId, r.id, reschedDate, "18:00"); setReschedId(null); } }} disabled={!reschedDate}>Confirm new date</Button>
                        <button className="text-xs text-muted-foreground hover:underline" onClick={() => setReschedId(null)}>dismiss</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>}
          <p className="mt-3 text-xs text-muted-foreground"><b>Combined</b> = pickup created inline with the shipment; <b>separate</b> = a standalone <code>POST /pickups</code>. Reschedule / cancel (<code>PATCH</code> / <code>DELETE /pickups</code>) comes next.</p>
        </Panel>
      )}

      {/* ───────────────── Documents ───────────────── */}
      {tab === "Documents" && (
        <Panel title="Documents · waybill + invoice → CHA">
          {docShipments.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">No booked shipments with documents yet.</p> : (
            <div className="space-y-2">
              {docShipments.map((r) => {
                const booked = r.awb !== "booking…" && r.awb !== "booking failed";
                return (
                  <div key={r.id} className="rounded-lg border p-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{r.orderNo} · {r.shipmentNo}</span>
                        <span className="font-mono text-xs text-muted-foreground">{r.awb}</span>
                        <span className="text-xs text-muted-foreground">📎 {r.bookingDocs?.join(", ")}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {booked && !r.carrierDocs?.length && <Button variant="outline" onClick={() => retrieveDocs(r.orderId, r.id)}>Retrieve waybill + CI</Button>}
                        {booked && <Button variant="ghost" onClick={() => correctCI(r.orderId, r.id)}>Re-upload CI</Button>}
                        <Button variant="outline" onClick={() => router.push(`/fulfilment/customs?order=${r.orderId}`)}><Stamp className="h-4 w-4" /> Send to CHA</Button>
                      </div>
                    </div>
                    {r.carrierDocs?.length ? (
                      <div className="mt-1.5 text-xs text-muted-foreground">From DHL: {r.carrierDocs.map((d) => <span key={d.fileName} className="mr-3 font-mono text-primary">{d.fileName}</span>)}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Real flow: <code>GET /shipments/&#123;awb&#125;/invoices</code> returns the waybill + commercial invoice PDFs that the CHA files the BoE with.</p>
        </Panel>
      )}

      {/* ───────────────── Supplier Comms ───────────────── */}
      {tab === "Supplier Comms" && (
        <Panel title="Supplier communication">
          {comms.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">No supplier threads yet — request shipping docs from the To Book tab.</p> : (
            <div className="space-y-2">
              {comms.map((o) => {
                const sd = o.shippingDocs!;
                return (
                  <div key={o.id} className="rounded-lg border p-2.5 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/fulfilment/orders/${o.id}`} className="font-mono text-xs text-primary hover:underline">{o.orderNo}</Link>
                        <span className="text-xs text-muted-foreground">{o.supplier.name}</span>
                        <Pill tone={sd.status === "RECEIVED" ? "ok" : "warn"}>{sd.status === "RECEIVED" ? "docs received" : "requested"}</Pill>
                      </span>
                      {sd.status === "REQUESTED" && <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => setComposeFor(o.id)}>Remind</Button>
                        <Button variant="outline" onClick={() => receiveDocs(o.id)}>Check reply</Button>
                      </div>}
                    </div>
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      📧 Requested {sd.requested.join(", ")}{sd.requestedAt ? ` · ${sd.requestedAt}` : ""}
                      {sd.status === "RECEIVED" && <> · ✓ replied {sd.receivedAt}: <b className="text-foreground">{sd.pieces} pcs · {sd.grossWeightKg} kg · {sd.dimensions}</b></>}
                    </div>
                    {sd.requestBody && <details className="mt-1.5 text-xs text-muted-foreground"><summary className="cursor-pointer select-none">view request email</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 text-[11px]">{sd.requestBody}</pre></details>}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {/* ───────────────── Exceptions ───────────────── */}
      {tab === "Exceptions" && (
        <Panel title="Exceptions">
          {bookingFailed.length + atCustoms.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">No exceptions — nothing held or failed.</p> : (
            <div className="space-y-2 text-sm">
              {bookingFailed.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-warn-bg p-2.5 text-warn">
                  <span>❌ Carrier booking failed · <span className="font-mono text-xs">{r.orderNo} · {r.shipmentNo}</span> — rebook from the order&apos;s Shipments tab.</span>
                  <Button variant="outline" onClick={() => router.push(`/fulfilment/orders/${r.orderId}`)}>Open order</Button>
                </div>
              ))}
              {atCustoms.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
                  <span>🔒 Held at customs · <span className="font-mono text-xs">{r.orderNo} · {r.shipmentNo}</span> — the BoE must clear (OOC) before it moves on.</span>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => correctCI(r.orderId, r.id)} title="Re-attach a corrected commercial invoice (DHL /upload-image)">Correct CI</Button>
                    <Button variant="outline" onClick={() => router.push(`/fulfilment/customs?order=${r.orderId}`)}><Stamp className="h-4 w-4" /> Customs desk</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* modals (shared across tabs) */}
      {modalOpen && lots.length > 0 && order && (
        <CreateShipmentModal orderId={order.id}
          prefill={{ lotCodes: lots.map((l) => l.lotCode), lines: perMpn.map((r) => ({ mpn: r.mpn, qty: r.qty })), from: origins[0], leg: "INBOUND" }}
          onClose={() => setModalOpen(false)} />
      )}
      {composeFor && <RequestDocsModal orderId={composeFor} onClose={() => setComposeFor("")} />}
      {bookOrder && <CreateShipmentModal orderId={bookOrder.id} onClose={clearBook} />}
      {wizardOrder && <DhlBookingWizard orderId={wizardOrder.id} onClose={clearWizard} />}
    </div>
  );
}

function StageChip({ label, count, active, onClick, tone }: { label: string; count: number; active: boolean; onClick: () => void; tone: StageTone }) {
  return (
    <button onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
        active ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted")}>
      {label}
      <Pill tone={tone}>{count}</Pill>
    </button>
  );
}

function OrderLink({ o }: { o: { id: string; orderNo: string } }) {
  return <Link href={`/fulfilment/orders/${o.id}`} className="font-mono text-xs text-primary hover:underline">{o.orderNo}</Link>;
}

function AttnRow({ text, onGo, tone }: { text: React.ReactNode; onGo: () => void; tone?: "warn" | "ok" }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5", tone === "warn" ? "bg-warn-bg" : tone === "ok" ? "bg-ok-bg" : "")}>
      <span className={cn(tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-foreground")}>{text}</span>
      <button className="text-xs text-primary hover:underline" onClick={onGo}>go →</button>
    </div>
  );
}
