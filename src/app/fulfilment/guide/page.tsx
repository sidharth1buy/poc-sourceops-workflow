import Link from "next/link";
import { Lock, ArrowRight, Check, X, HelpCircle, ChevronRight } from "lucide-react";
import { Panel, Pill } from "@/components/ui/primitives";

// ---- content (mirrors the gates the app actually enforces via gateReason()) ----
const PHASES: {
  phase: string; tone: "info" | "warn" | "ok" | "neutral";
  steps: { name: string; owner: string; gate?: string; cond?: string }[];
}[] = [
  { phase: "Kickoff", tone: "neutral", steps: [
    { name: "Order received for fulfilment (already approved, PI in hand)", owner: "SC", cond: "PO review, sending the PO & supplier ACK+PI are done on the upstream sourcing platform — this console is fulfilment-only. Upload the confirmed PI to the order." },
  ] },
  { phase: "Payment", tone: "warn", steps: [
    { name: "Escrow: escrow payment received", owner: "SC", gate: "escrow must reach Escrow payment received", cond: "when payment = Escrow / LC" },
    { name: "Pay supplier (advance / credit)", owner: "Finance", gate: "supplier payment INITIATED / PAID", cond: "when payment = Advance / Credit" },
  ] },
  { phase: "Testing", tone: "info", steps: [
    { name: "Testing — WHL lab or supplier self-test", owner: "Lab / Supplier", gate: "at least one lot must PASS", cond: "when testing ≠ None" },
    { name: "Release escrow (to seller)", owner: "SC", gate: "escrow must reach Released to Seller", cond: "when payment = Escrow (always)" },
  ] },
  { phase: "Import / Customs", tone: "info", steps: [
    { name: "Ship to India (inbound AWB)", owner: "SC", gate: "an inbound shipment must exist", cond: "when international / A19" },
    { name: "Customs — BOE filed in ICEGATE", owner: "CHA", gate: "BOE must be filed in ICEGATE", cond: "when international / A19" },
  ] },
  { phase: "Relabel", tone: "neutral", steps: [
    { name: "Receive + relabel to 1Buy (masking step)", owner: "SC", cond: "GRN 3-way match" },
  ] },
  { phase: "Delivery", tone: "ok", steps: [
    { name: "e-Invoice + dispatch to client", owner: "SC" },
    { name: "Proof of delivery", owner: "SC" },
  ] },
  { phase: "Close", tone: "ok", steps: [
    { name: "Reconcile (GST / IDPMS) + close", owner: "Finance" },
  ] },
];

const BRANCHES = [
  { when: "Payment = Escrow / LC", then: "An escrow order appears on its own 8-state track (Draft → … → Released to Seller). A gate holds the seller's money until the escrow payment is received and, later, release." },
  { when: "Payment = Advance / Credit", then: "No escrow. Supplier paid directly (up front, or on net-credit terms later). Gate = payment initiated." },
  { when: "Testing = None", then: "Testing and its gate are skipped entirely; the order goes straight from payment to logistics." },
  { when: "Testing = Sample / WHL", then: "A testing gate is inserted — nothing dispatches until a lot PASSES." },
  { when: "Trade = Domestic", then: "Customs / BOE steps are skipped." },
  { when: "Trade = International", then: "Ship-in + a customs gate (BOE in ICEGATE) are inserted." },
  { when: "Domestic + WHL testing (A19)", then: "No WHL lab in India → goods export to a foreign lab and re-import, so customs applies on BOTH legs even though the deal is 'domestic'." },
  { when: "Logistics = Multi-leg", then: "Several AWBs / consolidation; a line's qty can split across shipments (guards stop over-shipping)." },
];

const OUTCOMES = [
  { r: "PASS", tone: "ok" as const, icon: Check, text: "Quality proven → ship in (escrow release runs on its own state machine — see the Escrow board, SC persona)." },
  { r: "FAIL", tone: "bad" as const, icon: X, text: "Material reject → supplier takes it back." },
  { r: "MAYBE", tone: "warn" as const, icon: HelpCircle, text: "Edge case → reported to the client; client approves (continue) or rejects (return)." },
];

