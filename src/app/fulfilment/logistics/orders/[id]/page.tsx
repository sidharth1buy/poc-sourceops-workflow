"use client";

// ONE INBOUND ORDER, AS THE LOGISTICS DESK SEES IT — AND NOTHING ELSE.
//
// This is the desk's KRA view, deliberately narrower than the order workspace:
// where the consignment is, the booking, the desk's correspondence, the desk's
// documents, and the two records that close it out. Escrow, testing verdicts,
// margins and approvals are other desks' concerns and are not rendered here —
// a screen that shows somebody everything shows them nothing.
//
// THREE TABS, ONE JOB EACH:
//   Shipment      — the journey, the booking form (on the page, never a
//                   dialog), tracking, and the GRN + POD that make "delivered".
//   Communication — the to-and-fro with the supplier / carrier / broker / dock.
//   Documents     — the desk's paper, both directions, with the send-to mapping.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronUp, FileDown, RefreshCw, RotateCcw, Sparkles, Truck } from "lucide-react";
import { useStore } from "@/store/store";
import { inboundView, nextAction, PRESSURE_META } from "@/lib/logistics-order";
import { incotermPlan } from "@/lib/incoterm";
import { Button, Field, FormTabBar, Panel } from "@/components/ui/primitives";
import { DhlBookingForm } from "@/components/order/dhl-booking-form";
import { InboundStepper } from "@/components/logistics/inbound-stepper";
import { GrnPodPanel } from "@/components/logistics/grn-pod-panel";
import { LogisticsCommunication } from "@/components/logistics/logistics-communication";
import { LogisticsDocumentsTab } from "@/components/logistics/logistics-documents-tab";
import { TrackingTimeline } from "@/components/order/tracking-timeline";
import { money } from "@/lib/utils";

type Tab = "SHIPMENT" | "COMMS" | "DOCS";

const TONE_CLS: Record<string, string> = {
  bad: "bg-bad-bg text-bad border-red-400/60",
  warn: "bg-warn-bg text-warn border-amber-400/60",
  ok: "bg-ok-bg text-ok border-emerald-400/60",
  info: "bg-accent-soft text-primary border-primary/40",
  neutral: "bg-muted text-muted-foreground",
};

