"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Ban, Check, ChevronDown, ChevronRight, CircleDot, Clock, FileText,
  FlaskConical, Landmark, Lock, Package, PackageCheck, Receipt, Stamp, Truck, Users, Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { OrderBundle, JourneyPhase, JourneyStep } from "@/types";
import { ESCROW_STATUS_ORDER, prettyStatus, type Tone } from "@/data/enums";
import { Pill, StatusPill, Progress, Field, DataTable, Notice, type Col } from "@/components/ui/primitives";
import { TestingStageBar } from "@/components/order/testing-stages";
import { PhaseTimelineList } from "@/components/order/phase-timeline";
import { LotFeeCell } from "@/components/order/test-tables";
import { LotReadOnlyDetail } from "@/components/order/testing-readonly";
import { useStore } from "@/store/store";
import { useRole } from "@/lib/role";
import {
  journeyPct, gateReason, customsApplies, remainingToShip, remainingToAllocate,
  mappedForOrderLine, lotResults, lotStageProgress, labFeeOutstandingTotal, remainingToShipLeg,
  escrowStatusIndex, escrowInvoiceTotals, escrowReleaseReadiness, escrowMilestoneTriggerMet,
  escrowFeeReconciliation, currentReport,
} from "@/store/selectors";
import { incotermPlan, supplierHandlesCustoms } from "@/lib/incoterm";
import { shipmentStage, STAGE_META } from "@/lib/shipment-stage";
import { money, qtyfmt, cn, fmtAddress } from "@/lib/utils";
import { usd, toUSD } from "@/lib/fx";

/**
 * One order, one page, top to bottom in the order things actually happen: the deal, the demand
 * it serves, the money, testing, logistics (**both** legs — inbound and outbound — in one
 * section), customs, the warehouse, and the evidence/history behind all of it.
 *
 * Two sections that used to exist here don't any more (both 2026-08-20): **Approvals**, which is
 * read on the Approvals board instead, and **Delivery**, which was folded into Logistics as its
 * outbound block — dispatching to the client *is* the outbound leg, so its shipment, e-invoice,
 * allocation and PoD all belong to it. Don't split them back out.
 *
 * This is a **reading** page — the dashboard's orders link here rather than into the tabbed
 * workspace, because "what is happening on this order" is a different question from "let me
 * change something on this order", and answering the first shouldn't take twelve tab clicks.
 * The page carries **no outbound navigation at all**: the per-section "go to the board" links
 * were removed 2026-08-20 along with `FlowSection`'s `action` slot, so reading an order never
 * doors into a surface that acts on it. The only links left are the Orders Overview breadcrumb
 * and the sticky in-page section rail. Nothing here mutates state.
 *
 * Each section is keyed to the journey phase(s) that own it, so its heading carries that
 * phase's real state (done / in progress / blocked, with the gate reason) instead of a
 * decorative step number.
 */

// ---------- shells ----------

/**
 * The page's sections, in the order they render — each with the same icon its section heading
 * uses, and where the section maps to a sidebar board the icon is **that menu item's icon**
 * (`NAV_GROUPS` in data/enums.ts): Logistics → Truck, Customs → Stamp, Warehouse → Warehouse,
 * Testing → FlaskConical, Money → Landmark (Escrow), Deal → Users (Directory). Delivery has no
 * menu item of its own, so it takes `PackageCheck` rather than re-using Logistics' Truck. Single source of truth for the rail below: adding or removing a section means editing
 * this list, not starting a second one.
 *
 * Deliberately state-free. Chips painted with each phase's status (green/red tones, ✓/lock
 * glyphs) were tried and cut 2026-08-20 — the rail is navigation, and the status already reads
 * off the journey rail above it and off every section's own heading pill.
 */
const JUMP: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "deal", label: "Deal", icon: Users },
  { id: "demand", label: "Demand", icon: Package },
  { id: "money", label: "Money", icon: Landmark },
  { id: "testing", label: "Testing", icon: FlaskConical },
  { id: "logistics", label: "Logistics", icon: Truck },
  { id: "customs", label: "Customs", icon: Stamp },
  { id: "warehouse", label: "Warehouse", icon: Warehouse },
  { id: "evidence", label: "Evidence", icon: FileText },
];
function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">{text}</div>;
}

/** The state of one phase of the journey, as the section heading should report it. */
function phaseState(
  steps: JourneyStep[], currentId: string | undefined, reason: string | null,
): { tone: Tone; label: string } {
  if (steps.length === 0) return { tone: "info", label: "reference" };
  if (steps.every((s) => s.status === "DONE")) return { tone: "ok", label: "done" };
  if (currentId && steps.some((s) => s.id === currentId)) {
    return reason ? { tone: "bad", label: "blocked" } : { tone: "active", label: "in progress" };
  }
  if (steps.some((s) => s.status === "DONE")) return { tone: "warn", label: "part done" };
  return { tone: "neutral", label: "not started" };
}

/**
 * The section rail — this page is long by design, so its table of contents is **sticky** and
 * stays on screen the whole way down. `top-14` (56px) is deliberately a few px *less* than the
 * app header's measured 59px height so the rail's own top edge tucks under it (header is `z-20`,
 * the rail `z-10`): erring the other way leaves a sliver of scrolling content showing through
 * the gap. Sections carry `scroll-mt-32` to clear both bars when jumped to.
 *
 * It is navigation and nothing else — every chip looks the same, and the only chip that stands
 * out is the section you are actually reading, tracked by an IntersectionObserver over the
 * section elements rather than by scroll maths. Don't colour the chips by phase state or hang
 * ✓/lock glyphs off them: that was tried and cut, because the journey rail directly above and
 * each section's own heading pill already report exactly that.
 */