// Worked end-to-end flows (🔒 = gate). Mirrors seedSteps ordering for the three common shapes.
const SCENARIOS: { title: string; when: string; steps: { name: string; gate?: boolean }[] }[] = [
  { title: "International · Escrow · WHL lab", when: "payment = Escrow · testing = WHL · route = International", steps: [
    { name: "Order received" }, { name: "Escrow: payment received", gate: true }, { name: "WHL test → PASS", gate: true },
    { name: "Release escrow", gate: true }, { name: "Ship to India", gate: true }, { name: "BOE in ICEGATE", gate: true },
    { name: "Relabel to 1Buy" }, { name: "e-Invoice + dispatch", gate: true }, { name: "Proof of delivery" }, { name: "Close" },
  ] },
  { title: "Domestic · Advance · Supplier self-test", when: "payment = Advance/Credit · testing = Self · route = Domestic", steps: [
    { name: "Order received" }, { name: "Collect from client", gate: true }, { name: "Pay supplier", gate: true },
    { name: "Self-test → PASS", gate: true }, { name: "Relabel to 1Buy" }, { name: "e-Invoice + dispatch", gate: true },
    { name: "Proof of delivery" }, { name: "Close" },
  ] },
  { title: "Domestic + WHL = A19 · customs on both legs", when: "route = Domestic but the lab is abroad → export + re-import", steps: [
    { name: "Order received" }, { name: "Collect / pay", gate: true }, { name: "WHL test → PASS", gate: true },
    { name: "Export → lab → re-import", gate: true }, { name: "BOE in ICEGATE", gate: true }, { name: "Relabel to 1Buy" },
    { name: "e-Invoice + dispatch", gate: true }, { name: "Proof of delivery" }, { name: "Close" },
  ] },
];

const ROLES = [
  { role: "SC (supply chain)", does: "Creates sales & purchase orders, spins up the order from a purchase order, drives the journey, records shipments, relabel, delivery & PoD. Also advances each escrow order through its invoice/confirmation states, acknowledges terms, and sits on release gates." },
  { role: "Finance", does: "Runs both-sided payments (client collection, supplier/customs/lab settlement) and confirms the money side of each escrow instruction." },
  { role: "Approver (upstream)", does: "PO review & approval happen on the sourcing platform — orders arrive in this console already approved, with the PI in hand." },
  { role: "Lab (WHL)", does: "Runs testing; the PASS/FAIL/MAYBE result drives the TESTING journey gate." },
  { role: "CHA", does: "Customs broker — files the BOE in ICEGATE (closes the import/FEMA loop)." },
  { role: "Supplier", does: "Sends ACK + PI, ships the goods (to lab, then to us)." },
];

const STORY = [
  { n: 1, icon: "🧾", title: "A customer orders parts", plain: "A client sends us a purchase order for the components they need.", term: "Buyer PO" },
  { n: 2, icon: "🏭", title: "We buy from a supplier", plain: "We place our own order with a supplier who has the parts — neither side deals with the other, we sit in the middle.", term: "Our PO → Seller PI" },
  { n: 3, icon: "🔒", title: "The money is held safely", plain: "The buyer's payment goes into escrow — a neutral holding account — so nobody loses out if something goes wrong.", term: "Escrow" },
  { n: 4, icon: "🧪", title: "The parts are quality-checked", plain: "An independent lab tests a sample to confirm the parts are genuine and good.", term: "WHL testing" },
  { n: 5, icon: "💸", title: "The supplier is paid once goods are accepted", plain: "The escrow order works through its own state machine — sent for confirmation, invoiced, escrow payment received, inspected — before the held money is released to the supplier.", term: "Released to Seller" },
  { n: 6, icon: "🚢", title: "Goods travel & clear customs", plain: "The supplier ships to us; for imports the goods clear customs (duty + paperwork).", term: "Shipment + BOE" },
  { n: 7, icon: "🏷️", title: "We receive & relabel", plain: "Parts arrive at our warehouse; we check them and relabel them under 1Buy before sending on.", term: "GRN + relabel" },
  { n: 8, icon: "📦", title: "We deliver to the customer", plain: "We ship to the client with our invoice, capture proof of delivery, and close the deal.", term: "Dispatch + PoD" },
];