export default function LogisticsOrderPage() {
  const { id } = useParams<{ id: string }>();
  const b = useStore((s) => s.orders[id]);
  const requestShippingDocs = useStore((s) => s.requestShippingDocs);
  const receiveShippingDocs = useStore((s) => s.receiveShippingDocs);
  const poll = useStore((s) => s.pollShipmentTracking);
  const retrieveDocs = useStore((s) => s.retrieveCarrierDocs);
  const seedLogisticsDemo = useStore((s) => s.seedLogisticsDemo);
  const resetLogisticsFlow = useStore((s) => s.resetLogisticsFlow);

  const [tab, setTab] = useState<Tab>("SHIPMENT");
  /* The booking form expands only when asked for — never on page load. */
  const [bookingOpen, setBookingOpen] = useState(false);

  const v = useMemo(() => (b ? inboundView(b) : null), [b]);

  if (!b || !v) {
    return (
      <div className="space-y-4">
        <Link href="/fulfilment/logistics" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Logistics
        </Link>
        <Panel>
          <div className="p-6 text-center text-sm text-muted-foreground">
            Order not found (the demo may have been reset).{" "}
            <Link href="/fulfilment/logistics" className="text-primary hover:underline">Back to Logistics</Link>.
          </div>
        </Panel>
      </div>
    );
  }

  const leg = b.shipments.find((s) => s.leg === "INBOUND");
  const booked = Boolean(leg && leg.awb !== "booking…" && leg.awb !== "booking failed");
  const plan = incotermPlan(b.incoterm);
  const sd = b.shippingDocs;
  const pMeta = PRESSURE_META[v.pressure];

  return (
    <div className="space-y-4">
      {/* ── Who this is, and how hard it presses ─────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/fulfilment/logistics" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> All inbound orders
          </Link>
          {/* Demo controls: load a realistic mid-flow state to read end to end,
              or strip back to the start and run every step by hand. */}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => seedLogisticsDemo(b.id)} title="Load a realistic mid-flow inbound state onto this order — docs received, booked, cleared, arrived — leaving the GRN and POD to finish by hand.">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Load demo flow
            </Button>
            <Button variant="ghost" onClick={() => resetLogisticsFlow(b.id)} title="Strip this order's inbound flow back to the start, to run the whole journey step by step.">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset flow
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold">{b.orderNo}</h1>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLS[pMeta.tone]}`}>{pMeta.label}</span>
          {v.daysLeft !== null && !v.delivered && (
            <span className="text-sm text-muted-foreground">
              {v.daysLeft < 0 ? `${Math.abs(v.daysLeft)} days past the promised date` : v.daysLeft === 0 ? "promised for today" : `${v.daysLeft} days to the promised date`} ({b.requiredBy})
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          For <b className="text-foreground">{b.buyer.name}</b> · from {b.supplier.name} ({b.supplier.country}) → 1Buy hub ·{" "}
          {b.incoterm} — {plan.summary}
        </p>
        {/* The one thing to do next — same words as the queue, so the page and
            the list can never send somebody two different ways. */}
        {!v.delivered && (
          <p className="mt-1.5 text-sm">
            <span className="font-semibold">Next:</span> {nextAction(b, v)}
          </p>
        )}
      </div>

      <FormTabBar<Tab>
        tabs={[
          { id: "SHIPMENT", label: "Shipment & delivery" },
          { id: "COMMS", label: "Communication" },
          { id: "DOCS", label: "Documents" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "SHIPMENT" && (
        <div className="space-y-4">
          <Panel title="Where it is on the inbound journey">
            <InboundStepper v={v} />
          </Panel>

          {/* ── Booking — a form on the page, only when booking is our move ── */}
          {!booked && (
            plan.weBookFreight ? (
              sd?.status === "RECEIVED" ? (
                /*
                 * Collapsed until asked for. The form is the page's biggest
                 * block; opening it uninvited buried the journey and the
                 * delivery records under it. The button is the accordion.
                 */
                <Panel
                  title="Place the order with the logistics partner"
                  actions={bookingOpen ? (
                    <Button variant="ghost" onClick={() => setBookingOpen(false)}>
                      <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> Collapse
                    </Button>
                  ) : undefined}
                >
                  {!bookingOpen ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        The supplier&rsquo;s documents are in, so everything is ready to book — one
                        form, prefilled from their packing list and commercial invoice.
                      </p>
                      <Button onClick={() => setBookingOpen(true)}>
                        <Truck className="mr-1.5 h-4 w-4" /> Book shipment
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Particulars are prefilled from the supplier&rsquo;s packing list and
                        commercial invoice. Today the partner is DHL Express; more partners plug in
                        here as they come aboard.
                      </p>
                      <DhlBookingForm orderId={b.id} onDone={() => setBookingOpen(false)} />
                    </>
                  )}
                </Panel>
              ) : (
                <Panel title="Before booking: the supplier's documents">
                  <p className="text-sm text-muted-foreground">
                    A carrier is booked from the packing list and commercial invoice — boxes,
                    weights, value. {sd ? "They have been asked for and have not arrived yet." : "They have not been asked for yet."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {!sd && <Button onClick={() => requestShippingDocs(b.id)}>Ask the supplier for the documents</Button>}
                    {sd && sd.status === "REQUESTED" && (
                      <Button variant="outline" onClick={() => receiveShippingDocs(b.id)}>Check for the supplier&rsquo;s reply</Button>
                    )}
                  </div>
                </Panel>
              )
            ) : (
              <Panel title="Booking is the supplier's move on these terms">
                <p className="text-sm text-muted-foreground">
                  {b.incoterm}: {plan.summary} Chase their booking advice from the Communication
                  tab — once their waybill number is known, it appears here.
                </p>
              </Panel>
            )
          )}

          {/* ── The consignment, once one exists ─────────────────────────── */}
          {booked && leg && (
            <Panel
              title="The consignment"
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => poll(b.id, leg.id)}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh tracking
                  </Button>
                  {!leg.carrierDocs?.length && (
                    <Button variant="ghost" onClick={() => retrieveDocs(b.id, leg.id)}>
                      <FileDown className="mr-1.5 h-3.5 w-3.5" /> Get carrier documents
                    </Button>
                  )}
                </div>
              }
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Carrier / AWB"><span className="font-mono text-sm">{leg.carrier} · {leg.awb}</span></Field>
                <Field label="Route"><span className="text-sm">{leg.fromLocation} → {leg.toLocation}</span></Field>
                <Field label="Cargo"><span className="text-sm">{leg.boxCount} boxes · {leg.grossWeightKg} kg</span></Field>
                <Field label="Freight">
                  <span className="text-sm">{leg.rateAmount ? `${money(leg.rateAmount, leg.rateCurrency ?? "USD")}${leg.productName ? ` · ${leg.productName}` : ""}` : "—"}</span>
                </Field>
                {leg.pickupWindow && <Field label="Pickup"><span className="text-sm">{leg.pickupWindow}</span></Field>}
                {leg.estimatedDelivery && <Field label="Expected arrival"><span className="text-sm">{leg.estimatedDelivery}</span></Field>}
                {leg.lastLocation && <Field label="Last seen"><span className="text-sm">{leg.lastLocation}</span></Field>}
                {leg.carrierDocs?.length ? (
                  <Field label="Carrier documents"><span className="text-sm">{leg.carrierDocs.map((d) => d.fileName).join(", ")}</span></Field>
                ) : null}
              </div>
              <div className="mt-3">
                <TrackingTimeline s={leg} isImport={b.tradeType === "INTERNATIONAL"} />
              </div>
            </Panel>
          )}

          {/* ── The two records that make "delivered" ─────────────────────── */}
          <Panel title="Delivery — the goods receipt note and the proof of delivery">
            <GrnPodPanel b={b} v={v} />
          </Panel>
        </div>
      )}

      {tab === "COMMS" && (
        <Panel title="Communication on this order">
          <LogisticsCommunication b={b} />
        </Panel>
      )}

      {tab === "DOCS" && (
        <Panel title="This desk's documents">
          <LogisticsDocumentsTab b={b} onGoToShipment={() => setTab("SHIPMENT")} />
        </Panel>
      )}
    </div>
  );
}
