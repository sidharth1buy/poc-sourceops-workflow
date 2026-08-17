"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft, Lock, Check, CircleDot, Circle, Ban, ChevronRight, Upload, Building2, Plus,
} from "lucide-react";
import type { OrderBundle, JourneyStep, ShipmentStatus } from "@/types";
import { WORKSPACE_TABS, type WorkspaceTab } from "@/data/enums";
import { Panel, Pill, StatusPill, Button, Progress, Field, DataTable, type Col } from "@/components/ui/primitives";
import { Select } from "@/components/ui/form";
import { money, qtyfmt, cn, fmtAddress } from "@/lib/utils";
import { usd, toUSD } from "@/lib/fx";
import { useStore } from "@/store/store";
import { journeyPct, remainingToShip, remainingToAllocate, customsApplies, gateReason, mappedForOrderLine, unmappedForOrderLine } from "@/store/selectors";
import { incotermPlan, supplierHandlesCustoms } from "@/lib/incoterm";
import { trackingTimeline } from "@/integrations/logistics";
import {
  AddStepModal, AddLotModal, AddPaymentModal, CreateShipmentModal,
  FileBOEModal, AllocateDeliveryModal, AddEventModal, UploadDocModal, AddAllocationModal, UploadPIModal,
} from "@/components/order/modals";
import { TestingTab } from "@/components/order/testing-tab";

type ModalKey = null | "addStep" | "addLot" | "addPayment" | "shipment" | "boe" | "allocate" | "event" | "doc" | "pi";