function SectionRail() {
  const [active, setActive] = useState<string>(JUMP[0].id);

  useEffect(() => {
    const els = JUMP.map((j) => document.getElementById(j.id)).filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const onScreen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onScreen.add(e.target.id);
          else onScreen.delete(e.target.id);
        }
        // the topmost section still in the band is the one being read
        const first = JUMP.find((j) => onScreen.has(j.id));
        if (first) setActive(first.id);
      },
      // band = just under the sticky chrome down to a bit past the middle of the viewport
      { rootMargin: "-150px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const jump = (e: React.MouseEvent, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  };

  return (
    <nav aria-label="Sections of this order"
      className="sticky top-14 z-10 rounded-[var(--radius)] border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex items-center gap-3">
        <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-faint sm:block">
          Sections
        </span>
        <div className="no-scrollbar -my-1 flex flex-1 items-center gap-1.5 overflow-x-auto py-1">
          {JUMP.map(({ id, label, icon: Icon }) => {
            const isActive = id === active;
            return (
              <a key={id} href={`#${id}`} onClick={(e) => jump(e, id)}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:border-primary hover:bg-accent-soft hover:text-primary",
                )}>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{label}</span>
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function FlowSection({
  id, title, hint, icon, steps, currentId, reason, children,
}: {
  id: string;
  title: string;
  hint: string;
  icon: React.ReactNode;
  steps: JourneyStep[];
  currentId?: string;
  reason: string | null;
  children: React.ReactNode;
}) {
  const st = phaseState(steps, currentId, reason);
  const blocked = st.label === "blocked";
  return (
    <section id={id} className="scroll-mt-32 rounded-[var(--radius)] border bg-card shadow-sm">
      <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3",
        blocked && "bg-bad-bg/40")}>
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="text-primary">{icon}</span>
            {title}
            <Pill tone={st.tone}>{st.label}</Pill>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          {/* the phase's own steps, so the flow reads as the journey and not as a report layout */}
          {steps.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {steps.map((s) => {
                const isCurrent = s.id === currentId;
                return (
                  <span key={s.id} className={cn("inline-flex items-center gap-1",
                    s.status === "DONE" ? "text-ok"
                      : isCurrent && reason ? "text-bad"
                      : isCurrent ? "text-primary"
                      : "text-faint")}>
                    {s.status === "DONE" ? <Check className="h-3 w-3" />
                      : isCurrent && reason ? <Ban className="h-3 w-3" />
                      : isCurrent ? <CircleDot className="h-3 w-3" />
                      : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    {s.name}
                    {s.isGate && <Lock className="h-2.5 w-2.5 text-warn" aria-label="gate" />}
                    <span className="text-faint">· {s.owner}</span>
                  </span>
                );
              })}
            </div>
          )}
          {blocked && reason && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-bad">
              <Lock className="h-3 w-3" /> Gate blocked — {reason}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold tnum", color)}>{value}</div>
      {sub && <div className="text-[11px] text-faint tnum">{sub}</div>}
    </div>
  );
}

/** Two-column grid of Fields — the shape most of these sections want. */
function Facts({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{children}</div>;
}

// ---------- the page ----------

export function OrderFlowPage({ id }: { id: string }) {
  const b = useStore((s) => s.orders[id]);
  const { canAccessEscrow } = useRole();

  if (!b) {
    return (
      <div className="space-y-4">
        <Link href="/fulfilment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Orders Overview
        </Link>
        <div className="rounded-[var(--radius)] border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">
          Order not found (it may have been reset).{" "}
          <Link href="/fulfilment" className="text-primary hover:underline">Back to Orders Overview</Link>.
        </div>
      </div>
    );
  }

  const current = b.journey.find((s) => s.status === "IN_PROGRESS" || s.status === "BLOCKED");
  const reason = current ? gateReason(b, current) : null;
  const stepsOf = (...phases: JourneyPhase[]) => b.journey.filter((s) => phases.includes(s.phase));
  const pct = journeyPct(b);
  const done = b.journey.filter((s) => s.status === "DONE").length;
  const nonUsd = b.currency !== "USD";
  const plan = incotermPlan(b.incoterm);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/fulfilment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Orders Overview
        </Link>
      </div>

      {/* ---------- header: who, how much, how far ---------- */}
      <div className="rounded-[var(--radius)] border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold">{b.orderNo}</h1>
              <StatusPill status={b.status} />
              <Pill tone="info">{b.tradeType === "INTERNATIONAL" ? "International" : "Domestic"}</Pill>
              <Pill tone={b.paymentMode === "ESCROW" ? "warn" : "neutral"}>{b.paymentMode}</Pill>
              <Pill tone="neutral">{b.incoterm}</Pill>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {b.buyer.name} <span className="text-faint">(client)</span> <ChevronRight className="inline h-3 w-3" />{" "}
              {b.maskingEntity} <ChevronRight className="inline h-3 w-3" /> {b.supplier.name} <span className="text-faint">(supplier)</span>
            </p>
            <p className="mt-0.5 text-xs text-faint">
              The whole fulfilment flow on one page — read-only. Use the section rail below to jump straight to a phase.
            </p>
          </div>
          <div className="grid w-full max-w-md grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Buy" value={money(b.buyTotal, b.currency)} sub={nonUsd ? `≈ ${usd(toUSD(b.buyTotal, b.currency))}` : undefined} />
            <MiniStat label="Sell" value={money(b.sellTotal, b.currency)} sub={nonUsd ? `≈ ${usd(toUSD(b.sellTotal, b.currency))}` : undefined} />
            <MiniStat label="Margin" value={`${b.sellTotal > 0 ? Math.round(((b.sellTotal - b.buyTotal) / b.sellTotal) * 100) : 0}%`} sub={money(b.sellTotal - b.buyTotal, b.currency)} />
            <MiniStat label="Required by" value={b.requiredBy} />
          </div>
        </div>

        {/* journey rail — the spine of everything below */}
        <div className="mt-4">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Journey · {done}/{b.journey.length} steps</span>
            {b.status === "CANCELLED" ? (
              <span className="inline-flex items-center gap-1 font-medium text-bad"><Ban className="h-3.5 w-3.5" /> Cancelled</span>
            ) : current ? (
              <span className="inline-flex items-center gap-1">
                {current.isGate && <Lock className="h-3 w-3 text-warn" />} at: <b className="text-foreground">{current.name}</b>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="h-3.5 w-3.5" /> Complete</span>
            )}
          </div>
          <Progress value={pct} />
          {reason && <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-warn"><Lock className="h-3 w-3" /> Gate blocked — {reason}</p>}
          <ol className="no-scrollbar mt-3 flex items-start gap-0 overflow-x-auto pb-1">
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
      </div>

      <SectionRail />

      <TimelineSection b={b} />
      <DealSection b={b} steps={stepsOf("KICKOFF")} currentId={current?.id} reason={reason} />
      <DemandSection b={b} reason={reason} />
      <MoneySection b={b} steps={stepsOf("PAYMENT")} currentId={current?.id} reason={reason} canAccessEscrow={canAccessEscrow} />
      <TestingSection b={b} id={id} steps={stepsOf("TESTING")} currentId={current?.id} reason={reason} />
      <LogisticsSection b={b} steps={stepsOf("EXPORT", "IMPORT", "DELIVERY")} currentId={current?.id} reason={reason} />
      <CustomsSection b={b} steps={stepsOf("CUSTOMS")} currentId={current?.id} reason={reason} />
      <WarehouseSection b={b} steps={stepsOf("RELABEL")} currentId={current?.id} reason={reason} />
      <EvidenceSection b={b} reason={reason} />

      <p className="pb-2 text-center text-xs text-faint">
        Incoterm {plan.incoterm} · {plan.summary}
      </p>
    </div>
  );
}

// ---------- 0 · timeline ----------

function TimelineSection({ b }: { b: OrderBundle }) {
  return (
    <FlowSection id="timeline" title="Timeline — 6-phase fulfilment clock"
      hint="Estimated vs. actual for every phase, and where a delay sits on 1Buy's own side."
      icon={<Clock className="h-4 w-4" />} steps={[]} reason={null}>
      <PhaseTimelineList b={b} />
    </FlowSection>
  );
}

// ---------- 1 · the deal ----------

function DealSection({
  b, steps, currentId, reason,
}: { b: OrderBundle; steps: JourneyStep[]; currentId?: string; reason: string | null }) {
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
  const party = (p: OrderBundle["buyer"]) => [p.name, p.country, p.gstin, p.state].filter(Boolean).join(" · ");

  return (
    <FlowSection id="deal" title="The deal" hint="Parties, paperwork and the terms everything below is measured against."
      icon={<Users className="h-4 w-4" />} steps={steps} currentId={currentId} reason={reason}>
      <Facts>
        <Field label="Buyer (client)">{party(b.buyer)}</Field>
        <Field label="Supplier">{party(b.supplier)}</Field>
        <Field label="Masking entity">{b.maskingEntity}</Field>
        <Field label="Purchase Order">{b.supplierPoNo ? <span className="font-mono">{b.supplierPoNo}</span> : "—"}</Field>
        <Field label="Supplier PI">{b.piNo ? <span className="font-mono">{b.piNo}</span> : <span className="text-warn">awaiting PI</span>}</Field>
        <Field label="Payment mode">{b.paymentMode}{b.paymentMode === "CREDIT" && b.creditDays ? ` · ${b.creditDays} days` : ""}</Field>
        <Field label="Lead / testing / delivery">{b.leadTimeDays} / {b.testingTimeDays} / {b.deliveryTimeDays} d</Field>
        <Field label="Expected dispatch → delivery">{b.expectedDispatchDate} → {b.expectedDeliveryDate}</Field>
        <Field label="Currency">{b.currency} <span className="text-xs text-faint">(USD canonical)</span></Field>
        <Field label="Created">{b.createdBy} · {b.createdAt}</Field>
      </Facts>

      {(b.hubAddress || b.buyerAddress) && (
        <Facts>
          <Field label="Inbound → 1Buy warehouse">{fmtAddress(b.hubAddress) || "—"}</Field>
          <Field label="Outbound → buyer">{fmtAddress(b.buyerAddress) || "—"}</Field>
        </Facts>
      )}

      {termRows.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">PO terms</div>
          <Facts>{termRows.map(([k, v]) => <Field key={k} label={k}>{v}</Field>)}</Facts>
        </div>
      )}

      {!!b.termsConditions?.length && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Terms &amp; conditions</div>
          <ul className="space-y-1 text-sm">
            {b.termsConditions.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-muted-foreground">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /><span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FlowSection>
  );
}

// ---------- 2 · demand this order serves ----------

function DemandSection({ b, reason }: { b: OrderBundle; reason: string | null }) {
  const lineCols: Col<OrderBundle["lines"][number]>[] = [
    { key: "no", header: "#", render: (l) => <span className="text-faint">{l.lineNo}</span> },
    { key: "mpn", header: "MPN", render: (l) => <span className="font-mono text-xs">{l.mpn}</span> },
    { key: "make", header: "Make", render: (l) => l.make },
    { key: "qty", header: "Qty", align: "right", render: (l) => qtyfmt(l.quantity) },
    { key: "price", header: "Unit", align: "right", render: (l) => money(l.unitPrice, l.currency) },
    { key: "test", header: "Testing", render: (l) => <Pill tone={l.testingMode === "NONE" ? "neutral" : "info"}>{l.testingMode}</Pill> },
    { key: "map", header: "Mapped to demand", align: "right", render: (l) => {
      const mapped = mappedForOrderLine(b, l);
      return (
        <span className={mapped >= l.quantity ? "text-ok" : mapped > 0 ? "text-warn" : "text-faint"}>
          {qtyfmt(mapped)} / {qtyfmt(l.quantity)}
        </span>
      );
    } },
  ];
  const allocCols: Col<OrderBundle["sourcingAllocations"][number]>[] = [
    { key: "cpo", header: "Sales Order", render: (a) => <span className="font-mono text-xs">{a.clientPoNo}</span> },
    { key: "cl", header: "Client line", render: (a) => <span className="font-mono text-xs">{a.clientLineMpn}</span> },
    { key: "ol", header: "Order line", render: (a) => <span className="font-mono text-xs">{a.orderLineMpn}</span> },
    { key: "qty", header: "Qty", align: "right", render: (a) => qtyfmt(a.qty) },
    { key: "m", header: "Margin", align: "right", render: (a) => `${a.marginPct}%` },
  ];
  const clientPos = Array.from(new Set(b.sourcingAllocations.map((a) => a.clientPoNo)));
  const unmapped = b.lines.reduce((s, l) => s + Math.max(0, l.quantity - mappedForOrderLine(b, l)), 0);

  return (
    <FlowSection id="demand" title="Demand it serves" hint="What we bought, and which sales-order lines it was bought for (N:N — one order can serve several clients)."
      icon={<Package className="h-4 w-4" />} steps={[]} reason={reason}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Serving</span>
        {clientPos.length === 0 ? <Pill tone="warn">unlinked — no sales order mapped</Pill>
          : clientPos.map((p) => <Pill key={p} tone="info"><span className="font-mono">{p}</span></Pill>)}
        {unmapped > 0 && <span className="text-warn">{qtyfmt(unmapped)} pcs still unmapped</span>}
      </div>
      <DataTable columns={lineCols} rows={b.lines} empty="No order lines." />
      {b.sourcingAllocations.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mappings — order line → sales-order line</div>
          <DataTable columns={allocCols} rows={b.sourcingAllocations} />
        </div>
      )}
    </FlowSection>
  );
}

// ---------- 3 · money ----------

function MoneySection({
  b, steps, currentId, reason, canAccessEscrow,
}: { b: OrderBundle; steps: JourneyStep[]; currentId?: string; reason: string | null; canAccessEscrow: boolean }) {
  const e = b.escrow;
  const readiness = e ? escrowReleaseReadiness(b) : null;
  const totals = e?.invoice ? escrowInvoiceTotals(e.invoice.fees) : null;
  const feeRec = escrowFeeReconciliation(b);
  const payCols: Col<OrderBundle["payments"][number]>[] = [
    { key: "dir", header: "Direction", render: (p) => <Pill tone={p.direction === "CLIENT_TO_1BUY" ? "info" : "neutral"}>{p.direction === "CLIENT_TO_1BUY" ? "client → 1Buy" : "1Buy → supplier"}</Pill> },
    { key: "amt", header: "Amount", align: "right", render: (p) => money(p.amount, p.currency) },
    { key: "mode", header: "Mode", render: (p) => <span className="text-xs">{p.mode} · via {p.triggerDoc}</span> },
    { key: "ref", header: "Reference", render: (p) => <span className="font-mono text-xs text-muted-foreground">{p.utr ?? p.providerRef ?? "—"}</span> },
    { key: "st", header: "Status", render: (p) => <StatusPill status={p.status} /> },
  ];

  return (
    <FlowSection id="money" title="Money" hint={e ? "Escrow holds the buyer's funds; tranches release as their triggers are met." : "Direct payment — no escrow on this order."}
      icon={<Landmark className="h-4 w-4" />} steps={steps} currentId={currentId} reason={reason}>

      {e ? (
        <>
          {/* the 8-stage escrow chain, compact */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Escrow · <b className="text-foreground">{prettyStatus(e.status)}</b></span>
              {e.cancelledAt
                ? <Pill tone="bad"><Ban className="h-3 w-3" /> cancelled {e.cancelledAt}</Pill>
                : readiness && (readiness.ready
                  ? <Pill tone="ok"><Check className="h-3 w-3" /> release condition met</Pill>
                  : <Pill tone="warn">not releasable yet</Pill>)}
            </div>
            <ol className="no-scrollbar flex items-start gap-0 overflow-x-auto pb-1">
              {ESCROW_STATUS_ORDER.map((s, i) => {
                const idx = escrowStatusIndex(e.status);
                const isDone = i < idx;
                const isCurrent = i === idx;
                return (
                  <li key={s} className="flex min-w-[104px] flex-1 flex-col items-center">
                    <div className="flex w-full items-center">
                      <span className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : isDone ? "bg-primary" : "bg-border")} />
                      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold",
                        isDone ? "border-primary bg-primary text-primary-foreground"
                          : isCurrent ? "border-primary text-primary ring-2 ring-accent-soft" : "border-border text-faint")}>
                        {isDone ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className={cn("h-0.5 flex-1", i === ESCROW_STATUS_ORDER.length - 1 ? "opacity-0" : isDone ? "bg-primary" : "bg-border")} />
                    </div>
                    <span className={cn("mt-1 px-1 text-center text-[10px] leading-tight", isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {prettyStatus(s)}
                    </span>
                  </li>
                );
              })}
            </ol>
            {readiness && !readiness.ready && <p className="mt-1.5 text-xs text-warn">{readiness.reason}</p>}
          </div>

          {/* release tranches: what fires when, and where each one stands */}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Release milestones</div>
            {!e.invoice?.conditions.releaseMilestones?.length ? (
              <Empty text="No milestones on file yet — they arrive on the provider's invoice." />
            ) : (
              <ul className="space-y-1.5">
                {e.invoice.conditions.releaseMilestones.map((m, i) => {
                  const rel = e.milestoneReleases.find((r) => r.index === i);
                  const met = escrowMilestoneTriggerMet(b, m.trigger);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2.5 text-xs">
                      <span className="font-semibold tnum">{m.percent}%</span>
                      {canAccessEscrow && <span className="tnum text-muted-foreground">{money((e.poAmount * m.percent) / 100, e.currency)}</span>}
                      <span className="min-w-0 flex-1 text-muted-foreground">on: {m.trigger}</span>
                      {rel?.confirmedAt ? <Pill tone="ok"><Check className="h-3 w-3" /> released {rel.confirmedAt}</Pill>
                        : rel ? <Pill tone="active">instructed {rel.instructedAt}</Pill>
                        : met ? <Pill tone="warn">trigger met — not instructed</Pill>
                        : <Pill tone="neutral">waiting on trigger</Pill>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* the escrow's own signals, which are not the testing module's */}
          <Facts>
            <Field label="Goods received at warehouse">{e.goodsReceivedAt ?? <span className="text-faint">not yet</span>}</Field>
            <Field label="WHL verdict (escrow-side)">
              {e.whlVerdict ? <Pill tone={e.whlVerdict === "PASS" ? "ok" : "bad"}>{e.whlVerdict}</Pill> : <span className="text-faint">none recorded</span>}
              {e.whlVerdictAt ? <span className="ml-1 text-xs text-faint">{e.whlVerdictAt}</span> : null}
            </Field>
            <Field label="Payment instructed → confirmed">
              {e.paymentInstructedAt ?? "—"} → {e.financeConfirmedAt ?? "—"}
            </Field>
            <Field label="SWIFT reference">{e.financeSwiftReference ? <span className="font-mono text-xs">{e.financeSwiftReference}</span> : "—"}</Field>
            {e.refundRequestedAt && <Field label="Refund requested">{e.refundRequestedAt}</Field>}
            {e.refundInstructedAt && <Field label="Refund instructed">{e.refundInstructedAt}</Field>}
          </Facts>

          {/* amounts are Supply Chain's business — the persona gate is the same one the board uses */}
          {canAccessEscrow ? (
            <Facts>
              <Field label="Under escrow (PO amount)">{money(e.poAmount, e.currency)}</Field>
              <Field label="Provider invoice">{e.invoice ? <span className="font-mono text-xs">{e.invoice.invoiceNo}</span> : <span className="text-warn">awaited</span>}</Field>
              {totals && <Field label="Buyer T/T total">{money(totals.totalBuyerTT, e.currency)}</Field>}
              {totals && <Field label="Disbursed to seller">{money(totals.totalDisbursedToSeller, e.currency)}</Field>}
              {totals && <Field label="Fees">{money(totals.totalFees, e.currency)}</Field>}
              {feeRec && (
                <Field label="Fee vs agreed at PO time">
                  {money(feeRec.invoiceFee, e.currency)} vs {money(feeRec.agreedFee, e.currency)}{" "}
                  {feeRec.match ? <Pill tone="ok">matches</Pill> : <Pill tone="bad">mismatch</Pill>}
                </Field>
              )}
              {e.invoice && <Field label="Ship within / inspection">{e.invoice.conditions.shipWithinDays} / {e.invoice.conditions.inspectionPeriod}</Field>}
              {e.invoice && <Field label="Fee sharing">{e.invoice.conditions.feeSharingLabel}</Field>}
              {e.invoice && <Field label="Forwarder">{e.invoice.conditions.forwarder}</Field>}
            </Facts>
          ) : (
            <p className="inline-flex items-start gap-1.5 rounded-lg border bg-muted/30 p-2.5 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              Escrow amounts, fees and wire details are SC-only — switch persona to see them on the escrow board.
              The status, triggers and release state above are visible to everyone because the rest of the flow depends on them.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No escrow on this order — the PAYMENT gate opens on a supplier payment being initiated instead.
        </p>
      )}

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payments</div>
        <DataTable columns={payCols} rows={b.payments} empty="No payments recorded." />
      </div>
    </FlowSection>
  );
}

// ---------- 4 · testing ----------

function TestingSection({
  b, id, steps, currentId, reason,
}: { b: OrderBundle; id: string; steps: JourneyStep[]; currentId?: string; reason: string | null }) {
  const [open, setOpen] = useState<string | null>(null);   // test slot whose result is expanded

  const rows = lotResults(b);
  const fees = labFeeOutstandingTotal(b);
  const testable = b.lines.filter((l) => l.testingMode !== "NONE");
  const reportsOnFile = b.lots.flatMap((l) => l.reports ?? []);
  /*
   * Counted by **test slot**, never by test.
   *
   * This used to be seven tiles — lots, tests tracked, passed n/m, still open, F.A.R., not
   * acceptable, reports — which is a per-test breakdown of the whole order added together. On a
   * reading page that is the wrong altitude twice over: the numbers belong to different slots that
   * were never one batch, and nobody scanning an order needs the test-level tally to know where it
   * stands. Five facts do: how many submissions there are, how they came out, and how far along
   * they are.
   */
  const total = b.lots.length;
  const passed = b.lots.filter((l) => l.testStatus === "PASS").length;
  const failed = b.lots.filter((l) => l.testStatus === "FAIL").length;
  const completed = b.lots.filter((l) => lotStageProgress(l).complete).length;

  return (
    <FlowSection id="testing" title="Testing" hint={testable.length === 0
      ? "No line on this order needs incoming testing, so the testing gate is vacuous."
      : `${testable.length} of ${b.lines.length} line(s) need testing — every one needs a PASS before the money and the goods move on.`}
      icon={<FlaskConical className="h-4 w-4" />} steps={steps} currentId={currentId} reason={reason}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="Test slots" value={String(total)} />
        <MiniStat label="Passed" value={String(passed)} tone={total > 0 && passed === total ? "ok" : undefined} />
        <MiniStat label="Failed" value={String(failed)} tone={failed ? "bad" : undefined} />
        <MiniStat label="Completed" value={`${completed}/${total}`} tone={total > 0 && completed === total ? "ok" : undefined} />
        <MiniStat label="In progress" value={`${total - completed}/${total}`} tone={total - completed > 0 ? "warn" : undefined} />
      </div>

      {fees.count > 0 && (
        <Notice tone={fees.blocking.length > 0 ? "bad" : "warn"}
          icon={fees.blocking.length > 0 ? <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Receipt className="mt-0.5 h-3.5 w-3.5 shrink-0" />}>
          {fees.count} WHL invoice(s) unpaid — {fees.currency} {fees.gross.toLocaleString()} owed
          {fees.blocking.length > 0
            ? `; ${fees.blocking.join(", ")} held at the lab on advance terms, so testing hasn't started.`
            : " on credit terms, so nothing is blocked."}
        </Notice>
      )}

      {/* report-level roll-up: what's actually on file, and anything flagged on it */}
      {reportsOnFile.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card-2 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Reports on file
          </span>
          {reportsOnFile.filter((r) => r.current).map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5">
              <span className="font-mono">{r.reportNo}</span>
              <Pill tone={r.conclusion === "ACCEPTABLE" ? "ok" : "bad"}>{r.conclusion.replace(/_/g, " ")}</Pill>
              {r.anyFar && <Pill tone="warn">F.A.R.</Pill>}
              {r.parseFlags.length > 0 && <span className="text-warn">{r.parseFlags.length} flag(s)</span>}
            </span>
          ))}
          <span className="text-faint">open a test slot below to read a report and download it</span>
        </div>
      )}

      {b.lots.length === 0 ? (
        <Empty text={testable.length === 0 ? "Nothing to test." : "No lots yet — testing hasn't been started for these lines."} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-card-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">Test slot</th>
                  <th className="px-3 py-2 text-left">MPN</th>
                  <th className="px-3 py-2 text-left">Verdict</th>
                  <th className="px-3 py-2 text-left">Tests</th>
                  <th className="px-3 py-2 text-left">Lab fee</th>
                  <th className="px-3 py-2 text-left">Report</th>
                  <th className="px-3 py-2 text-left">Outstanding</th>
                  <th className="px-3 py-2 text-left">Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rep = currentReport(r.lot);
                  const isOpen = open === r.lot.id;
                  return (
                    <Fragment key={r.lot.id}>
                      <tr onClick={() => setOpen(isOpen ? null : r.lot.id)}
                        title={isOpen ? "Hide this lot" : "Open this lot — its lifecycle and its report, with a download"}
                        className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/60", isOpen && "bg-accent-soft/60")}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 font-medium">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            {r.lot.lotCode}
                          </div>
                          <div className="pl-5 text-[11px] text-faint">
                            {r.lot.lab ?? "—"} · WO {r.lot.workOrderNo ?? "—"} · qty {qtyfmt(r.lot.qty)} / sample {r.lot.sampleQty}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.lot.orderLineMpn}</td>
                        <td className="px-3 py-2"><StatusPill status={r.lot.testStatus} /></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="tnum text-xs">{r.progress.settled}/{r.progress.total}</span>
                            <span className="w-16"><Progress value={r.pct} /></span>
                          </div>
                          {(r.progress.far > 0 || r.progress.failed > 0 || r.progress.notConducted > 0) && (
                            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                              {r.progress.far > 0 && <span className="text-warn">{r.progress.far} F.A.R.</span>}
                              {r.progress.failed > 0 && <span className="text-bad">{r.progress.failed} not acc.</span>}
                              {r.progress.notConducted > 0 && <span className="text-faint">{r.progress.notConducted} not cond.</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs"><LotFeeCell lot={r.lot} /></td>
                        <td className="px-3 py-2 text-xs">
                          {rep ? (
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <span className="font-mono">{rep.reportNo}</span>
                              <Pill tone={rep.conclusion === "ACCEPTABLE" ? "ok" : "bad"}>{rep.conclusion.replace(/_/g, " ")}</Pill>
                              {r.revisions > 1 && <span className="text-faint">{r.revisions} rev.</span>}
                            </span>
                          ) : <span className="text-warn">not available</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className={r.blocker ? "text-warn" : "text-ok"}>{r.blocker ?? "clear"}</span>
                          {r.overdueDays > 0 && <span className="ml-1 text-bad">· chase {r.overdueDays}d overdue</span>}
                          {r.awaiting > 0 && r.overdueDays === 0 && <span className="ml-1 text-muted-foreground">· awaiting reply</span>}
                        </td>
                        <td className="px-3 py-2"><TestingStageBar lot={r.lot} className="w-40" /></td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b bg-card-2/60 last:border-0">
                          <td colSpan={8} className="px-3 py-3">
                            <LotReadOnlyDetail orderId={id} lot={r.lot} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-faint">
            Click a test slot for its lifecycle and its report — readable on screen and downloadable. Opens and
            downloads are recorded on the report&apos;s NDA access log. The per-test tracker and the WHL thread live
            on the testing workspace.
          </p>
        </>
      )}
    </FlowSection>
  );
}

// ---------- 5 · logistics ----------

const AT_1BUY = new Set(["ARRIVED", "DELIVERED"]);

const LEG_COPY = {
  INBOUND: { label: "supplier → 1Buy warehouse", empty: "No inbound shipment booked yet." },
  OUTBOUND: { label: "1Buy warehouse → client", empty: "Nothing dispatched to the client yet." },
} as const;

/**
 * One freight leg, laid out the way the **Logistics board** lays shipments out: the board's own
 * columns (carrier · AWB · qty · tracking · stage · location · customs) off the same
 * `shipmentStage`/`STAGE_META` and the same `hasCustoms`/`needsCustoms` derivation
 * `allShipments()` applies board-side. Someone who works the board sees the same shape here.
 *
 * Two one-order adaptations: the board's `Order` column becomes the shipment no. (the order is a
 * given), and its `Leg` column is gone because the caller has already scoped the leg — **each leg
 * is rendered by the section that owns that step**, inbound under Logistics and outbound under
 * Delivery, so no movement is described twice on this page. The per-shipment detail the board
 * defers to `/logistics/shipments/[id]` (route, boxes, weight, dates, MPN lines) expands inline
 * instead, because this page never navigates out.
 */
function ShipmentTable({ b, leg }: { b: OrderBundle; leg: "INBOUND" | "OUTBOUND" }) {
  const [open, setOpen] = useState<string | null>(null);   // shipment id whose detail is expanded

  // the same enrichment `allShipments()` does board-side, for this one order's one leg
  const needsCustoms = customsApplies(b);
  const rows = b.shipments
    .filter((s) => s.leg === leg)
    .map((s) => ({
      ...s,
      hasCustoms: b.customs.some((c) => c.shipmentNo === s.shipmentNo && !!c.icegateRef),
      needsCustoms,
    }))
    .sort((x, y) => String(y.updatedAt ?? "").localeCompare(String(x.updatedAt ?? "")));   // newest activity on top

  type Row = (typeof rows)[number];
  const cols: Col<Row>[] = [
    { key: "no", header: "Shipment", render: (r) => (
      <div className="flex items-center gap-1.5">
        {open === r.id ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="font-mono text-xs font-semibold">{r.shipmentNo}</span>
      </div>
    ) },
    { key: "carrier", header: "Carrier", render: (r) => <span className="text-xs">{r.carrier}</span> },
    { key: "awb", header: "AWB", render: (r) => r.trackingUrl
      ? <a href={r.trackingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-primary hover:underline">{r.awb}</a>
      : <span className="font-mono text-xs text-muted-foreground">{r.awb}</span> },
    { key: "qty", header: "Qty", align: "right", render: (r) => qtyfmt(r.lines.reduce((a, l) => a + l.qty, 0)) },
    { key: "status", header: "Tracking", render: (r) => <StatusPill status={r.status} /> },
    { key: "stage", header: "Stage", render: (r) => { const st = shipmentStage(r); return <Pill tone={STAGE_META[st].tone}>{STAGE_META[st].label}</Pill>; } },
    { key: "loc", header: "Location", render: (r) => {
      const loc = r.lastLocation || (r.status === "PLANNED" ? r.fromLocation : "");
      return loc ? <span className="text-xs text-muted-foreground">{loc}</span> : <span className="text-xs text-faint">—</span>;
    } },
    { key: "customs", header: "Customs", render: (r) => !r.needsCustoms ? <span className="text-xs text-faint">n/a</span>
      : r.hasCustoms ? <Pill tone="ok">cleared</Pill> : <Pill tone="warn">pending</Pill> },
  ];

  return (
    <DataTable
      columns={cols} rows={rows} empty={LEG_COPY[leg].empty}
      onRowClick={(r) => setOpen(open === r.id ? null : r.id)}
      isExpanded={(r) => open === r.id}
      renderExpanded={(r) => (
          <div className="space-y-2 pt-2.5">
            <Facts>
              <Field label="Route">{r.fromLocation} → {r.toLocation}</Field>
              <Field label="Boxes / gross weight">{r.boxCount} box(es) · {r.grossWeightKg} kg</Field>
              <Field label="Dispatched">{r.dispatchDate ?? "—"}</Field>
              <Field label="Delivered">{r.deliveryDate ?? "—"}</Field>
              {r.pickupConfirmationNo && <Field label="Pickup confirmation">{r.pickupConfirmationNo}</Field>}
              {r.lastLocation && <Field label="Last carrier scan">{r.lastLocation}</Field>}
            </Facts>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lines on this shipment</div>
              <div className="flex flex-wrap gap-1.5">
                {r.lines.map((l, i) => (
                  <Pill key={i} tone="neutral"><span className="font-mono text-[10px]">{l.mpn}</span> ×{qtyfmt(l.qty)}</Pill>
                ))}
              </div>
            </div>
          </div>
        )}
    />
  );
}

/** One leg of the journey, as its own titled block inside the Logistics section. */
function LegBlock({ icon, title, hint, children }: {
  icon: React.ReactNode; title: string; hint: string; children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border">
      <div className="border-b bg-card-2/60 px-3 py-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-foreground">
          {icon} {title}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-2.5 p-3">{children}</div>
    </section>
  );
}

/**
 * **All** of the order's logistics, in one section and in two blocks — inbound (supplier → the
 * 1Buy warehouse) and outbound (warehouse → client). There is deliberately no separate Delivery
 * section: dispatching to the client is the outbound leg, so its e-invoice, its allocation to
 * sales-order lines and its proof of delivery are the outbound block's paperwork rather than a
 * section of their own. `steps` therefore spans EXPORT/IMPORT **and** DELIVERY, and the heading
 * reports whichever of those phases the order is actually at.
 *
 * One consequence to keep in mind: the outbound block happens *after* Customs and the Warehouse
 * relabel, which render below this section. The block says so rather than the page reordering
 * itself, because splitting logistics back apart to fix the reading order is what this merge
 * exists to undo.
 */
function LogisticsSection({
  b, steps, currentId, reason,
}: { b: OrderBundle; steps: JourneyStep[]; currentId?: string; reason: string | null }) {
  const plan = incotermPlan(b.incoterm);
  const atHub = b.shipments.some((s) => s.leg === "INBOUND" && AT_1BUY.has(s.status));

  const deliveryCols: Col<OrderBundle["deliveries"][number]>[] = [
    { key: "from", header: "From shipment", render: (d) => <span className="font-mono text-xs">{d.fromShipmentNo}</span> },
    { key: "cpo", header: "Sales Order", render: (d) => <span className="font-mono text-xs">{d.clientPoNo}</span> },
    { key: "mpn", header: "Line", render: (d) => <span className="font-mono text-xs">{d.clientLineMpn}</span> },
    { key: "qty", header: "Qty", align: "right", render: (d) => qtyfmt(d.qty) },
    { key: "pod", header: "PoD", render: (d) => d.pod ? <Pill tone="ok"><Check className="h-3 w-3" /> captured</Pill> : <Pill tone="warn">pending</Pill> },
  ];
  const toShip = b.lines.map((l) => `${l.mpn} ${qtyfmt(remainingToShip(b, l.mpn))}`).join(" · ");
  const toDispatch = b.lines.map((l) => `${l.mpn} ${qtyfmt(remainingToShipLeg(b, l.mpn, "OUTBOUND"))}`).join(" · ");
  const toAllocate = Array.from(new Set(b.shipments.flatMap((s) => s.lines).map((l) => l.mpn)))
    .map((m) => `${m} ${qtyfmt(remainingToAllocate(b, m))}`).join(" · ");

  return (
    <FlowSection id="logistics" title="Logistics — supplier → 1Buy warehouse → client" hint={plan.summary}
      icon={<Truck className="h-4 w-4" />} steps={steps} currentId={currentId} reason={reason}>

      <LegBlock icon={<Truck className="h-3.5 w-3.5" />} title="Inbound logistics"
        hint="Supplier → the 1Buy warehouse. The goods we bought, moving to us.">
        <div className={cn("rounded-lg border p-2.5 text-xs",
          plan.weBookFreight ? "border-primary/40 bg-accent-soft text-primary" : "bg-muted/30 text-muted-foreground")}>
          <b>Incoterm {plan.incoterm}</b> — {plan.weBookFreight ? "1Buy books the inbound carrier." : "the supplier books and pays the inbound leg; we record their AWB."}
        </div>
        <ShipmentTable b={b} leg="INBOUND" />
        {atHub && <p className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Inbound leg complete — goods at the 1Buy warehouse.</p>}
        <p className="text-xs text-muted-foreground">Remaining to ship inbound: {toShip || "—"}</p>
      </LegBlock>

      <LegBlock icon={<PackageCheck className="h-3.5 w-3.5" />} title="Outbound logistics"
        hint="The 1Buy warehouse → the client. Runs after customs clearance and the relabel below: dispatched, invoiced under GST, allocated to sales-order lines and signed for.">
        <ShipmentTable b={b} leg="OUTBOUND" />
        <p className="text-xs text-muted-foreground">Remaining to dispatch: {toDispatch || "—"}</p>
        <p className="rounded-lg border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          {b.einvoice
            ? <>GST e-Invoice <Pill tone="ok">IRN</Pill> <span className="font-mono text-foreground">ack {b.einvoice.ackNo}</span> · {b.einvoice.supplyType}</>
            : "GST e-Invoice not generated yet — required on the client tax invoice at dispatch."}
        </p>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Allocated to sales-order lines</div>
          <DataTable columns={deliveryCols} rows={b.deliveries} empty="Nothing allocated to a client yet." />
        </div>
        <p className="text-xs text-muted-foreground">Available to allocate: {toAllocate || "—"}</p>
      </LegBlock>

      <p className="text-xs text-faint">
        Click a shipment for its route, weights, dates and the MPN lines on it. Booking, pickups, tracking polls
        and the carrier documents live on the Logistics board; allocation lives on the Delivery board.
      </p>
    </FlowSection>
  );
}

// ---------- 6 · customs ----------

function CustomsSection({
  b, steps, currentId, reason,
}: { b: OrderBundle; steps: JourneyStep[]; currentId?: string; reason: string | null }) {
  const applies = customsApplies(b);
  const bySupplier = supplierHandlesCustoms(b);
  const cols: Col<OrderBundle["customs"][number]>[] = [
    { key: "s", header: "Shipment", render: (c) => <span className="font-mono text-xs">{c.shipmentNo}</span> },
    { key: "be", header: "BE no · date", render: (c) => <span className="text-xs">{c.beNo || "—"}{c.beDate ? ` · ${c.beDate}` : ""}</span> },
    { key: "port", header: "Port", render: (c) => c.portCode ?? "—" },
    { key: "cha", header: "CHA", render: (c) => c.chaName ?? "—" },
    { key: "duty", header: "Duty", align: "right", render: (c) => money(c.totalDuty ?? 0, c.currency ?? b.currency) },
    { key: "ice", header: "ICEGATE", render: (c) => c.icegateRef ? <Pill tone="ok">filed · {c.icegateRef}</Pill> : <Pill tone="warn">pending</Pill> },
  ];

  return (
    <FlowSection id="customs" title="Customs" hint={!applies ? "Domestic order with no lab abroad — no customs leg."
      : bySupplier ? `Incoterm ${b.incoterm} — the supplier clears India import customs duty-paid; 1Buy files no Bill of Entry.`
      : "Our CHA files the Bill of Entry in ICEGATE and duty is assessed."}
      icon={<Stamp className="h-4 w-4" />} steps={steps} currentId={currentId} reason={reason}>
      {!applies || bySupplier ? (
        <p className="text-xs text-muted-foreground">
          {!applies
            ? "Nothing to file — the goods never cross a border on this order."
            : "Nothing for us to file. Receipt at the warehouse is the next physical event."}
        </p>
      ) : (
        <>
          <DataTable columns={cols} rows={b.customs} empty="No customs entry yet — a BOE is filed against an inbound shipment." />
          {b.tradeType === "DOMESTIC" && (
            <p className="text-xs text-warn">Domestic order, but testing uses a lab abroad — customs applies on export &amp; re-import (A19).</p>
          )}
        </>
      )}
    </FlowSection>
  );
}

// ---------- 7 · warehouse ----------

function WarehouseSection({
  b, steps, currentId, reason,
}: { b: OrderBundle; steps: JourneyStep[]; currentId?: string; reason: string | null }) {
  return (
    <FlowSection id="warehouse" title="Warehouse — receive &amp; relabel (the masking act)"
      hint="Goods land at the 1Buy warehouse and are relabelled to the masking entity. This is what keeps the buyer and the supplier from seeing each other."
      icon={<Warehouse className="h-4 w-4" />} steps={steps} currentId={currentId} reason={reason}>
      <Facts>
        <Field label="Warehouse address">{fmtAddress(b.hubAddress) || "—"}</Field>
        <Field label="Masking entity">{b.maskingEntity}</Field>
        <Field label="Relabelled to 1Buy">
          {b.relabelledAt ? <span className="text-ok">{b.relabelledAt}</span> : <span className="text-faint">not yet</span>}
        </Field>
        <Field label="Relabelling cost">{b.relabelCost ? money(b.relabelCost, b.currency) : "—"}</Field>
        <Field label="Goods received (escrow signal)">{b.escrow?.goodsReceivedAt ?? <span className="text-faint">not recorded</span>}</Field>
      </Facts>
    </FlowSection>
  );
}

// ---------- 8 · evidence & history ----------

function EvidenceSection({ b, reason }: { b: OrderBundle; reason: string | null }) {
  const docCols: Col<OrderBundle["documents"][number]>[] = [
    { key: "type", header: "Type", render: (d) => <Pill tone="info">{d.docType}</Pill> },
    { key: "file", header: "File", render: (d) => <span className="font-mono text-xs">{d.fileName}</span> },
    { key: "subj", header: "On", render: (d) => <span className="text-xs text-muted-foreground">{d.subjectType}</span> },
    { key: "by", header: "By", render: (d) => d.uploadedBy },
    { key: "at", header: "When", align: "right", render: (d) => <span className="text-xs tnum">{d.uploadedAt}</span> },
  ];

  return (
    <FlowSection id="evidence" title="Evidence &amp; history" hint="Every document filed against this order, and everything that happened to it."
      icon={<FileText className="h-4 w-4" />} steps={[]} reason={reason}>
      <DataTable columns={docCols} rows={b.documents} empty="No documents filed yet." />
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Events · {b.events.length}
        </div>
        {b.events.length === 0 ? <Empty text="No events logged." /> : (
          <ol className="space-y-2.5">
            {b.events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Pill tone={e.eventType === "DELAY" ? "warn" : "neutral"}>{prettyStatus(e.eventType)}</Pill>
                    <span className="text-faint tnum">{e.occurredAt}</span>
                  </div>
                  <p className="text-sm">{e.message}</p>
                  <p className="text-xs text-muted-foreground">{e.recordedBy} · {e.source}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </FlowSection>
  );
}
