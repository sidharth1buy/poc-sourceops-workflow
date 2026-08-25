"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RefreshCw, Mail, FileText, Upload,
  Lock, ChevronRight, ChevronDown, Check, FlaskConical, Clock,
  Zap, Truck, Undo2, Factory, Users, Landmark, Layers, Receipt, CalendarCheck,
  type LucideIcon,
} from "lucide-react";
import type { OrderBundle, Lot, LabEmail, LotNotification, NotifyParty, TestSlot } from "@/types";
import {
  WHL_CONTACT, WHL_EMAIL_TEMPLATES, whlTemplate, stageLabel, stageIdx,
  LAB_PAYMENT_TONE, TEST_SLOT_LABEL, TEST_SLOT_TONE, type WhlMailCtx,
} from "@/data/enums";
import { Panel, Pill, StatusPill, Button, Notice } from "@/components/ui/primitives";
import { Select, Input, Labeled, Textarea } from "@/components/ui/form";
import { useStore } from "@/store/store";
import { useRole } from "@/lib/role";
import {
  lotTestProgress, currentReport, lotEmails, lotStageProgress, lotReturnsToSeller,
  labFeeUnpaid, labPaymentOf, labFeeOutstandingTotal, labFeeBlocking, labFeeGross, orderPhaseTimings,
  pendingTestSlot, testSlotsOf,
} from "@/store/selectors";
import { qtyfmt, cn } from "@/lib/utils";
import {
  ComposeWhlEmailModal, NotifyLotResultModal, BulkNotifyModal,
  RecordDispatchModal, MarkLabFeePaidModal, BookTestSlotModal,
} from "@/components/order/modals";
import { TestingStageChain } from "@/components/order/testing-stages";
import { LotTestTable } from "@/components/order/test-tables";
import { ReportRepository } from "@/components/order/report-repository";

type Sub = "lots" | "mail";

/**
 * The two ways this tab is worked. Each carries its own icon and a one-line "what's in
 * here", because as a row of plain text links these read as an afterthought — they are the
 * actual navigation of the screen and are rendered as cards (see `SectionSwitcher`).
 */
const SUBS: { id: Sub; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "lots", label: "Test slots · status & actions", hint: "Each test slot's lifecycle, reports, verdict and lab fee — with its actions.", icon: FlaskConical },
  { id: "mail", label: "Communication", hint: "The WHL thread, the templates, the match queue — and who has been told each result.", icon: Mail },
];

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;
}

/**
 * Card that starts collapsed. An order can carry 100 lots; rendering every card open
 * makes the tab unscrollable and the 100th lot unreachable. The summary row stays
 * visible while collapsed so you can still scan for the one you want, and the bulky
 * actions only appear once it's open.
 */