export function OrderWorkspace({ id }: { id: string }) {
  const b = useStore((s) => s.orders[id]);
  const advanceStep = useStore((s) => s.advanceStep);
  const cancelOrder = useStore((s) => s.cancelOrder);
  const [tab, setTab] = useState<WorkspaceTab>("Overview");
  const [modal, setModal] = useState<ModalKey>(null);
  const [mapLine, setMapLine] = useState<OrderBundle["lines"][number] | null>(null);
  const close = () => setModal(null);

  if (!b) {
    return (
      <div className="space-y-4">
        <Link href="/fulfilment/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Orders</Link>
        <Panel><div className="p-6 text-center text-sm text-muted-foreground">Order not found (it may have been reset). <Link href="/fulfilment/orders" className="text-primary hover:underline">Back to orders</Link>.</div></Panel>
      </div>
    );
  }

  const pct = journeyPct(b);
  const done = b.journey.filter((s) => s.status === "DONE").length;
  const current = b.journey.find((s) => s.status === "IN_PROGRESS" || s.status === "BLOCKED");
  const blockedReason = current ? gateReason(b, current) : null;
  const nonUsd = b.currency !== "USD";

  return (
    <div className="space-y-5">
      <Link href="/fulfilment/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Orders</Link>

      <div className="rounded-[var(--radius)] border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold">{b.orderNo}</h1>
              <StatusPill status={b.status} />
              <Pill tone="info">{b.tradeType === "INTERNATIONAL" ? "International" : "Domestic"}</Pill>
              <Pill tone={b.paymentMode === "ESCROW" ? "warn" : "neutral"}>{b.paymentMode}</Pill>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {b.buyer.name} <span className="text-faint">(client)</span> <ChevronRight className="inline h-3 w-3" /> {b.maskingEntity} <ChevronRight className="inline h-3 w-3" /> {b.supplier.name} <span className="text-faint">(supplier)</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!["CLOSED", "CANCELLED"].includes(b.status) && (
              <Button variant="ghost" onClick={() => { if (confirm("Cancel this order and release its supplier PO back to draft?")) cancelOrder(id); }}>Cancel order</Button>
            )}
            <Button variant="outline" onClick={() => setModal("event")}>Add event</Button>
            <Button onClick={() => advanceStep(id)} disabled={!current}>{current ? `Advance: ${current.name}` : "All steps done"}</Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <MiniStat label="Buy (→ supplier)" value={money(b.buyTotal, b.currency)} sub={nonUsd ? usd(toUSD(b.buyTotal, b.currency)) : undefined} />
          <MiniStat label="Sell (client →)" value={money(b.sellTotal, b.currency)} sub={nonUsd ? usd(toUSD(b.sellTotal, b.currency)) : undefined} />
          <MiniStat label="Margin" value={`${money(b.sellTotal - b.buyTotal, b.currency)} · ${b.sellTotal > 0 ? Math.round(((b.sellTotal - b.buyTotal) / b.sellTotal) * 100) : 0}%`} />
          <MiniStat label="Required by" value={b.requiredBy} />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>Journey · {done}/{b.journey.length} steps</span>
            {current && <span className="inline-flex items-center gap-1">{current.isGate && <Lock className="h-3 w-3 text-warn" />} next: {current.name}</span>}
          </div>
          <Progress value={pct} />
          {blockedReason && <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-warn"><Lock className="h-3 w-3" /> Gate blocked — {blockedReason}</p>}
        </div>
      </div>

      <JourneyStepper b={b} />

      <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b">
        {WORKSPACE_TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("-mb-px whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm transition",
              tab === t
                ? "border-primary bg-accent-soft font-semibold text-primary"
                : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab b={b} pct={pct} current={current} onUploadPI={() => setModal("pi")} />}
      {tab === "Lines" && <LinesTab b={b} />}
      {tab === "Allocations" && <AllocationsTab b={b} onMap={setMapLine} />}
      {tab === "Journey" && <JourneyTab b={b} id={id} onAdd={() => setModal("addStep")} />}
      {tab === "Testing" && <TestingTab b={b} id={id} onAdd={() => setModal("addLot")} />}
      {tab === "Payments" && <PaymentsTab b={b} id={id} onAdd={() => setModal("addPayment")} />}
      {tab === "Shipments" && <ShipmentsTab b={b} id={id} onAdd={() => setModal("shipment")} />}
      {tab === "Customs" && <CustomsTab b={b} onFile={() => setModal("boe")} />}
      {tab === "Delivery" && <DeliveryTab b={b} id={id} onAllocate={() => setModal("allocate")} />}
      {tab === "Documents" && <DocumentsTab b={b} onUpload={() => setModal("doc")} />}
      {tab === "Events" && <EventsTab b={b} onAdd={() => setModal("event")} />}
      {tab === "Approvals" && <ApprovalsTab b={b} id={id} />}

      {modal === "addStep" && <AddStepModal orderId={id} onClose={close} />}
      {modal === "addLot" && <AddLotModal orderId={id} onClose={close} />}
      {modal === "addPayment" && <AddPaymentModal orderId={id} onClose={close} />}
      {modal === "shipment" && <CreateShipmentModal orderId={id} onClose={close} />}
      {modal === "boe" && <FileBOEModal orderId={id} onClose={close} />}
      {modal === "allocate" && <AllocateDeliveryModal orderId={id} onClose={close} />}
      {modal === "event" && <AddEventModal orderId={id} onClose={close} />}
      {modal === "doc" && <UploadDocModal orderId={id} onClose={close} />}
      {modal === "pi" && <UploadPIModal orderId={id} onClose={close} />}
      {mapLine && <AddAllocationModal orderId={id} orderLineId={mapLine.id} orderLineMpn={mapLine.mpn} unmapped={unmappedForOrderLine(b, mapLine)} onClose={() => setMapLine(null)} />}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tnum">{value}</div>
      {sub && <div className="text-[11px] text-faint tnum">≈ {sub}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

// Always-visible horizontal stepper: at-a-glance stage + blocked state.
function JourneyStepper({ b }: { b: OrderBundle }) {
  const current = b.journey.find((s) => s.status === "IN_PROGRESS" || s.status === "BLOCKED");
  const reason = current ? gateReason(b, current) : null;
  const done = b.journey.filter((s) => s.status === "DONE").length;
  return (
    <div className="rounded-[var(--radius)] border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Journey <span className="text-faint">· {done}/{b.journey.length} steps</span></div>
        {b.status === "CANCELLED" ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-bad-bg px-2 py-0.5 text-xs font-medium text-bad"><Ban className="h-3.5 w-3.5" /> Cancelled</span>
        ) : current ? (
          reason
            ? <span className="inline-flex items-center gap-1 rounded-md bg-bad-bg px-2 py-0.5 text-xs font-medium text-bad"><Lock className="h-3.5 w-3.5" /> Blocked — {reason}</span>
            : <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-primary"><CircleDot className="h-3.5 w-3.5" /> At: {current.name}{current.isGate ? " (gate)" : ""}</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok"><Check className="h-3.5 w-3.5" /> Complete</span>
        )}
      </div>
      <ol className="no-scrollbar flex items-start gap-0 overflow-x-auto pb-1">
        {b.journey.map((s, i) => {
          const isCurrent = s.id === current?.id;
          const blocked = isCurrent && !!reason;
          const node = s.status === "DONE" ? "border-primary bg-primary text-primary-foreground"
            : blocked ? "border-bad bg-bad-bg text-bad"
            : isCurrent ? "border-primary text-primary ring-2 ring-accent-soft"
            : "border-border text-faint";
          return (
            <li key={s.id} className="flex min-w-[92px] flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : b.journey[i - 1].status === "DONE" ? "bg-primary" : "bg-border")} />
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold", node)}>
                  {s.status === "DONE" ? <Check className="h-3.5 w-3.5" /> : blocked ? <Ban className="h-3.5 w-3.5" /> : isCurrent ? <CircleDot className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn("h-0.5 flex-1", i === b.journey.length - 1 ? "opacity-0" : s.status === "DONE" ? "bg-primary" : "bg-border")} />
              </div>
              <span className={cn("mt-1 px-1 text-center text-[10px] leading-tight", isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>
                {s.isGate && <Lock className="mr-0.5 inline h-2.5 w-2.5 text-warn" />}{s.name}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function OverviewTab({ b, pct, current, onUploadPI }: { b: OrderBundle; pct: number; current?: JourneyStep; onUploadPI: () => void }) {
  const nonUsd = b.currency !== "USD";
  const party = (p: OrderBundle["buyer"]) => [p.name, p.country, p.gstin, p.state].filter(Boolean).join(" · ");
  const t = b.terms;
  const termRows = (t
    ? ([
        ["Reference", t.referenceNo], ["GST", t.gstNote], ["Payment method", t.paymentMethod],
        ["Dispatched through", t.dispatchedThrough], ["Destination", t.destination], ["Ship to (port)", t.destinationPort],
        ["Delivery terms", t.deliveryTerms], ["Testing terms", t.testingTerms],
        ["Warranty", t.warranty], ["Test-failure cost", t.testFailureBearer],
        ["Test lab", t.labLocation], ["Packing", t.packing],
      ] as [string, string | undefined][])
    : []
  ).filter((r): r is [string, string] => !!r[1] && r[1].trim().length > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Parties">
          <Field label="Buyer (client)">{party(b.buyer)}</Field>
          <Field label="Supplier">{party(b.supplier)}</Field>
          <Field label="Masking entity">{b.maskingEntity}</Field>
          {b.supplierPoNo && <Field label="Supplier PO"><Link href="/fulfilment/supplier-pos" className="font-mono text-primary hover:underline">{b.supplierPoNo}</Link></Field>}
          <Field label="Supplier PI">
            {b.piNo ? <span className="font-mono text-foreground">{b.piNo}</span> : <span className="text-warn">awaiting PI</span>}
            <button type="button" onClick={onUploadPI} className="ml-2 text-xs font-medium text-primary hover:underline">{b.piNo ? "Replace" : "Upload PI"}</button>
          </Field>
          <Field label="Incoterm">{b.incoterm}</Field>
          <Field label="Payment mode">{b.paymentMode}{b.paymentMode === "CREDIT" && b.creditDays ? ` · ${b.creditDays} days` : ""}</Field>
          <Field label="Lead / Testing / Delivery">{b.leadTimeDays} / {b.testingTimeDays} / {b.deliveryTimeDays} d</Field>
          <Field label="Expected dispatch">{b.expectedDispatchDate}</Field>
          <Field label="Expected delivery">{b.expectedDeliveryDate}</Field>
          <Field label="Created by">{b.createdBy} · {b.createdAt}</Field>
        </Panel>
        <div className="space-y-4">
          <Panel title="Commercials">
            <Field label="Buy total (→ supplier)">{money(b.buyTotal, b.currency)}{nonUsd && <span className="ml-1 text-xs text-faint">≈ {usd(toUSD(b.buyTotal, b.currency))}</span>}</Field>
            <Field label="Sell total (client →)">{money(b.sellTotal, b.currency)}{nonUsd && <span className="ml-1 text-xs text-faint">≈ {usd(toUSD(b.sellTotal, b.currency))}</span>}</Field>
            <Field label="Margin">{money(b.sellTotal - b.buyTotal, b.currency)} · {b.sellTotal > 0 ? Math.round(((b.sellTotal - b.buyTotal) / b.sellTotal) * 100) : 0}%</Field>
            {!!b.relabelCost && <Field label="Relabelling cost (hub)">{money(b.relabelCost, b.currency)} <span className="text-xs text-faint">(landed cost)</span></Field>}
            <Field label="Relabelled to 1Buy">{b.relabelledAt ? <span className="text-ok">{b.relabelledAt}</span> : <span className="text-faint">not yet</span>}</Field>
            <Field label="Currency">{b.currency} <span className="text-xs text-faint">(USD canonical)</span></Field>
          </Panel>
          <Panel title="Where we are">
            <div className="mb-2"><Progress value={pct} /></div>
            <p className="text-sm text-muted-foreground">{current ? <>Next: <b className="text-foreground">{current.name}</b> ({current.owner}){current.isGate && " — gate."}</> : "Order complete."}</p>
          </Panel>
        </div>
      </div>
      {termRows.length > 0 && (
        <Panel title="PO terms — payment · logistics · testing">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {termRows.map(([k, v]) => <Field key={k} label={k}>{v}</Field>)}
          </div>
        </Panel>
      )}
      {(b.hubAddress || b.buyerAddress) && (
        <Panel title="Delivery — inbound & outbound">
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Field label="Inbound → 1Buy hub">{fmtAddress(b.hubAddress) || "—"}</Field>
            <Field label="Outbound → buyer">{fmtAddress(b.buyerAddress) || "—"}</Field>
          </div>
        </Panel>
      )}
      {!!b.termsConditions?.length && (
        <Panel title="Terms & Conditions">
          <ul className="space-y-1.5 text-sm">
            {b.termsConditions.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-muted-foreground">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function LinesTab({ b }: { b: OrderBundle }) {
  const cols: Col<OrderBundle["lines"][number]>[] = [
    { key: "no", header: "#", render: (l) => <span className="text-faint">{l.lineNo}</span> },
    { key: "mpn", header: "MPN", render: (l) => <span className="font-mono text-xs">{l.mpn}</span> },
    { key: "make", header: "Make", render: (l) => l.make },
    { key: "qty", header: "Qty", align: "right", render: (l) => qtyfmt(l.quantity) },
    { key: "price", header: "Unit", align: "right", render: (l) => money(l.unitPrice, l.currency) },
    { key: "hsn", header: "HSN", render: (l) => <span className="font-mono text-xs text-muted-foreground">{l.hsnCode}</span> },
    { key: "test", header: "Testing", render: (l) => <Pill tone={l.testingMode === "NONE" ? "neutral" : "info"}>{l.testingMode}</Pill> },
  ];
  return <Panel title="Order lines"><DataTable columns={cols} rows={b.lines} /></Panel>;
}

function AllocationsTab({ b, onMap }: { b: OrderBundle; onMap: (line: OrderBundle["lines"][number]) => void }) {
  const cols: Col<OrderBundle["sourcingAllocations"][number]>[] = [
    { key: "cpo", header: "Client PO", render: (a) => <span className="font-mono text-xs">{a.clientPoNo}</span> },
    { key: "cl", header: "Client line", render: (a) => <span className="font-mono text-xs">{a.clientLineMpn}</span> },
    { key: "ol", header: "Order line", render: (a) => <span className="font-mono text-xs">{a.orderLineMpn}</span> },
    { key: "qty", header: "Qty", align: "right", render: (a) => qtyfmt(a.qty) },
    { key: "m", header: "Margin", align: "right", render: (a) => `${a.marginPct}%` },
  ];
  const anyUnmapped = b.lines.some((l) => unmappedForOrderLine(b, l) > 0);
  return (
    <div className="space-y-4">
      <Panel title="Order lines → map to client-PO demand">
        <div className="space-y-2">
          {b.lines.map((line) => {
            const mapped = mappedForOrderLine(b, line);
            const unmapped = line.quantity - mapped;
            return (
              <div key={line.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
                <span className="min-w-[140px] flex-1 font-mono text-xs">{line.mpn}</span>
                <span className="text-muted-foreground">qty <b className="text-foreground tnum">{qtyfmt(line.quantity)}</b></span>
                <span className={mapped >= line.quantity ? "text-ok" : mapped > 0 ? "text-warn" : "text-faint"}>mapped <b className="tnum">{qtyfmt(mapped)}</b></span>
                <span className="text-muted-foreground">unmapped <b className="text-foreground tnum">{qtyfmt(unmapped)}</b></span>
                {unmapped > 0 ? <Button variant="outline" onClick={() => onMap(line)}>Map →</Button> : <Pill tone="ok">fully mapped</Pill>}
              </div>
            );
          })}
        </div>
        {anyUnmapped && <p className="mt-3 text-xs text-warn">This order has unmapped quantity — map it to buyer-PO lines to complete the deal.</p>}
      </Panel>
      <Panel title="Mappings (order line → client-PO line)">
        {b.sourcingAllocations.length === 0 ? <Empty text="No mappings yet — an unlinked order. Map its lines to client-PO demand above." /> : <DataTable columns={cols} rows={b.sourcingAllocations} />}
        <p className="mt-3 text-xs text-muted-foreground">Many-to-many: a supplier line can be split across several buyer POs; a buyer line can be filled from several supplier orders.</p>
      </Panel>
    </div>
  );
}

function stepIcon(s: JourneyStep) {
  if (s.status === "DONE") return <Check className="h-4 w-4 text-ok" />;
  if (s.status === "BLOCKED") return <Ban className="h-4 w-4 text-bad" />;
  if (s.status === "IN_PROGRESS") return <CircleDot className="h-4 w-4 text-primary" />;
  return <Circle className="h-4 w-4 text-faint" />;
}

function JourneyTab({ b, id, onAdd }: { b: OrderBundle; id: string; onAdd: () => void }) {
  const advanceStep = useStore((s) => s.advanceStep);
  const markRelabelled = useStore((s) => s.markRelabelled);
  const current = b.journey.find((s) => s.status === "IN_PROGRESS" || s.status === "BLOCKED");
  const reason = current ? gateReason(b, current) : null;
  const needsRelabel = current?.phase === "RELABEL" && !b.relabelledAt;
  return (
    <Panel title="Journey — manual state machine"
      actions={<div className="flex gap-2">
        <Button variant="outline" onClick={onAdd}><Plus className="h-4 w-4" /> Add step</Button>
        {needsRelabel && <Button variant="outline" onClick={() => markRelabelled(id)}>Mark relabelled</Button>}
        <Button onClick={() => advanceStep(id)} disabled={!current || !!reason}>Mark current done</Button>
      </div>}>
      {reason && <div className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg px-3 py-2 text-xs text-warn"><Lock className="h-3.5 w-3.5" /> Gate blocked — {reason}</div>}
      {b.relabelledAt && <div className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-ok-bg px-3 py-2 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Relabelled to 1Buy on {b.relabelledAt}</div>}
      <ol className="space-y-1">
        {b.journey.map((s) => {
          const isCurrent = s.id === current?.id;
          return (
            <li key={s.id} className={cn("flex items-center gap-3 rounded-lg border p-3", isCurrent ? "border-primary bg-accent-soft/40" : s.status === "DONE" ? "opacity-80" : "")}>
              <span className="flex h-6 w-6 items-center justify-center">{stepIcon(s)}</span>
              <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wide text-faint">{s.phase}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">{s.name}{s.isGate && <Lock className="h-3 w-3 text-warn" aria-label="gate" />}</span>
                <span className="text-xs text-muted-foreground">owner: {s.owner}</span>
              </span>
              <StatusPill status={s.status} />
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function PaymentsTab({ b, id, onAdd }: { b: OrderBundle; id: string; onAdd: () => void }) {
  const setPaymentStatus = useStore((s) => s.setPaymentStatus);
  const initiatePaymentTransfer = useStore((s) => s.initiatePaymentTransfer);
  const client = b.payments.filter((p) => p.direction === "CLIENT_TO_1BUY");
  const supplier = b.payments.filter((p) => p.direction === "1BUY_TO_SUPPLIER");
  const Row = ({ p }: { p: OrderBundle["payments"][number] }) => (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0">
      <div><div className="text-sm font-medium tnum">{money(p.amount, p.currency)}</div>
        <div className="text-xs text-muted-foreground">{p.mode} · via {p.triggerDoc}{p.utr ? ` · UTR ${p.utr}` : p.providerRef ? ` · ${p.providerRef}` : ""}</div></div>
      <div className="flex items-center gap-2"><StatusPill status={p.status} />
        {p.status === "PENDING" && <Button variant="outline" onClick={() => initiatePaymentTransfer(id, p.id)}>Initiate T/T</Button>}
        {p.status !== "PAID" && <Button variant="ghost" onClick={() => setPaymentStatus(id, p.id, "PAID")}>Mark paid</Button>}</div>
    </div>
  );
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="outline" onClick={onAdd}><Plus className="h-4 w-4" /> New payment</Button></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Client → 1Buy">{client.length ? client.map((p) => <Row key={p.id} p={p} />) : <Empty text="—" />}</Panel>
        <Panel title="1Buy → Supplier">{supplier.length ? supplier.map((p) => <Row key={p.id} p={p} />) : <Empty text="—" />}</Panel>
      </div>
    </>
  );
}

const SHIP_STATUSES: ShipmentStatus[] = ["PLANNED", "DISPATCHED", "IN_TRANSIT", "AT_CUSTOMS", "ARRIVED", "DELIVERED", "CANCELLED"];

const AT_1BUY = new Set<ShipmentStatus>(["ARRIVED", "DELIVERED"]);

function fmtHop(base: number, hrs: number) {
  const d = new Date(base + hrs * 3_600_000);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// DHL-style scan history for a shipment card — a vertical timeline derived from the current status.
function TrackingTimeline({ s, isImport }: { s: OrderBundle["shipments"][number]; isImport: boolean }) {
  const hops = trackingTimeline(s.status, s.fromLocation, s.toLocation, isImport);
  if (hops.length === 0) return <p className="mt-3 text-xs text-muted-foreground">Booked — awaiting carrier pickup scan.</p>;
  const base = new Date(s.dispatchDate || s.deliveryDate || "2026-08-14T04:00:00Z").getTime();
  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tracking · {s.carrier}
        {s.awb && s.awb !== "booking…" && s.awb !== "booking failed" && <span className="font-mono text-[10px] normal-case text-faint">{s.awb}</span>}
      </div>
      <ol>
        {hops.map((h, i) => {
          const last = i === hops.length - 1;
          return (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", last ? "bg-primary ring-2 ring-primary/30" : "bg-ok")} />
                {!last && <span className="min-h-[1.75rem] w-px flex-1 bg-border" />}
              </div>
              <div className="pb-2">
                <div className={cn("text-sm text-foreground", last && "font-medium")}>{h.description}</div>
                <div className="text-xs text-muted-foreground">{h.location} · {fmtHop(base, h.hrs)} · <span className="font-mono text-[10px]">{h.status}</span></div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ShipmentsTab({ b, id, onAdd }: { b: OrderBundle; id: string; onAdd: () => void }) {
  const setShipmentStatus = useStore((s) => s.setShipmentStatus);
  const pollShipmentTracking = useStore((s) => s.pollShipmentTracking);
  const plan = incotermPlan(b.incoterm);
  const inbound = b.shipments.filter((s) => s.leg === "INBOUND");
  const atHub = inbound.some((s) => AT_1BUY.has(s.status));
  return (
    <div className="space-y-3">
      {/* Incoterm responsibility — who books the carrier for the inbound leg. */}
      <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-xs",
        plan.weBookFreight ? "border-primary/40 bg-accent-soft text-primary" : "bg-muted/30 text-muted-foreground")}>
        <span><b>Incoterm {plan.incoterm}</b> · {plan.summary}</span>
        <span className="text-faint">{b.tradeType}</span>
      </div>
      <div className="flex justify-end"><Button variant="outline" onClick={onAdd}><Plus className="h-4 w-4" /> {plan.weBookFreight ? "Book / create shipment" : "Record supplier AWB"}</Button></div>
      {b.shipments.length === 0 ? <Empty text="No shipments yet." /> : b.shipments.map((s) => {
        const trackable = s.leg === "INBOUND" && s.awb !== "booking…" && s.awb !== "booking failed" && s.status !== "DELIVERED";
        return (
        <Panel key={s.id} title={`${s.leg} · ${s.shipmentNo}`}
          actions={<div className="flex items-center gap-2">
            {trackable && <Button variant="outline" onClick={() => pollShipmentTracking(id, s.id)} className="py-1 text-xs">Refresh tracking</Button>}
            <Select value={s.status} onChange={(e) => setShipmentStatus(id, s.id, e.target.value as ShipmentStatus)} className="w-40 py-1 text-xs">{SHIP_STATUSES.map((st) => <option key={st}>{st}</option>)}</Select>
          </div>}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="AWB" value={s.awb} /><MiniStat label="Carrier" value={s.carrier} />
            <MiniStat label="Route" value={`${s.fromLocation} → ${s.toLocation}`} /><MiniStat label="Boxes / wt" value={`${s.boxCount} · ${s.grossWeightKg}kg`} />
          </div>
          {s.lastLocation && <p className="mt-2 text-xs text-muted-foreground">Currently at: <b className="text-foreground">{s.lastLocation}</b></p>}
          <div className="mt-3 flex flex-wrap gap-1.5">{s.lines.map((l, i) => <Pill key={i} tone="neutral"><span className="font-mono text-[10px]">{l.mpn}</span> ×{qtyfmt(l.qty)}</Pill>)}</div>
          <TrackingTimeline s={s} isImport={s.leg === "INBOUND" && b.tradeType === "INTERNATIONAL"} />
        </Panel>
        );
      })}
      {atHub && (
        <p className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Goods delivered to 1Buy — inbound leg complete.</p>
      )}
      <p className="text-xs text-muted-foreground">Remaining to ship: {b.lines.map((l) => `${l.mpn} ${remainingToShip(b, l.mpn)}`).join(" · ")}</p>
    </div>
  );
}

function CustomsTab({ b, onFile }: { b: OrderBundle; onFile: () => void }) {
  if (!customsApplies(b)) return <Panel title="Customs"><Empty text="No customs — domestic order with no lab-abroad testing." /></Panel>;
  // DDP: the supplier delivers duty-paid and clears India customs — 1Buy files no BoE.
  if (supplierHandlesCustoms(b)) return (
    <Panel title="Customs — handled by supplier">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <b className="text-foreground">Incoterm {b.incoterm}</b> — the supplier delivers duty-paid and clears India
        import customs. 1Buy files no Bill of Entry here; we just receive the goods at the hub.
      </div>
    </Panel>
  );
  const a19 = b.tradeType === "DOMESTIC";
  const hasInbound = b.shipments.some((s) => s.leg === "INBOUND");
  const filed = b.customs.some((c) => !!c.icegateRef);
  const filing = b.customs.some((c) => c.beNo === "filing…");
  const cols: Col<OrderBundle["customs"][number]>[] = [
    { key: "s", header: "Shipment", render: (c) => <span className="font-mono text-xs">{c.shipmentNo}</span> },
    { key: "be", header: "BE no", render: (c) => c.beNo || "—" },
    { key: "port", header: "Port", render: (c) => c.portCode ?? "—" },
    { key: "cha", header: "CHA", render: (c) => c.chaName ?? "—" },
    { key: "duty", header: "Duty", align: "right", render: (c) => money(c.totalDuty, c.currency) },
    { key: "ice", header: "ICEGATE", render: (c) => c.icegateRef ? <Pill tone="ok">filed</Pill> : <Pill tone="warn">pending</Pill> },
  ];
  return (
    <Panel title="Customs — BOE / ICEGATE" actions={<Button variant="outline" onClick={onFile} disabled={!hasInbound}><Plus className="h-4 w-4" /> File BOE</Button>}>
      <div className="mb-3 rounded-lg border border-primary/40 bg-accent-soft p-2.5 text-xs text-primary">
        <b>Incoterm {b.incoterm}</b> — 1Buy clears India import customs: our CHA files the Bill of Entry in ICEGATE and duty is assessed.
      </div>
      {!hasInbound && (
        <div className="mb-3 rounded-lg border bg-warn-bg p-2.5 text-xs text-warn">
          You need an <b>inbound shipment</b> before you can file a BOE. Open the <b>Shipments</b> tab → <b>Create shipment</b> → leg <b>INBOUND</b> (books or records an AWB), then come back here and <b>File BOE</b>.
        </div>
      )}
      {b.customs.length === 0 ? <Empty text="No customs entries yet — file a BOE against an inbound shipment." /> : <DataTable columns={cols} rows={b.customs} />}
      {filing && <p className="mt-3 text-xs text-muted-foreground">Filing with ICEGATE… assessment + clearance in progress (watch the Integrations console).</p>}
      {filed && <p className="mt-3 inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> ICEGATE ref received — the “Customs — BOE filed in ICEGATE” gate is satisfied. Go to Journey → Advance.</p>}
      {a19 && <p className="mt-3 text-xs text-warn">Domestic order, but testing uses a lab abroad — customs applies on export &amp; re-import (A19).</p>}
      <p className="mt-3 text-xs text-muted-foreground">The import/FEMA loop closes when the BOE is filed in ICEGATE.</p>
    </Panel>
  );
}

function DeliveryTab({ b, id, onAllocate }: { b: OrderBundle; id: string; onAllocate: () => void }) {
  const recordPoD = useStore((s) => s.recordPoD);
  const generateEInvoice = useStore((s) => s.generateEInvoice);
  const cols: Col<OrderBundle["deliveries"][number]>[] = [
    { key: "from", header: "From shipment", render: (d) => <span className="font-mono text-xs">{d.fromShipmentNo}</span> },
    { key: "cpo", header: "Client PO", render: (d) => d.clientPoNo },
    { key: "mpn", header: "Line", render: (d) => <span className="font-mono text-xs">{d.clientLineMpn}</span> },
    { key: "qty", header: "Qty", align: "right", render: (d) => qtyfmt(d.qty) },
    { key: "pod", header: "PoD", render: (d) => d.pod ? <Pill tone="ok">captured</Pill> : <Button variant="outline" onClick={() => recordPoD(id, d.id)}>Record PoD</Button> },
  ];
  return (
    <Panel title="Delivery — who gets what" actions={<Button variant="outline" onClick={onAllocate}><Plus className="h-4 w-4" /> Allocate</Button>}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2.5 text-sm">
        <span className="text-muted-foreground">
          {b.einvoice
            ? <>GST e-Invoice <Pill tone="ok">IRN</Pill> <span className="font-mono text-xs text-foreground">ack {b.einvoice.ackNo}</span> · {b.einvoice.supplyType}</>
            : "GST e-Invoice not generated — required on the client tax invoice at dispatch."}
        </span>
        {!b.einvoice && <Button variant="outline" onClick={() => generateEInvoice(id)}>Generate e-Invoice (IRN)</Button>}
      </div>
      {b.deliveries.length === 0 ? <Empty text="No allocations yet — allocate received qty to a client PO." /> : <DataTable columns={cols} rows={b.deliveries} />}
      <p className="mt-3 text-xs text-muted-foreground">Available to allocate: {Array.from(new Set(b.shipments.flatMap((s) => s.lines).map((l) => l.mpn))).map((m) => `${m} ${remainingToAllocate(b, m)}`).join(" · ") || "—"}</p>
    </Panel>
  );
}

function DocumentsTab({ b, onUpload }: { b: OrderBundle; onUpload: () => void }) {
  const cols: Col<OrderBundle["documents"][number]>[] = [
    { key: "type", header: "Type", render: (d) => <Pill tone="info">{d.docType}</Pill> },
    { key: "file", header: "File", render: (d) => <span className="font-mono text-xs">{d.fileName}</span> },
    { key: "subj", header: "On", render: (d) => <span className="text-xs text-muted-foreground">{d.subjectType}</span> },
    { key: "by", header: "By", render: (d) => d.uploadedBy },
    { key: "at", header: "When", align: "right", render: (d) => <span className="text-xs tnum">{d.uploadedAt}</span> },
  ];
  return <Panel title="Documents — evidence vault" actions={<Button variant="outline" onClick={onUpload}><Upload className="h-4 w-4" /> Upload</Button>}><DataTable columns={cols} rows={b.documents} empty="No documents yet." /></Panel>;
}

function EventsTab({ b, onAdd }: { b: OrderBundle; onAdd: () => void }) {
  return (
    <Panel title="Events — supplier updates & delays" actions={<Button variant="outline" onClick={onAdd}><Plus className="h-4 w-4" /> Log event</Button>}>
      {b.events.length === 0 ? <Empty text="No events yet." /> : (
        <ol className="space-y-3">
          {b.events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
              <div>
                <div className="flex items-center gap-2 text-sm"><Pill tone={e.eventType === "DELAY" ? "warn" : "neutral"}>{e.eventType.replace(/_/g, " ")}</Pill><span className="text-xs text-faint tnum">{e.occurredAt}</span></div>
                <p className="text-sm">{e.message}</p><p className="text-xs text-muted-foreground">{e.recordedBy} · {e.source}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ApprovalsTab({ b, id }: { b: OrderBundle; id: string }) {
  const decideApproval = useStore((s) => s.decideApproval);
  if (b.approvals.length === 0) return <Panel title="Approvals"><Empty text="No approvals for this order." /></Panel>;
  return (
    <Panel title="Approvals">
      <div className="space-y-2">
        {b.approvals.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4 text-faint" /> {a.kind.replace(/_/g, " ")}</div>
              <div className="text-xs text-muted-foreground">role: {a.role}{a.notes ? ` · ${a.notes}` : ""}{a.decidedBy ? ` · by ${a.decidedBy}` : ""}</div>
            </div>
            {a.status === "PENDING" ? (
              <div className="flex gap-2"><Button variant="outline" onClick={() => decideApproval(id, a.id, "REJECTED")}>Reject</Button><Button onClick={() => decideApproval(id, a.id, "APPROVED")}>Approve</Button></div>
            ) : <StatusPill status={a.status} />}
          </div>
        ))}
      </div>
    </Panel>
  );
}