const GLOSSARY: [string, string][] = [
  ["PO — Purchase Order", "A formal order to buy something."],
  ["PI — Proforma Invoice", "A seller's price quote / confirmation, before the real invoice."],
  ["Escrow", "A neutral account that holds the money until agreed conditions are met."],
  ["Lab / WHL", "An independent testing house that checks the parts are genuine."],
  ["Gate 🔒", "A checkpoint that blocks progress until its condition is met."],
  ["Customs / BOE", "Bill of Entry — the import paperwork to clear goods and pay duty."],
  ["ICEGATE", "The government customs portal where the Bill of Entry is filed."],
  ["GRN", "Goods Receipt Note — confirms goods arrived and match the order."],
  ["Relabel / masking", "Putting 1Buy's label on the goods so buyer & seller stay private from each other."],
  ["Allocation (N:N)", "One order can serve several customers; one customer's need can split across orders."],
];

const toneBar: Record<string, string> = {
  info: "border-l-[color-mix(in_srgb,var(--info)_60%,transparent)]",
  warn: "border-l-[color-mix(in_srgb,var(--warn)_60%,transparent)]",
  ok: "border-l-[color-mix(in_srgb,var(--ok)_60%,transparent)]",
  neutral: "border-l-border-2",
};

export default function GuidePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Guide — how the flow works</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          This is <b className="text-foreground">1Buy&apos;s internal operations &amp; management console</b> — used by our SC, finance, ops and
          management teams. Clients and suppliers never log in here. It runs a <b className="text-foreground">masked, back-to-back</b> trade (Mode 4):
          a Buyer PO + a confirmed Seller PI become <b className="text-foreground">one order</b>, which walks a policy-assembled journey.
          🔒 marks a <b className="text-foreground">gate</b> — the order can&apos;t move past it until its condition is met. This page mirrors the rules the app enforces.
        </p>
      </div>

      {/* PLAIN ENGLISH */}
      <div className="rounded-[var(--radius)] border border-l-4 border-l-[color-mix(in_srgb,var(--primary)_60%,transparent)] bg-accent-soft/40 p-4">
        <h2 className="mb-1 text-base font-semibold">In plain English</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Think of 1Buy as a <b className="text-foreground">trusted middleman</b>. A customer wants parts; we find a supplier and buy on the
          customer&apos;s behalf, make sure the <b className="text-foreground">money is safe</b> and the <b className="text-foreground">quality is real</b>,
          handle shipping and customs, then deliver — so the customer and supplier never deal with each other directly.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          <li className="rounded-lg border bg-card p-2.5 text-xs"><b>We hold no stock</b><br /><span className="text-muted-foreground">parts just flow through us.</span></li>
          <li className="rounded-lg border bg-card p-2.5 text-xs"><b>Both sides stay private</b><br /><span className="text-muted-foreground">buyer &amp; seller never see each other.</span></li>
          <li className="rounded-lg border bg-card p-2.5 text-xs"><b>Nothing skips a safety check</b><br /><span className="text-muted-foreground">each &ldquo;gate&rdquo; must clear first.</span></li>
        </ul>
      </div>

      {/* 8 STEPS */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">The whole deal in 8 simple steps</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STORY.map((s) => (
            <div key={s.n} className="rounded-[var(--radius)] border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{s.n}</span>
                <span className="text-xl" aria-hidden>{s.icon}</span>
              </div>
              <div className="text-sm font-semibold">{s.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{s.plain}</p>
              <div className="mt-2"><Pill tone="neutral" className="text-[10px]">{s.term}</Pill></div>
            </div>
          ))}
        </div>
      </div>

      {/* WHAT'S A GATE */}
      <Panel title="What a “gate” means">
        <p className="text-sm text-muted-foreground">
          A gate is just a <b className="text-foreground">checkpoint</b>. The order can&apos;t move to the next step until something is confirmed —
          for example, the money is secured, or the lab says the parts passed. In the panel, a locked <Lock className="inline h-3.5 w-3.5 text-warn" /> step
          won&apos;t let you continue until its condition is met — and it tells you exactly what&apos;s missing.
        </p>
      </Panel>

      <h2 className="border-t pt-4 text-lg font-semibold">The detailed view — for operators</h2>

      {/* PARTIES */}
      <Panel title="Who's who — the masked middle">
        <div className="flex flex-wrap items-stretch gap-2">
          <PartyCard name="BUYER (client)" sub="gives PO · never sees the seller" tone="var(--buyer)" />
          <Arrow label="PO in" />
          <PartyCard name="1BUY" sub="principal · Sharpbuy Global Solutions" tone="var(--onebuy)" strong />
          <Arrow label="PO out" />
          <PartyCard name="SELLER" sub="supplies · never sees the buyer" tone="var(--seller)" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Service actors sit alongside: <Pill tone="info">Lab (WHL)</Pill> tests, <Pill tone="info">CHA</Pill> clears customs,
          <span className="mx-1" /><Pill tone="info">3PL (Delhivery)</Pill> warehouses &amp; relabels. The supplier→1Buy relabel is what masks the two sides.
        </p>
      </Panel>

      {/* JOURNEY + GATES */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">The journey &amp; its gates</h2>
        <div className="space-y-3">
          {PHASES.map((p) => (
            <div key={p.phase} className={`rounded-[var(--radius)] border border-l-4 bg-card p-4 shadow-sm ${toneBar[p.tone]}`}>
              <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{p.phase}</div>
              <ul className="space-y-1.5">
                {p.steps.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    {s.gate ? <Lock className="h-3.5 w-3.5 shrink-0 text-warn" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />}
                    <span className="font-medium">{s.name}</span>
                    <Pill tone="neutral" className="text-[10px]">{s.owner}</Pill>
                    {s.gate && <span className="text-xs text-warn">🔒 unlocks when: {s.gate}</span>}
                    {s.cond && <span className="text-[11px] text-faint">· {s.cond}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* BRANCHING */}
      <Panel title="How the path branches (policy-assembled per order)">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {BRANCHES.map((b, i) => (
            <div key={i} className="flex gap-3 rounded-lg border p-3">
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-medium">{b.when}</div>
                <div className="text-xs text-muted-foreground">{b.then}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* WORKED FLOWS */}
      <div>
        <h2 className="mb-1 text-lg font-semibold">Which path does an order take?</h2>
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          The journey is assembled from three switches — <b className="text-foreground">payment mode</b>, <b className="text-foreground">testing</b> and <b className="text-foreground">route</b>. Here are three worked end-to-end flows; <Lock className="inline h-3 w-3 text-warn" /> marks a gate.
        </p>
        <div className="space-y-3">
          {SCENARIOS.map((sc) => (
            <div key={sc.title} className="rounded-[var(--radius)] border bg-card p-4 shadow-sm">
              <div className="text-sm font-semibold">{sc.title}</div>
              <div className="mb-3 text-[11px] text-muted-foreground">{sc.when}</div>
              <div className="flex flex-wrap items-center gap-y-2 overflow-x-auto">
                {sc.steps.map((st, i) => (
                  <span key={i} className="flex items-center">
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs ${st.gate ? "bg-warn-bg font-medium text-warn" : "bg-muted text-muted-foreground"}`}>
                      {st.gate && <Lock className="h-3 w-3" />}{st.name}
                    </span>
                    {i < sc.steps.length - 1 && <ArrowRight className="mx-1 h-3.5 w-3.5 shrink-0 text-faint" />}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* OUTCOMES */}
      <Panel title="Testing outcomes — the branch that gates the money">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {OUTCOMES.map((o) => {
            const Icon = o.icon;
            return (
              <div key={o.r} className="rounded-lg border p-3">
                <div className="mb-1 flex items-center gap-2"><Icon className="h-4 w-4" /><Pill tone={o.tone}>{o.r}</Pill></div>
                <p className="text-xs text-muted-foreground">{o.text}</p>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* N:N */}
      <Panel title="Why one order isn't one client — the N:N spine">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone="info">Sales Order line</Pill><ArrowRight className="h-4 w-4 text-faint" />
          <Pill tone="warn">Purchase Order line (sourcing)</Pill><ArrowRight className="h-4 w-4 text-faint" />
          <Pill tone="neutral">Order line (fulfilment)</Pill><ArrowRight className="h-4 w-4 text-faint" />
          <Pill tone="neutral">shipment line</Pill><ArrowRight className="h-4 w-4 text-faint" />
          <Pill tone="warn">delivery allocation</Pill><ArrowRight className="h-4 w-4 text-faint" />
          <Pill tone="info">client gets goods</Pill>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Create the <Link href="/fulfilment/client-pos" className="text-primary hover:underline">Sales Order</Link> (demand), then a <Link href="/fulfilment/supplier-pos" className="text-primary hover:underline">Purchase Order</Link> whose
          lines reference those client lines (partial ok, multi-client) or stay <b className="text-foreground">unlinked</b>. Selecting a Purchase Order <b className="text-foreground">spins up its fulfilment order</b>.
          One Purchase Order can serve several sales orders (<b className="text-foreground">consolidate</b>) and one client&apos;s demand can split across purchase orders
          (<b className="text-foreground">segregate</b>) — that&apos;s where extra margin comes from. Unlinked lines get mapped from the order&apos;s <b className="text-foreground">Allocations</b> tab; the
          <b className="text-foreground"> Delivery</b> step is the manual &ldquo;who gets what&rdquo;. Guards stop you sourcing more than a client line needs, shipping more than a line has, or allocating more than was received.
        </p>
      </Panel>

      {/* ROLES */}
      <Panel title="Who owns what">
        <div className="space-y-2">
          {ROLES.map((r) => (
            <div key={r.role} className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-dashed py-2 text-sm last:border-0">
              <span className="w-40 shrink-0 font-medium">{r.role}</span>
              <span className="flex-1 text-muted-foreground">{r.does}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* GLOSSARY */}
      <Panel title="What do these words mean?">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {GLOSSARY.map(([term, def]) => (
            <div key={term} className="border-b border-dashed py-1.5">
              <dt className="text-sm font-medium">{term}</dt>
              <dd className="text-xs text-muted-foreground">{def}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <p className="border-t pt-3 text-xs text-faint">
        This guide reflects the enforced gate rules in the app. Open any order&apos;s <b>Journey</b> tab — the <b>Advance</b> button is blocked, with the reason,
        until the gate condition above is satisfied. Deferred as product decisions: exact freeze-point semantics (A12) and full two-leg re-import modelling (A19).
      </p>
    </div>
  );
}

function PartyCard({ name, sub, tone, strong }: { name: string; sub: string; tone: string; strong?: boolean }) {
  return (
    <div className="min-w-[150px] flex-1 rounded-xl border bg-card p-3 shadow-sm" style={strong ? { borderColor: tone, borderWidth: 2 } : undefined}>
      <div className="text-sm font-semibold" style={{ color: tone }}>{name}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 text-faint">
      <span className="font-mono text-[9px] uppercase tracking-wide">{label}</span>
      <ArrowRight className="h-4 w-4" />
    </div>
  );
}