function CollapsibleCard({
  open, onToggle, title, summary, actions, children,
}: {
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border bg-card shadow-sm">
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3", open && "border-b")}>
        {/* min-width, not just flex-1: with four action buttons on an open card the title
            would otherwise shrink to a stack of wrapped words instead of pushing the actions
            onto their own line */}
        <button onClick={onToggle} aria-expanded={open}
          title={open ? "Minimize" : "Expand"}
          className="flex min-w-[18rem] flex-1 items-center gap-2 text-left hover:text-primary">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <h3 className="min-w-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        </button>
        {summary && <div className="flex flex-wrap items-center gap-2 text-xs">{summary}</div>}
        {open && actions}
      </div>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

/** "3 of 12 expanded · collapse all" strip above a list of collapsible cards. */
function ExpandBar({
  total, openCount, noun, onCollapseAll, onExpandAll,
}: { total: number; openCount: number; noun: string; onCollapseAll: () => void; onExpandAll?: () => void }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{total} {noun}{total === 1 ? "" : "s"} · {openCount} expanded</span>
      {openCount > 0 && <button onClick={onCollapseAll} className="font-medium text-primary hover:underline">collapse all</button>}
      {onExpandAll && openCount < total && total <= 12 && (
        <button onClick={onExpandAll} className="font-medium text-primary hover:underline">expand all</button>
      )}
      <span className="text-faint">click a row to open it</span>
    </div>
  );
}

function Denied({ what }: { what: string }) {
  return <span className="inline-flex items-center gap-1 text-[11px] text-faint"><Lock className="h-3 w-3" /> {what} needs the SC or Mgmt persona</span>;
}

/**
 * @param focusLotId  open scoped to this one test lot — the Testing board's rows are test
 *   slots now, so a click arrives pointing at one submission and the screen must show that
 *   submission's journey rather than every lot on the order. Only a starting value: the scope
 *   selector still widens to the whole order.
 * @param focusSlotId same, for a slot the lab has not confirmed yet — it owns no lot to point
 *   at, so the scope is the slot's own MPN lines.
 * @param focusMpn the widest of the three and the one every board link carries: a row with nothing
 *   booked has neither a lot nor a slot, and without this it opened the whole order — click one
 *   part, get the part list.
 */
export function TestingTab({
  b, id, focusLotId, focusSlotId, focusMpn,
}: { b: OrderBundle; id: string; focusLotId?: string; focusSlotId?: string; focusMpn?: string }) {
  const [sub, setSub] = useState<Sub>("lots");
  // The one booking control left on this screen: a re-test of a slot that came back FAIL. It is
  // not "book a test" — it is the decision a failed result forces, taken where the failure is read.
  const [retestOf, setRetestOf] = useState<{ slotId: string; mpn: string } | null>(null);
  const [compose, setCompose] = useState<{ lotId?: string; templateId?: string } | null>(null);
  const [notify, setNotify] = useState<{ lotId: string; party: NotifyParty } | null>(null);
  const [bulk, setBulk] = useState<NotifyParty | null>(null);
  const [sel, setSel] = useState<string[]>([]);   // lot ids ticked for a combined action
  const [dispatch, setDispatch] = useState<string | null>(null); // lot id whose dispatch is being recorded
  const [paid, setPaid] = useState<string | null>(null);           // lot id whose lab fee is being marked paid
  const { canEditTests, canEmailLab } = useRole();
  // A slot awaiting the lab's confirmation blocks the desk: the lab has not agreed to test
  // anything, so there is nothing legitimate to act on. Mail stays open — that is the way out.
  const pending = pendingTestSlot(b);
  const canAct = canEditTests && !pending;
  const fees = labFeeOutstandingTotal(b);   // lab fees still owed across the order

  const syncWhlInbox = useStore((s) => s.syncWhlInbox);
  const markTestingReturnedToSupplier = useStore((s) => s.markTestingReturnedToSupplier);
  const testingPhase = orderPhaseTimings(b).find((p) => p.phase === "TESTING");

  // ALL = order-wide total; a lot id scopes every number, alert and section below to that lot.
  // Seeded from `focusLotId` so a board click lands on that submission — see the prop's note.
  const [scope, setScope] = useState<string>(focusLotId ?? "ALL");
  const scoped = b.lots.find((l) => l.id === scope);  // undefined for "ALL" (or a stale id after a reset)
  const lotId = scoped?.id;
  // No lot to scope by — either the lab has not confirmed the booking yet, or the link named a
  // slot rather than a lot. Either way the sections narrow to that slot's own lines, so a
  // `?slot=` arrival never widens silently to the whole order.
  const slotScope = !lotId ? focusSlotId : undefined;
  // and with neither, the part itself: the widest scope that is still not "the whole order"
  const mpnScope = !lotId && !slotScope ? focusMpn : undefined;

  /*
   * The fee badge follows the scope. Scoped to one submission, the order's roll-up would report
   * another lot's unpaid invoice on a section about this one — which is exactly the merging the
   * board stopped doing when its rows became test slots.
   */
  const feeBadge = scoped
    ? {
      count: !!scoped.labPayment?.invoice && labFeeUnpaid(scoped) ? 1 : 0,
      held: labFeeBlocking(scoped) ? [scoped.lotCode] : [],
    }
    : { count: fees.count, held: fees.blocking };

  return (
    <div className="space-y-4">
      {testingPhase?.atRisk && (
        <Notice tone="bad"
          action={testingPhase.status === "in_progress" && !b.whlReturnedToSupplierAt ? (
            <Button variant="outline" onClick={() => markTestingReturnedToSupplier(id)}>Mark returned to supplier</Button>
          ) : undefined}>
          {testingPhase.atRisk.reason}
        </Notice>
      )}
      {!testingPhase?.atRisk && testingPhase?.status === "in_progress" && !b.whlReturnedToSupplierAt && (
        <Notice tone="info" action={<Button variant="outline" onClick={() => markTestingReturnedToSupplier(id)}>Mark returned to supplier</Button>}>
          Once WHL testing is done and the goods are physically back with the supplier, confirm it here to close out the Testing phase clock.
        </Notice>
      )}
      {pending && (
        <Notice tone="warn" icon={<Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          action={<Button onClick={() => syncWhlInbox(id)}><RefreshCw className="h-4 w-4" /> Get {pending.lab.split(" ")[0]}&apos;s reply</Button>}>
          <b>{pending.slotNo} is with {pending.lab}</b>, requested {pending.requestedAt}
          {pending.retestOfSlotNo ? <> — a <b>re-test</b> of {pending.retestOfSlotNo}</> : null}. Until it is
          confirmed there are no work orders to act on, so the lot actions are held. The reply lands on the
          WHL thread under <b>Communication</b> and is what creates the test lots, their work orders and
          their test plans.{" "}
          <span className="text-faint">
            (Demo: the lab&apos;s confirmation is generated for you — the real integration polls its mailbox.)
          </span>
        </Notice>
      )}

      {/* ---- One row: the section tabs on the left, the order-level controls on the right.
           This was a "WORK THE ORDER" label over a grid of three description cards; at two
           sections the cards read as banners rather than as a choice, so they collapse to the
           same segmented control the app's header uses for personas. The roll-up metrics that
           used to sit here (tests passed + bar, lots/reports, open / F.A.R. / not-acceptable /
           fee pills) went 2026-08-21 — every one is on the lot rows below, where the lot they
           belong to is named. ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SectionSwitcher active={sub} onChange={setSub}
          badges={{
            lots: feeBadge.held.length > 0 ? { n: feeBadge.held.length, label: "held", tone: "bad" }
              : feeBadge.count > 0 ? { n: feeBadge.count, label: feeBadge.count === 1 ? "fee" : "fees", tone: "warn" } : undefined,
            // no `to match` badge any more (2026-08-25): the queue it pointed at is board-level
            // now, so a badge here would send the reader to a section with nothing to do about it
            mail: undefined,
          }} />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* lot scope — every section below follows it */}
          <Select className="w-52 py-1 text-xs" value={scope} onChange={(e) => setScope(e.target.value)}
            title="Scope every section below to one test slot">
            <option value="ALL">All test slots — order total ({b.lots.length})</option>
            {b.lots.map((l) => (
              <option key={l.id} value={l.id}>{l.lotCode} · {l.orderLineMpn} · {l.testStatus}</option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => syncWhlInbox(id)}
            title="Poll the mailbox. Every stage arrives here: the lab's invoice (with its payment terms), the supplier's dispatch advice, WHL's receipt confirmation, progress notes, the payment acknowledgement and the report.">
            <RefreshCw className="h-4 w-4" /> Check mail
          </Button>
        </div>
      </div>

      {sub === "lots" && <LotsSection b={b} id={id} onlyLotId={lotId} onlySlotId={slotScope} onlyMpn={mpnScope} canEdit={canAct} canEmail={canEmailLab} slots={testSlotsOf(b)}
        pendingSlotNo={pending?.slotNo} onBookRetest={setRetestOf}
        sel={sel} setSel={setSel} onBulk={setBulk}
        onCompose={(l, t) => setCompose({ lotId: l, templateId: t })} onNotify={(l, p) => setNotify({ lotId: l, party: p })}
        onDispatch={setDispatch} onMarkPaid={setPaid} />}
      {sub === "mail" && <MailSection key={lotId ?? slotScope ?? mpnScope ?? "ALL"} b={b} id={id}
        scope={{ lotId, slotId: slotScope, mpn: mpnScope }} canEmail={canEmailLab} />}

      {compose && <ComposeWhlEmailModal orderId={id} lotId={compose.lotId} templateId={compose.templateId} onClose={() => setCompose(null)} />}
      {notify && <NotifyLotResultModal orderId={id} lotId={notify.lotId} party={notify.party} onClose={() => setNotify(null)} />}
      {bulk && <BulkNotifyModal orderId={id} lotIds={sel} party={bulk} onClose={() => setBulk(null)} />}
      {dispatch && <RecordDispatchModal orderId={id} lotId={dispatch} onClose={() => setDispatch(null)} />}
      {paid && <MarkLabFeePaidModal orderId={id} lotId={paid} onClose={() => setPaid(null)} />}
      {retestOf && (
        <BookTestSlotModal orderId={id} retestOfSlotId={retestOf.slotId} presetMpn={retestOf.mpn}
          onClose={() => setRetestOf(null)} />
      )}
    </div>
  );
}

type SubBadge = { n: number; label: string; tone: "warn" | "bad" };

/**
 * The screen's navigation, as the same segmented control the app header uses for personas —
 * so it reads like the rest of the console rather than like a feature of its own.
 *
 * It has been three things: an underlined tab strip (lost between the panels above and below,
 * people missed that Mail existed), then a grid of description cards with icons and a line of
 * explanatory text each (found, but at two sections they read as banners and dwarfed
 * everything around them), now this. The active tab is **filled** — that part earned its keep
 * and stays. Badges say what needs attention in a section you are not looking at, and their
 * labels arrive ready-pluralised: never auto-suffix an "s".
 */
function SectionSwitcher({
  active, onChange, badges,
}: { active: Sub; onChange: (s: Sub) => void; badges: Partial<Record<Sub, SubBadge | undefined>> }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border bg-background p-0.5">
      {SUBS.map(({ id, label, hint, icon: Icon }) => {
        const on = active === id;
        const badge = badges[id];
        return (
          <button key={id} onClick={() => onChange(id)} aria-current={on ? "true" : undefined}
            title={hint}
            className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition",
              on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
            {badge && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                on ? "bg-primary-foreground/20 text-primary-foreground"
                  : badge.tone === "bad" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn")}>
                {badge.n} {badge.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ==================== 1 · lots: status tracker + report repository ====================

/**
 * **Test slots, grouped by MPN — one section, one list.**
 *
 * This was two stacked things: a `TEST SLOTS` strip of booking summaries, and below it a list of
 * lot cards. They described the same submissions at two altitudes, so reading an order meant
 * matching a slot number in the strip against a `slot TS-…` line on a card. The strip is gone and
 * everything it carried — slot no, status, appointment, re-test provenance, the re-test button —
 * sits on the card it belongs to.
 *
 * There is no flat/grouped toggle any more either. An order is a list of parts; the MPN is the
 * heading and its slots hang under it, always. And a card leads with the two references the lab and
 * we both quote — **lot code and work order** — not the MPN, which the heading above it already
 * said.
 */
function LotsSection({
  b, id, onlyLotId, onlySlotId, onlyMpn, canEdit, canEmail, sel, setSel, onBulk, slots, pendingSlotNo, onBookRetest, onCompose, onNotify, onDispatch, onMarkPaid,
}: { b: OrderBundle; id: string; onlyLotId?: string; onlySlotId?: string; onlyMpn?: string; canEdit: boolean; canEmail: boolean; sel: string[]; setSel: React.Dispatch<React.SetStateAction<string[]>>; onBulk: (party: NotifyParty) => void; slots: ReturnType<typeof testSlotsOf>; pendingSlotNo?: string; onBookRetest: (x: { slotId: string; mpn: string }) => void; onCompose: (lotId: string, templateId?: string) => void; onNotify: (lotId: string, party: NotifyParty) => void; onDispatch: (lotId: string) => void; onMarkPaid: (lotId: string) => void }) {
  const [openLots, setOpenLots] = useState<Set<string>>(new Set());
  const lots = onlyLotId ? b.lots.filter((l) => l.id === onlyLotId)
    : onlySlotId ? b.lots.filter((l) => l.testSlotId === onlySlotId)
      : onlyMpn ? b.lots.filter((l) => l.orderLineMpn === onlyMpn)
        : b.lots;
  const isOpen = (lotId: string) => openLots.has(lotId) || lots.length === 1;
  const toggle = (lotId: string) => setOpenLots((p) => {
    const n = new Set(p);
    if (n.has(lotId)) n.delete(lotId); else n.add(lotId);
    return n;
  });

  const slotOf = (lotId: string) => slots.find((x) => x.lots.some((l) => l.id === lotId))?.slot;
  /**
   * Has **this part** already been re-run against this slot? Per-MPN, not per-slot: two lots can
   * share a submission, and re-running one of them says nothing about the other.
   */
  const rebookedFor = (lot: Lot) => !!lot.testSlotId && !!b.testSlots?.some((x) =>
    x.retestOfSlotId === lot.testSlotId && x.lines.some((l) => l.mpn === lot.orderLineMpn));

  // an MPN's slots that the lab has not confirmed yet own no lot, so they need a row of their own
  const awaitingFor = (mpn: string) =>
    slots
      .filter((x) => !onlySlotId || x.slot.id === onlySlotId)
      .filter((x) => !onlyMpn || x.slot.lines.some((l) => l.mpn === onlyMpn))
      .filter((x) => x.slot.status === "REQUESTED" && x.slot.lines.some((l) => l.mpn === mpn))
      .map((x) => x.slot);

  /**
   * Driven by **the order's own testable lines**, not by which MPNs happen to have slots: a part
   * with nothing booked is exactly the one this view has to surface. Any MPN carrying slots with no
   * matching line is appended so nothing is hidden.
   */
  const testableMpns = b.lines.filter((l) => l.testingMode !== "NONE").map((l) => l.mpn);
  const orphanMpns = Array.from(new Set(lots.map((l) => l.orderLineMpn))).filter((m) => !testableMpns.includes(m));
  // scoped to one slot: only the MPNs that slot actually submitted, so a pre-confirmation
  // arrival shows its own booking rather than the order's whole part list
  const slotMpns = onlySlotId
    ? new Set((b.testSlots ?? []).find((x) => x.id === onlySlotId)?.lines.map((l) => l.mpn) ?? [])
    : undefined;
  const byMpn = [...testableMpns, ...orphanMpns]
    .filter((mpn) => !onlyLotId || lots.some((l) => l.orderLineMpn === mpn))
    .filter((mpn) => !slotMpns || slotMpns.has(mpn))
    // scoped to one part: its own section and nothing else, however many lots it carries
    .filter((mpn) => !onlyMpn || mpn === onlyMpn)
    .map((mpn) => ({ mpn, line: b.lines.find((l) => l.mpn === mpn), rows: lots.filter((l) => l.orderLineMpn === mpn) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Test slots{lots.length ? ` · ${lots.length}` : ""}
        </span>
        {/* Booking left this screen on 2026-08-25: every booking control now lives on the Testing
            board, where the queue of orders and test slots is — one place that knows the part it is
            booking, instead of two. The header still says where it went rather than going quiet. */}
        {pendingSlotNo
          ? <span className="text-xs text-warn">{pendingSlotNo} is still with the lab — one booking at a time.</span>
          : <Link href="/fulfilment/testing" className="text-xs font-medium text-primary hover:underline"
              title="Test slots are booked from the Testing board, against the part they are for">
              Book a test slot on the Testing board →
            </Link>}
      </div>

      {(onlyLotId || onlySlotId) && <p className="text-xs text-muted-foreground">Filtered to one test slot — switch the selector above to <b className="text-foreground">All test slots</b> to see the rest.</p>}
      {onlyMpn && !onlyLotId && !onlySlotId && (
        <p className="text-xs text-muted-foreground">
          Filtered to <b className="text-foreground">{onlyMpn}</b>{" "}— the order&apos;s other parts are on the whole-order view.
        </p>
      )}

      {/* tick slots, act once — at 50 you don't mail them one by one. Gated on the SCOPED count,
          not the order's: arriving from the board on one test slot leaves nothing to select
          between, so the bar would be a control with one possible outcome. */}
      {lots.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card-2 px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">Select test slots</span>
          <span className="text-faint">tick the test slots below, then pick an action</span>
          {sel.length > 0 && <button onClick={() => setSel([])} className="text-muted-foreground hover:underline">clear</button>}
          <span className="ml-auto inline-flex flex-wrap items-center gap-2">
            <span className={cn("font-medium", sel.length ? "text-foreground" : "text-faint")}>{sel.length} selected</span>
            <BulkActionsMenu b={b} id={id} selected={sel} canEmail={canEmail} onBulk={onBulk} />
          </span>
        </div>
      )}

      {byMpn.length === 0 && <Empty text="No test slots yet — book one with the lab." />}

      {lots.length > 1 && (
        <ExpandBar total={lots.length} openCount={lots.filter((l) => openLots.has(l.id)).length} noun="test slot"
          onCollapseAll={() => setOpenLots(new Set())}
          onExpandAll={() => setOpenLots(new Set(lots.map((l) => l.id)))} />
      )}

      {byMpn.map(({ mpn, line, rows }) => {
        const awaiting = awaitingFor(mpn);
        return (
          <section key={mpn} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b pb-1">
              <span className="font-mono text-sm font-semibold">{mpn}</span>
              {line && <Pill tone={line.testingMode === "NONE" ? "neutral" : "info"}>{line.testingMode}</Pill>}
              <span className="text-xs text-muted-foreground">
                {line ? `${line.make} · order qty ${qtyfmt(line.quantity)} · ` : ""}
                {rows.length} test slot{rows.length === 1 ? "" : "s"}
                {rows.length > 0 && <> · sampled {qtyfmt(rows.reduce((a, l) => a + l.sampleQty, 0))} of {qtyfmt(rows.reduce((a, l) => a + l.qty, 0))}</>}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                {(["PASS", "MAYBE", "FAIL", "PENDING"] as const).map((v) => {
                  const n = rows.filter((l) => l.testStatus === v).length;
                  if (!n) return null;
                  return <Pill key={v} tone={v === "PASS" ? "ok" : v === "FAIL" ? "bad" : v === "MAYBE" ? "warn" : "neutral"}>{n} {v.toLowerCase()}</Pill>;
                })}
              </span>
            </div>

            {/* a booking the lab has not answered yet: no lot, no work order, but it is a real
                slot on this MPN and hiding it would make the order look un-booked */}
            {awaiting.map((sl) => (
              <div key={sl.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs">
                <CalendarCheck className="h-3.5 w-3.5 text-muted-foreground" />
                <b className="font-mono">{sl.slotNo}</b>
                <Pill tone={TEST_SLOT_TONE[sl.status]}>{TEST_SLOT_LABEL[sl.status]}</Pill>
                <span className="text-muted-foreground">{sl.lab} · requested {sl.requestedAt}</span>
                <span className="ml-auto text-faint">lot code and work order arrive with the confirmation</span>
              </div>
            ))}

            {rows.length === 0 && awaiting.length === 0 && (
              <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                No test slot for this MPN yet — book one with the lab, and its confirmation creates it.
              </p>
            )}

            {rows.map((lot) => (
              <LotCard key={lot.id} b={b} id={id} lot={lot} canEdit={canEdit} canEmail={canEmail}
                open={isOpen(lot.id)} onToggle={() => toggle(lot.id)}
                /* this lot's OWN verdict, not its slot's: LOT-KS-2 sharing a slot with a failed
                   LOT-KS-1 has not failed, and offering to re-run it would re-test a good part */
                canRetest={lot.testStatus === "FAIL" && !!lot.testSlotId && !rebookedFor(lot)}
                onBookRetest={() => lot.testSlotId && onBookRetest({ slotId: lot.testSlotId, mpn: lot.orderLineMpn })}
                selectable={lots.length > 1}
                selected={sel.includes(lot.id)}
                onSelect={(on) => setSel((p) => (on ? [...p, lot.id] : p.filter((x) => x !== lot.id)))}
                slot={slotOf(lot.id)}
                onCompose={onCompose} onNotify={onNotify} onDispatch={onDispatch} onMarkPaid={onMarkPaid}
                />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Same actions as the per-lot menu, applied once to every ticked lot. */
function BulkActionsMenu({
  b, id, selected, canEmail, onBulk,
}: { b: OrderBundle; id: string; selected: string[]; canEmail: boolean; onBulk: (party: NotifyParty) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const lots = b.lots.filter((l) => selected.includes(l.id));
  const withReport = lots.filter((l) => (l.reports ?? []).length > 0).length;
  const clientPos = new Set(lots.map((l) => l.clientPoNo ?? "—"));
  const none = lots.length === 0;
  // a payment run: only lots whose lab invoice has arrived and is still unpaid
  const payable = lots.filter((l) => !!l.labPayment?.invoice && labFeeUnpaid(l));
  const payableGross = payable.reduce((a, l) => a + labFeeGross(l), 0);
  const payCur = payable[0]?.labPayment?.invoice?.currency ?? "USD";
  // advance invoices in the run aren't just owed — those lots are sitting untested
  const payableHeld = payable.filter((l) => labFeeBlocking(l)).length;

  const item = (label: string, sub: string, icon: React.ReactNode, onClick: () => void, disabled?: boolean) => (
    <button type="button" disabled={disabled} onClick={() => { setOpen(false); onClick(); }}
      className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent">
      <span className="mt-0.5 text-primary">{icon}</span>
      <span className="min-w-0"><span className="font-medium">{label}</span><span className="block text-[11px] text-muted-foreground">{sub}</span></span>
    </button>
  );

  return (
    <div className="relative">
      <Button onClick={() => setOpen((v) => !v)} disabled={none}
        title={none ? "Tick one or more test lots first" : `Act on ${lots.length} selected test lot(s)`}>
        <Layers className="h-4 w-4" /> Next actions ({lots.length}) <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-[22rem] rounded-lg border bg-card p-1 shadow-xl">
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              {lots.length} test lot(s) · {withReport} with a report
              {withReport < lots.length && <span className="text-warn"> · {lots.length - withReport} listed as pending</span>}
            </div>
            {item("Notify supplier", `One digest covering ${lots.length} test lot(s); buyer stays masked`, <Factory className="h-4 w-4" />,
              () => onBulk("SUPPLIER"), !canEmail)}
            {item("Notify buyer / client", clientPos.size > 1
              ? `Split into ${clientPos.size} mails — one per sales order`
              : `One digest covering ${lots.length} test lot(s); supplier stays masked`, <Users className="h-4 w-4" />,
              () => onBulk("BUYER"), !canEmail)}
            {item("Notify escrow provider", b.escrow ? `Release-trigger evidence for ${lots.length} test lot(s)` : "No escrow on this order", <Landmark className="h-4 w-4" />,
              () => onBulk("ESCROW"), !canEmail || !b.escrow)}
            {item("Acknowledge to WHL", `Confirm ${withReport} report(s) received`, <FlaskConical className="h-4 w-4" />,
              () => onBulk("WHL"), !canEmail || withReport === 0)}
            {item("Send invoices to finance", payable.length
              ? `Payment run — ${payable.length} unpaid invoice(s), ${payCur} ${payableGross.toLocaleString()}${payableHeld ? ` · ${payableHeld} on advance, test lot(s) held` : ""}`
              : "No unpaid WHL invoice among the selected lots", <Receipt className="h-4 w-4" />,
              () => onBulk("FINANCE"), !canEmail || payable.length === 0)}
            <div className="my-1 border-t" />
            {item("Arrange logistics for these lots", "Opens Logistics with one shipment covering the selection", <Truck className="h-4 w-4" />,
              () => router.push(`/fulfilment/logistics?order=${id}&lots=${selected.join(",")}`))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "Report is in — what next?" One menu with the follow-through actions: tell the
 * supplier, tell the buyer, evidence the escrow, acknowledge the lab, or move the
 * goods (which hands off to Logistics pre-filled for this lot).
 */
function NextActionsMenu({
  b, id, lot, canEmail, onNotify,
}: { b: OrderBundle; id: string; lot: Lot; canEmail: boolean; onNotify: (lotId: string, party: NotifyParty) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const report = currentReport(lot);
  const sentTo = (p: NotifyParty) => (lot.notifications ?? []).find((n) => n.party === p && n.status === "SENT");
  const ready = !!report;

  const item = (label: string, sub: string, icon: React.ReactNode, onClick: () => void, o: { disabled?: boolean; done?: string } = {}) => (
    <button type="button" disabled={o.disabled} onClick={() => { setOpen(false); onClick(); }}
      className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent">
      <span className="mt-0.5 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium">{label}{o.done && <Check className="h-3 w-3 text-ok" />}</span>
        <span className="block text-[11px] text-muted-foreground">{o.done ? `already sent ${o.done}` : sub}</span>
      </span>
    </button>
  );

  return (
    <div className="relative">
      <Button onClick={() => setOpen((v) => !v)} disabled={!ready}
        title={ready ? "Follow-through actions for this result" : "Available once a test report is received"}>
        <Zap className="h-4 w-4" /> Next actions <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border bg-card p-1 shadow-xl">
            <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              {lot.lotCode} · {report?.reportNo} · {report?.conclusion.replace(/_/g, " ").toLowerCase()}
            </div>
            {item("Notify supplier", "Result + report; buyer stays masked", <Factory className="h-4 w-4" />,
              () => onNotify(lot.id, "SUPPLIER"), { disabled: !canEmail, done: sentTo("SUPPLIER")?.at })}
            {item("Notify buyer / client", "Result + report; supplier stays masked", <Users className="h-4 w-4" />,
              () => onNotify(lot.id, "BUYER"), { disabled: !canEmail, done: sentTo("BUYER")?.at })}
            {item("Notify escrow provider", b.escrow ? `Release-trigger evidence to HKIN (${b.escrow.invoice?.invoiceNo ?? b.orderNo})` : "No escrow on this order", <Landmark className="h-4 w-4" />,
              () => onNotify(lot.id, "ESCROW"), { disabled: !canEmail || !b.escrow, done: sentTo("ESCROW")?.at })}
            {item("Acknowledge to WHL", "Confirm the report is received and logged", <FlaskConical className="h-4 w-4" />,
              () => onNotify(lot.id, "WHL"), { disabled: !canEmail, done: sentTo("WHL")?.at })}
            <div className="my-1 border-t" />
            {item("Arrange logistics for this lot", "Opens Logistics with a shipment pre-filled for this lot", <Truck className="h-4 w-4" />,
              () => router.push(`/fulfilment/logistics?order=${id}&lot=${lot.id}`))}
          </div>
        </>
      )}
    </div>
  );
}

function LotCard({
  b, id, lot, canEdit, canEmail, open, onToggle, canRetest, onBookRetest, selectable, selected, onSelect, slot, onCompose, onNotify, onDispatch, onMarkPaid,
}: { b: OrderBundle; id: string; lot: Lot; canEdit: boolean; canEmail: boolean; open: boolean; onToggle: () => void; canRetest: boolean; onBookRetest: () => void; selectable: boolean; selected: boolean; onSelect: (on: boolean) => void; slot?: TestSlot; onCompose: (lotId: string, templateId?: string) => void; onNotify: (lotId: string, party: NotifyParty) => void; onDispatch: (lotId: string) => void; onMarkPaid: (lotId: string) => void }) {
  const setLotStatus = useStore((s) => s.setLotStatus);
  const fetchWhlReport = useStore((s) => s.fetchWhlReport);
  const uploadBookingAppointmentForLot = useStore((s) => s.uploadBookingAppointment);
  const assignLotToLogistics = useStore((s) => s.assignLotToLogistics);
  const markLotReturnedToSeller = useStore((s) => s.markLotReturnedToSeller);
  const requestWhlUpdate = useStore((s) => s.requestWhlUpdate);
  const p = lotTestProgress(lot);
  const report = currentReport(lot);
  const emails = lotEmails(b, lot.id);
  const awaiting = emails.some((m) => m.direction === "OUT" && m.status === "AWAITING_RESPONSE");

  const stg = lotStageProgress(lot);
  // everything past the report is the physical tail: return, then the freight hand-off
  const reportShared = stageIdx(stg.stage) >= stageIdx("REPORT_SHARED");
  const blocker = p.failed > 0 ? "not acceptable" : p.far > 0 ? "F.A.R." : p.notConducted > 0 ? "not conducted" : null;

  return (
    <CollapsibleCard
      open={open}
      onToggle={onToggle}
      title={<span className="flex flex-wrap items-center gap-2">
        {/* The tick the bulk bar acts on — and only when there is a bulk to act on. With a single
            test slot in view the selection does nothing the slot's own actions don't, so the
            checkbox is noise; the bulk bar hides on the same condition (`selectable` counts what
            is on screen, so a board arrival scoped to one slot shows neither). */}
        {selectable && (
          <input type="checkbox" aria-label={`Select ${lot.lotCode}`} checked={selected}
            onClick={(e) => e.stopPropagation()} onChange={(e) => onSelect(e.target.checked)} />
        )}
        <FlaskConical className="h-4 w-4 text-primary" />
        {/* lot code + work order lead: they are what the lab, its invoices and its reports quote.
            The MPN is the heading this card sits under, so repeating it here said nothing. */}
        <span className="text-sm text-foreground">{lot.lotCode}</span>
        <span className="text-sm normal-case text-foreground">WO {lot.workOrderNo ?? "—"}</span>
        <span className="font-normal normal-case tracking-normal text-faint">
          {lot.lab ?? "—"} · qty {qtyfmt(lot.qty)} / sample {lot.sampleQty} · DC {lot.dateCode}
          {slot ? ` · ${slot.slotNo}` : ""}{slot?.appointmentNo ? ` · appointment ${slot.appointmentNo}` : ""}
        </span>
        {lot.retestOfSlotNo && (
          <Pill tone="warn" title={`Booked as a re-test against ${lot.retestOfSlotNo}.`}>re-test of {lot.retestOfSlotNo}</Pill>
        )}
      </span>}
      // enough while collapsed to spot the lot that needs attention among a hundred
      summary={<>
        <StatusPill status={lot.testStatus} />
        <span className="text-muted-foreground tnum">{p.settled}/{p.total} tests</span>
        <span className={cn("tnum", stg.complete ? "text-ok" : "text-faint")} title={stg.stage ? stageLabel(stg.stage) : "Not started"}>
          {stg.stage ? stageLabel(stg.stage) : "not started"} {Math.max(0, stg.done)}/{stg.total}
        </span>
        {report ? <span className="font-mono text-faint">{report.reportNo}</span> : <span className="text-warn">no report</span>}
        {blocker && <Pill tone={p.failed > 0 ? "bad" : "warn"}>{blocker}</Pill>}
        {lot.workOrderNo && labFeeUnpaid(lot) && (
          labFeeBlocking(lot) ? (
            <Pill tone="bad" title="Advance terms and unpaid — WHL is holding the lot, so testing hasn't started.">
              <Lock className="h-3 w-3" /> held — advance fee
            </Pill>
          ) : (
            <Pill tone={LAB_PAYMENT_TONE[labPaymentOf(lot).status]}>
              <Receipt className="h-3 w-3" /> fee {labPaymentOf(lot).status === "SENT_TO_FINANCE" ? "with finance" : "unpaid"}
            </Pill>
          )
        )}
        {awaiting && <span title="Awaiting a WHL reply"><Clock className="h-3.5 w-3.5 text-warn" /></span>}
      </>}
      actions={<div className="flex flex-wrap items-center gap-2">
        <NextActionsMenu b={b} id={id} lot={lot} canEmail={canEmail} onNotify={onNotify} />
        {/* per lot, because labs book per lot: this applies THIS lot's appointment and leaves
            the others alone. The header's copy of it is the order-wide read. */}
        <label htmlFor={`lot-booking-appt-${lot.id}`}
          aria-disabled={!canEdit}
          title={canEdit
            ? `Upload ${lot.lotCode}'s booking appointment PDF — its samples, work order and test plan are read off it`
            : "Only SC / Mgmt may change test requirements"}
          className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium transition",
            canEdit ? "cursor-pointer hover:border-primary hover:text-primary" : "pointer-events-none opacity-50")}>
          <Upload className="h-4 w-4" /> Booking appointment
        </label>
        <input id={`lot-booking-appt-${lot.id}`} type="file" accept="application/pdf,.pdf" className="hidden"
          disabled={!canEdit}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";                 // so re-picking the same file fires again
            if (f) uploadBookingAppointmentForLot(id, { name: f.name, size: f.size }, lot.id);
          }} />
        <Button variant="outline" onClick={() => fetchWhlReport(id, lot.id)} title="Fetch & parse the WHL report for this work order">
          <FileText className="h-4 w-4" /> {report ? "Fetch revision" : "Fetch report"}
        </Button>
        {/* the hand-off to the freight desk. Gated on the report being shared, because that is
            the point the goods are cleared to move — before it there is nothing to assign. */}
        {/* the two post-report stages. Returning the samples is the lab's act, assigning is
            ours — and the assign click IS the last stage, so it also closes the chain. */}
        {/* only when the booking asked for a return — otherwise the samples are not coming back and
            there is nothing to record (2026-08-25) */}
        {reportShared && lotReturnsToSeller(lot) && !lot.returnedToSellerAt && (
          <Button variant="ghost" disabled={!canEdit} onClick={() => markLotReturnedToSeller(id, lot.id)}
            title={canEdit
              ? `Record that ${lot.lab ?? "WHL"} sent the samples back to the seller`
              : "Only SC / Mgmt may record this"}>
            <Undo2 className="h-4 w-4" /> Returned to seller
          </Button>
        )}
        {reportShared && (
          lot.logisticsAssignedAt ? (
            <Pill tone="ok" title={`Assigned by ${lot.logisticsAssignedBy ?? "—"} on ${lot.logisticsAssignedAt}. It is on the Logistics board's queue.`}>
              <Check className="h-3 w-3" /> Assigned to logistics
            </Pill>
          ) : (
            <Button variant="outline" disabled={!canEdit} onClick={() => assignLotToLogistics(id, lot.id)}
              title={canEdit
                ? "Hand this test lot to the logistics desk — it appears on their board's queue, and completes the lifecycle. Books nothing by itself."
                : "Only SC / Mgmt may assign to logistics"}>
              <Truck className="h-4 w-4" /> Assign to logistics
            </Button>
          )
        )}
        <Button variant="outline" disabled={!canEmail} onClick={() => onCompose(lot.id)} title={canEmail ? "Email WHL about this test slot" : "Only SC / Mgmt may email WHL"}>
          <Mail className="h-4 w-4" /> Email WHL
        </Button>
        {/* The single exception to "booking is board-only" (2026-08-25): a FAIL forces a decision —
            re-test or return — and it is taken here, where the failed result is being read. Shown
            only when this lot's slot came back FAIL and nobody has re-run it yet; every other
            booking, including a plain second slot for this same part, is on the board. */}
        {canRetest && (
          <Button variant="outline" disabled={!canEdit} onClick={onBookRetest}
            title={canEdit ? `Book a re-test against ${slot?.slotNo ?? "this slot"} — the components are already at ${lot.lab ?? "the lab"}` : "Only SC / Mgmt may book a re-test"}>
            <RefreshCw className="h-4 w-4" /> Book re-test
          </Button>
        )}
      </div>}>

      {/* ---- lifecycle chain: where the lot physically is, before what was tested ---- */}
      <div className="mb-4">
        <TestingStageChain orderId={id} lot={lot} canEdit={canEdit}
          onRecordDispatch={() => onDispatch(lot.id)}
          onSendToFinance={() => onNotify(lot.id, "FINANCE")}
          onMarkPaid={() => onMarkPaid(lot.id)}
          />
      </div>

      {/* ---- the one per-test table: requirement, live status, and the report line
             that settled it. The report block below no longer re-lists the processes. ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide">Test status tracker</span>
        <span>{p.settled}/{p.total} passed</span>
        {p.far > 0 && <span className="text-warn">{p.far} F.A.R.</span>}
        {p.failed > 0 && <span className="text-bad">{p.failed} not acceptable</span>}
        {p.notConducted > 0 && <span>{p.notConducted} not conducted</span>}
        {p.open > 0 && <span>{p.open} open</span>}
      </div>
      <LotTestTable orderId={id} lot={lot} canEdit={canEdit} />

      {/* ---- report repository & auto-parsed header summary ---- */}
      <div className="mt-4">
        <ReportRepository orderId={id} lot={lot} />
      </div>

      {/* ---- lot-level verdict override (unchanged lot logic) + thread peek ---- */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="uppercase tracking-wide text-faint">Lot verdict</span>
          {(["PASS", "MAYBE", "FAIL"] as const).map((st) => (
            <button key={st} onClick={() => setLotStatus(id, lot.id, st)}
              className={cn("rounded-md border px-2 py-1 font-medium hover:border-primary", lot.testStatus === st && "border-primary bg-accent-soft text-primary")}>{st}</button>
          ))}
          <span className="ml-1 text-faint">drives the escrow release / refund path</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {awaiting && <span className="inline-flex items-center gap-1 text-warn"><Clock className="h-3.5 w-3.5" /> awaiting WHL reply</span>}
          {/*
           * Removed 2026-08-25: the `N message(s)` count, `F.A.R. follow-up` and `Re-test request`.
           * The count was a number with nothing to do about it — the thread itself is one click away
           * under Communication, which is also where both templates live as composer chips (and the
           * card's own `Email WHL` opens the compose modal already carrying this lot). Three
           * controls stacked under a failed report competing with the verdict buttons beside them,
           * for mail that is written somewhere better.
           */}
          {!report && (
            <Button variant="outline" disabled={!canEmail} onClick={() => requestWhlUpdate(id, lot.id)}>
              <Mail className="h-4 w-4" /> Request update
            </Button>
          )}
          {awaiting && (
            <Button variant="ghost" disabled={!canEmail} onClick={() => onCompose(lot.id, "TAT_ESCALATION")}>
              <Mail className="h-4 w-4" /> Escalate TAT
            </Button>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}

// ==================== 6 + 7 · inbox / compose / correspondence ====================

/**
 * @param scope which submission the screen is on, straight from the URL — a lot, the slot it
 *   belongs to, or just the part. **Correspondence follows it and cannot be widened from here.**
 *   Arriving on one test slot and then reading the order's whole mail history answers a question
 *   nobody asked by clicking that row, so the lot `<Select>`s that used to sit on the thread and on
 *   `Result circulated` are gone when a scope is set; the way back to everything is the header's
 *   "show the whole order" link, or the order number on the board. Unscoped, both selects return.
 */
function MailSection({
  b, id, scope, canEmail,
}: { b: OrderBundle; id: string; scope: { lotId?: string; slotId?: string; mpn?: string }; canEmail: boolean }) {
  const syncWhlInbox = useStore((s) => s.syncWhlInbox);
  const escalateLabEmail = useStore((s) => s.escalateLabEmail);
  const sendLabEmail = useStore((s) => s.sendLabEmail);
  /*
   * The submissions in scope, as ids and as parts. `undefined` means "the whole order" — the only
   * state in which this section offers a lot picker at all.
   */
  const scopedSlot = scope.slotId ? (b.testSlots ?? []).find((x) => x.id === scope.slotId) : undefined;
  const scopedLots = scope.lotId ? b.lots.filter((l) => l.id === scope.lotId)
    : scope.slotId ? b.lots.filter((l) => l.testSlotId === scope.slotId)
      : scope.mpn ? b.lots.filter((l) => l.orderLineMpn === scope.mpn)
        : undefined;
  const scopedMpns: Set<string> | undefined = scope.lotId
    ? new Set(scopedLots?.map((l) => l.orderLineMpn) ?? [])
    : scopedSlot ? new Set(scopedSlot.lines.map((l) => l.mpn))
      : scope.mpn ? new Set([scope.mpn])
        : undefined;
  const scoped = !!scopedMpns;
  const lotOptions = scopedLots ?? b.lots;
  /** what the strip says instead of the picker */
  const scopeLabel = scope.lotId
    ? `${b.lots.find((l) => l.id === scope.lotId)?.lotCode} · ${[...(scopedMpns ?? [])].join(", ")}`
    : scopedSlot ? `${scopedSlot.slotNo} · ${[...(scopedMpns ?? [])].join(", ")}`
      : (scope.mpn ?? "");

  // ---- the open composer ----
  const [to, setTo] = useState(WHL_CONTACT);
  const [cc, setCc] = useState("");
  const [composeLot, setComposeLot] = useState(scope.lotId ?? scopedLots?.[0]?.id ?? b.lots[0]?.id ?? "");
  const [tplId, setTplId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // template context comes off the chosen lot, so nothing has to be typed or looked up
  const ctxFor = (lid: string): WhlMailCtx => {
    const l = b.lots.find((x) => x.id === lid);
    const rep = l ? (l.reports ?? []).find((r) => r.current) : undefined;
    return {
      entity: b.maskingEntity ?? "1Buy", mpn: l?.orderLineMpn, lotCode: l?.lotCode, qty: l?.qty,
      sampleQty: l?.sampleQty, workOrderNo: l?.workOrderNo, clientPoNo: l?.clientPoNo,
      reportNo: rep?.reportNo ?? l?.reportNo, lab: l?.lab, dateCode: l?.dateCode,
    };
  };
  const applyTemplate = (tid: string) => {
    const t = whlTemplate(tid);
    const c = ctxFor(composeLot);
    setTplId(tid); setSubject(t.subject(c)); setBody(t.body(c));
  };
  // re-picking the lot re-fills a templated mail; a hand-typed one is left alone
  const pickComposeLot = (lid: string) => {
    setComposeLot(lid);
    if (tplId) { const t = whlTemplate(tplId); const c = ctxFor(lid); setSubject(t.subject(c)); setBody(t.body(c)); }
  };
  const sendNow = () => {
    if (!subject.trim() || !body.trim()) return;
    sendLabEmail(id, { lotId: composeLot || undefined, subject, body });
    setSubject(""); setBody(""); setTplId("");
  };
  // Only meaningful on the whole-order view: with a scope the thread follows it and there is
  // nothing to pick. Kept as state (not derived) so the unscoped view still filters by hand.
  const [lotFilter, setLotFilter] = useState<string>("ALL");
  const inScope = (lotId?: string) => {
    if (!scopedLots) return lotFilter === "ALL" || lotId === lotFilter;
    return !!lotId && scopedLots.some((l) => l.id === lotId);
  };
  /**
   * A booking mail carries no lot — the lot does not exist until the lab answers it. On the
   * whole-order view it belongs in every list; scoped, it belongs only to the parts it was about,
   * which we recover from the MPN on the mail or, failing that, from the slot it created.
   */
  const bookingInScope = (m: LabEmail) => {
    if (!scopedMpns) return true;
    if (m.mpn) return scopedMpns.has(m.mpn);
    const slot = (b.testSlots ?? []).find((x) => x.requestEmailId === m.id || x.confirmEmailId === m.id);
    return !!slot && slot.lines.some((l) => scopedMpns.has(l.mpn));
  };
  /**
   * Everything this order has said or been told, in one list — not just the WHL thread.
   *
   * The lab's mail lives on `labEmails`; what we sent the **supplier, the buyer, the escrow
   * provider and finance** lives on `lot.notifications`, and a booking request/confirmation has
   * no lot at all. Three stores, one question ("what has been communicated?"), so they are merged
   * into one row shape here rather than leaving two of them somewhere else on the page.
   */
  const thread: ThreadRow[] = [
    ...(b.labEmails ?? [])
      .filter((m) => (!m.lotId
        ? (m.kind === "BOOKING_REQUEST" || m.kind === "BOOKING_CONFIRMED") && bookingInScope(m)
        : inScope(m.lotId)))
      .map((m) => ({ kind: "mail" as const, at: m.at, mail: m })),
    ...b.lots
      .filter((l) => inScope(l.id))
      .flatMap((l) => (l.notifications ?? []).map((n) => ({ kind: "notify" as const, at: n.at, note: n, lot: l }))),
  ].sort((x, y) => String(y.at).localeCompare(String(x.at)));

  // A long-running lot accumulates dozens of mails, so the thread (newest-first) is still
  // truncated — but a table row is one line where the old card was a clamped paragraph, so
  // eight of them cost less height than two cards did. The rest stay one click away.
  const RECENT_MAILS = 8;
  const [showAllMail, setShowAllMail] = useState(false);
  const [openMails, setOpenMails] = useState<Set<string>>(new Set());
  const visible = showAllMail ? thread : thread.slice(0, RECENT_MAILS);
  const hidden = Math.max(0, thread.length - RECENT_MAILS);
  const toggleMail = (mid: string) => setOpenMails((p) => {
    const n = new Set(p);
    if (n.has(mid)) n.delete(mid); else n.add(mid);
    return n;
  });

  return (
    <div className="space-y-4">
      {/* ---- An OPEN composer, not a button that opens one. Modelled on the Logistics desk's
           "Communication on this order" (components/logistics/logistics-communication.tsx):
           a real mail head sitting at the top of the thread, typed into directly. The templates
           moved from "chip opens a modal" to "chip fills this form", which is what they were
           always for — the modal is still the way in from a lot's own Email-WHL button. ---- */}
      <Panel title="Write to WHL">
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Labeled label="To" hint="the lab's reports mailbox">
              <Input value={to} onChange={(e) => setTo(e.target.value)} />
            </Labeled>
            <Labeled label="CC" hint="comma-separated">
              <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" />
            </Labeled>
            {/* Scoped to one lot, the mail can only be about that lot — a picker here would let a
                screen about LOT-A file a mail against LOT-B. Scoped to a part or a slot, the
                options narrow to its lots. */}
            <Labeled label="About" hint={scope.lotId ? "this test slot" : "files the mail against a test slot"}>
              {scope.lotId ? (
                <div className="text-sm font-medium">{scopeLabel}</div>
              ) : (
                <Select value={composeLot} onChange={(e) => pickComposeLot(e.target.value)}>
                  <option value="">No specific test slot</option>
                  {lotOptions.map((l) => <option key={l.id} value={l.id}>{l.lotCode} · {l.orderLineMpn}</option>)}
                </Select>
              )}
            </Labeled>
          </div>

          {/* a template fills the form in place — subject and body, from the chosen lot */}
          <div>
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Fill from a template — every field stays editable
            </span>
            <div className="flex flex-wrap gap-1.5">
              {WHL_EMAIL_TEMPLATES.map((t) => (
                <button key={t.id} type="button" disabled={!canEmail} onClick={() => applyTemplate(t.id)}
                  title={t.hint}
                  className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50",
                    tplId === t.id ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted")}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <Labeled label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder={`e.g. ${b.orderNo} — status on the current work order`} />
          </Labeled>
          <Labeled label="Message">
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Type the mail, or fill it from a template above and edit." />
          </Labeled>

          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!canEmail || !subject.trim() || !body.trim()} onClick={sendNow}
              title={canEmail ? "Send to WHL — it lands on this thread against the chosen lot" : "Only SC / Mgmt may email WHL"}>
              <Mail className="h-4 w-4" /> Send to WHL
            </Button>
            <Button variant="outline" onClick={() => syncWhlInbox(id)}>
              <RefreshCw className="h-4 w-4" /> Check mail
            </Button>
            {(subject || body) && (
              <button onClick={() => { setSubject(""); setBody(""); setTplId(""); }}
                className="text-xs font-medium text-muted-foreground hover:text-foreground">clear</button>
            )}
            {!canEmail && <Denied what="Emailing WHL" />}
          </div>
        </div>
      </Panel>

      <ResultCirculated b={b} defaultLotFilter={lotFilter} scopedLots={scopedLots} scopeLabel={scopeLabel} />

      <Panel title="Correspondence & tracking history — every party"
        actions={scoped
          ? <span className="text-[11px] text-muted-foreground">
              only <b className="text-foreground">{scopeLabel}</b> — the order&apos;s other threads are on the whole-order view
            </span>
          : (
            <Select className="w-52 py-1 text-xs" value={lotFilter} onChange={(e) => setLotFilter(e.target.value)}>
              <option value="ALL">All test slots</option>
              {b.lots.map((l) => <option key={l.id} value={l.id}>{l.lotCode} · {l.orderLineMpn}</option>)}
            </Select>
          )}>
        {thread.length === 0 ? <Empty text="Nothing communicated on this order yet." /> : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-card-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">Direction</th>
                    <th className="px-3 py-2 text-left">Kind</th>
                    <th className="px-3 py-2 text-left">Lot · MPN · WO</th>
                    <th className="px-3 py-2 text-left">Subject</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Files</th>
                    <th className="px-3 py-2 text-left">By</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => row.kind === "mail" ? (
                    <MailRow key={row.mail.id} m={row.mail} orderId={id} onEscalate={escalateLabEmail}
                      expanded={openMails.has(row.mail.id)} onToggle={() => toggleMail(row.mail.id)} />
                  ) : (
                    <NotifyRow key={row.note.id} n={row.note} lot={row.lot} />
                  ))}
                </tbody>
              </table>
            </div>
            {hidden > 0 && (
              <button onClick={() => setShowAllMail((v) => !v)}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {showAllMail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {showAllMail ? `Hide the earlier ${hidden} message(s)` : `Show ${hidden} earlier message(s)`}
              </button>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          This thread is what drives the lifecycle. Everything to and from <b className="text-foreground">{WHL_CONTACT}</b>{" "}
          lands here against its lot — the invoice and its payment terms, the supplier&apos;s dispatch advice, receipt
          confirmations, interim updates, the payment acknowledgement and the report — and each one moves the stage it establishes.
          Click a row to read the message in full.
          {thread.length > RECENT_MAILS && (showAllMail
            ? ` Showing all ${thread.length}.`
            : ` Showing the ${RECENT_MAILS} most recent of ${thread.length}.`)}
        </p>
      </Panel>
    </div>
  );
}

// Every lifecycle stage is established by one of these, so the kind is worth a glance:
// it says whether a message was a bill, a dispatch advice, a receipt or the report.
// STATUS_UPDATE and the outbound kinds are left unlabelled — the subject already says it.
/**
 * Who has been told each result, and what went with it.
 *
 * This used to sit inside every lot card, under its report. It lives here (2026-08-21) because
 * circulating a result *is* communication — the same act as the WHL thread above it, just aimed
 * at the supplier, the buyer, the escrow provider or the lab — so the section that owns outbound
 * mail owns this too, and the lot card stays about the lot's own testing. Sending is still
 * **Next actions** on the lot; this is the record of what was sent.
 *
 * Follows the section's own lot filter, and only lists lots that have a report — there is nothing
 * to circulate before one exists.
 */
function ResultCirculated({
  b, defaultLotFilter, scopedLots, scopeLabel,
}: { b: OrderBundle; defaultLotFilter: string; scopedLots?: Lot[]; scopeLabel?: string }) {
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  // its own filter on the whole-order view — "who was told about LOT-B" is a different question
  // from "what did we say to the lab about LOT-B" — but it cannot escape a URL scope either
  const [lotFilter, setLotFilter] = useState<string>(defaultLotFilter);
  const all = b.lots.filter((l) => !!currentReport(l));
  const withReport = scopedLots ? all.filter((l) => scopedLots.some((x) => x.id === l.id)) : all;
  const lots = scopedLots ? withReport : withReport.filter((l) => lotFilter === "ALL" || l.id === lotFilter);
  const toggle = (lotId: string) => setOpenHistory((p) => {
    const n = new Set(p);
    if (n.has(lotId)) n.delete(lotId); else n.add(lotId);
    return n;
  });

  return (
    <Panel title={`Result circulated · ${lots.length} test slot${lots.length === 1 ? "" : "s"} with a report`}
      actions={scopedLots
        ? (scopeLabel ? <span className="text-[11px] text-muted-foreground">only <b className="text-foreground">{scopeLabel}</b></span> : undefined)
        : withReport.length > 1 ? (
        <Select className="w-52 py-1 text-xs" value={lotFilter} onChange={(e) => setLotFilter(e.target.value)}
          title="Show one test slot's circulation, or all of them">
          <option value="ALL">All test lots with a report ({withReport.length})</option>
          {withReport.map((l) => <option key={l.id} value={l.id}>{l.lotCode} · {l.orderLineMpn}</option>)}
        </Select>
      ) : undefined}>
      {lots.length === 0 ? (
        <Empty text={withReport.length === 0
          ? "Nothing to circulate yet — a test slot needs a report before its result can go out."
          : "No test slot matches that filter."} />
      ) : (
        <div className="space-y-2">
          {lots.map((lot) => {
            const notes = lot.notifications ?? [];
            const open = openHistory.has(lot.id);
            return (
              <div key={lot.id} className="rounded-lg border bg-card-2 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex flex-wrap items-center gap-2 text-xs">
                    <FlaskConical className="h-3.5 w-3.5 text-primary" />
                    <b className="text-foreground">{lot.lotCode}</b>
                    <span className="font-mono text-[11px] text-muted-foreground">{lot.orderLineMpn}</span>
                    <span className="font-mono text-[11px] text-faint">{currentReport(lot)?.reportNo}</span>
                  </span>
                  <span className="text-[11px] text-faint">
                    use <b className="text-foreground">Next actions</b> on the lot to send
                  </span>
                </div>
                {/* the pills are the summary; the message-by-message trail is behind the toggle */}
                <div className="flex flex-wrap gap-1.5">
                  {(["SUPPLIER", "BUYER", "ESCROW", "WHL"] as NotifyParty[]).map((party) => {
                    const n = notes.find((x) => x.party === party);
                    const label = party === "SUPPLIER" ? "Supplier" : party === "BUYER" ? "Buyer" : party === "ESCROW" ? "Escrow" : "WHL";
                    return (
                      <Pill key={party} tone={!n ? "neutral" : n.status === "FAILED" ? "bad" : "ok"}>
                        {n && n.status === "SENT" && <Check className="h-3 w-3" />}
                        {label}{n ? ` · ${n.at}${n.attachments?.length ? " · report attached" : ""}` : " · not notified"}
                      </Pill>
                    );
                  })}
                </div>
                {notes.length > 0 && (
                  <div className="mt-2">
                    <button onClick={() => toggle(lot.id)} aria-expanded={open}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary">
                      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {open ? "Hide" : "Show"} history ({notes.length})
                    </button>
                    {open && (
                      <ol className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                        {notes.map((n) => (
                          <li key={n.id}>
                            <span className="tnum text-faint">{n.at}</span> · {n.party.toLowerCase()} → <span className="font-mono">{n.to}</span> · {n.subject}
                            {n.attachments?.length ? ` · ${n.attachments.join(", ")}` : ""}
                            {n.status === "FAILED" && <span className="text-bad"> · {n.note}</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/**
 * One outbound party notification as a thread row — the supplier, the buyer, the escrow provider,
 * WHL or finance being told a result. Same eight columns as a lab mail so the merged list reads as
 * one list; the party is the row's "kind", because that is what distinguishes these from each other.
 */
function NotifyRow({ n, lot }: { n: LotNotification; lot: Lot }) {
  return (
    <tr className="border-b last:border-0">
      <td className="whitespace-nowrap px-3 py-2 text-xs tnum text-muted-foreground">{n.at}</td>
      <td className="px-3 py-2"><Pill tone="neutral">sent</Pill></td>
      <td className="px-3 py-2"><Pill tone={n.status === "FAILED" ? "bad" : "info"}>{PARTY_LABEL[n.party]}</Pill></td>
      <td className="px-3 py-2 text-xs">
        <div className="font-medium">{lot.lotCode}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{lot.orderLineMpn}</div>
      </td>
      <td className="px-3 py-2">
        <div className="text-sm font-medium">{n.subject}</div>
        <div className="text-[11px] text-muted-foreground">to <span className="font-mono">{n.to}</span></div>
      </td>
      <td className="px-3 py-2">
        {n.status === "FAILED"
          ? <Pill tone="bad" title={n.note}>failed</Pill>
          : <Pill tone="ok"><Check className="h-3 w-3" /> sent</Pill>}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {n.attachments?.length ? n.attachments.join(", ") : <span className="text-faint">—</span>}
      </td>
      <td className="px-3 py-2 text-xs">Sourcing Ops</td>
    </tr>
  );
}

/** One line of the order's correspondence — the lab's mail, or a result circulated to a party. */
type ThreadRow =
  | { kind: "mail"; at: string; mail: LabEmail }
  | { kind: "notify"; at: string; note: LotNotification; lot: Lot };

const MAIL_KIND_LABEL: Partial<Record<LabEmail["kind"], string>> = {
  INVOICE: "invoice",
  PAYMENT: "payment",
  DISPATCH: "dispatch",
  REPORT: "report",
  BOOKING_REQUEST: "booking",
  BOOKING_CONFIRMED: "confirmed",
};

const MAIL_KIND_TONE: Record<string, "ok" | "warn" | "info" | "neutral"> = {
  INVOICE: "warn",
  PAYMENT: "ok",
  DISPATCH: "info",
  REPORT: "ok",
  BOOKING_REQUEST: "info",
  BOOKING_CONFIRMED: "ok",
};

const PARTY_LABEL: Record<NotifyParty, string> = {
  SUPPLIER: "supplier", BUYER: "buyer / client", ESCROW: "escrow", WHL: "WHL", FINANCE: "finance",
};

/**
 * One message as a table row: when, which way it went, what kind of mail it is (the thing
 * that tells you which stage it moved), which lot it belongs to, and its subject. The body
 * lives in a spanning row underneath, opened by clicking the row — a report mail is long
 * enough to push the rest of the thread off screen if every one were shown in full.
 */
function MailRow({
  m, orderId, expanded, onToggle, onEscalate,
}: { m: LabEmail; orderId: string; expanded: boolean; onToggle: () => void; onEscalate: (orderId: string, emailId: string) => void }) {
  return (
    <>
      <tr onClick={onToggle}
        title={expanded ? "Hide the message" : "Read the full message"}
        className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/60", expanded && "bg-accent-soft/60")}>
        <td className="whitespace-nowrap px-3 py-2 text-xs tnum text-muted-foreground">{m.at}</td>
        <td className="px-3 py-2">
          <Pill tone={m.direction === "OUT" ? "info" : "neutral"}>{m.direction === "OUT" ? "sent" : "received"}</Pill>
        </td>
        {/* the kind is what tells you which stage this mail moved */}
        <td className="px-3 py-2">
          {MAIL_KIND_LABEL[m.kind] ? <Pill tone={MAIL_KIND_TONE[m.kind]}>{MAIL_KIND_LABEL[m.kind]}</Pill> : <span className="text-faint">—</span>}
        </td>
        <td className="px-3 py-2 text-xs">
          {m.lotCode
            ? <>
                <div className="font-medium text-foreground">{m.lotCode}</div>
                <div className="text-faint"><span className="font-mono">{m.mpn}</span>{m.workOrderNo ? ` · WO ${m.workOrderNo}` : ""}</div>
              </>
            : <span className="text-faint">{m.kind === "BOOKING_REQUEST" || m.kind === "BOOKING_CONFIRMED" ? "order-level" : "unmatched"}</span>}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-start gap-1.5">
            {expanded ? <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0">
              <span className="block font-medium">{m.subject}</span>
              {!expanded && <span className="line-clamp-1 text-xs text-muted-foreground">{m.body}</span>}
            </span>
          </div>
        </td>
        <td className="px-3 py-2"><StatusPill status={m.status} /></td>
        <td className="px-3 py-2 text-xs">
          {m.attachments?.length
            ? <span className="inline-flex items-center gap-1 text-muted-foreground"><FileText className="h-3 w-3" /> {m.attachments.join(", ")}</span>
            : <span className="text-faint">—</span>}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {m.by}
          {m.matchedBy && <span className="block text-faint">matched by {m.matchedBy}</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-card-2/60 last:border-0">
          <td colSpan={8} className="px-3 py-3">
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{m.body}</p>
            {m.direction === "OUT" && m.status === "AWAITING_RESPONSE" && (
              <button className="mt-2 text-[11px] font-medium text-primary underline"
                onClick={(e) => { e.stopPropagation(); onEscalate(orderId, m.id); }}>
                Mark escalated
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
