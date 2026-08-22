"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Wand2, Mail, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Labeled, Input, Select, Textarea } from "@/components/ui/form";
import { Button, Pill } from "@/components/ui/primitives";
import { useStore } from "@/store/store";
import { remainingToShipLeg, remainingToAllocate, sourcedForClientLine, orderSourcedForClient, deliveredForClientLine } from "@/store/selectors";
import { incotermPlan, weClearImportCustoms } from "@/lib/incoterm";
import { shippingDocList } from "@/integrations/shipping-docs";
import { extractEscrowInvoiceFromOrder } from "@/integrations/doc-extract";
import { computeDuty } from "@/lib/fx";
import { money, fmtAddress, cn } from "@/lib/utils";
import {
  WHL_CONTACT, WHL_EMAIL_TEMPLATES, whlTemplate, notifyTemplate, notifyDigest, LAB_TERMS_LABEL, CURRENCIES,
  WHL_PROCESSES, TEST_STANDARDS, type WhlMailCtx, type NotifyCtx,
} from "@/data/enums";
import type {
  PaymentDirection, PaymentMode, ShipmentLeg, JourneyPhase, TradeType, TestingMode, LabEmail, NotifyParty, OrderBundle,
} from "@/types";

const PHASES: JourneyPhase[] = ["KICKOFF", "PAYMENT", "TESTING", "EXPORT", "IMPORT", "CUSTOMS", "RELABEL", "DELIVERY", "CLOSE"];
const OWNERS = ["SC", "Supplier", "Lab", "CHA", "Finance", "Approver"];

function Footer({ onClose, onSave, saveLabel = "Save", disabled }: { onClose: () => void; onSave: () => void; saveLabel?: string; disabled?: boolean }) {
  return (<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={onSave} disabled={disabled}>{saveLabel}</Button></>);
}

export function AddStepModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const addStep = useStore((s) => s.addStep);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<string>("DELIVERY");
  const [owner, setOwner] = useState("SC");
  const [gate, setGate] = useState(false);
  const save = () => { if (!name.trim()) return; addStep(orderId, { name, phase, owner, isGate: gate }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Add journey step" footer={<Footer onClose={onClose} onSave={save} saveLabel="Add step" disabled={!name.trim()} />}>
      <div className="space-y-3">
        <Labeled label="Step name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Re-inspect at hub" /></Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Phase"><Select value={phase} onChange={(e) => setPhase(e.target.value)}>{PHASES.map((p) => <option key={p}>{p}</option>)}</Select></Labeled>
          <Labeled label="Owner"><Select value={owner} onChange={(e) => setOwner(e.target.value)}>{OWNERS.map((o) => <option key={o}>{o}</option>)}</Select></Labeled>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)} /> This step is a gate (blocks progress)</label>
      </div>
    </Dialog>
  );
}

/**
 * Book a test slot with the lab — the step before any lot exists.
 *
 * The desk says what it wants tested (per MPN: lot qty, the sample the lab should pull, the date
 * code and the test plan), and the only thing this modal *does* is **mail the lab**. No lot, no
 * work order, no tracker: those arrive with the lab's confirmation, which is the point the desk
 * is allowed to act. The form is deliberately the same shape as the appointment it is asking for,
 * so the confirmation can be checked against what was requested.
 *
 * `retestOf` turns it into a re-test request: the mail cites the failed slot, and the lots the
 * confirmation creates skip straight to `COMPONENTS_RECEIVED` because the parts never left.
 */
export function BookTestSlotModal({
  orderId, retestOfSlotId, onlyMpn, onClose,
}: { orderId: string; retestOfSlotId?: string; onlyMpn?: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const requestTestSlot = useStore((s) => s.requestTestSlot);
  const prior = (b?.testSlots ?? []).find((x) => x.id === retestOfSlotId);

  const testable = (b?.lines ?? []).filter((l) => l.testingMode !== "NONE");
  // the lab pulls a sample, not the lot: ~5% clamped into a sane bench range
  const sampleFor = (qty: number) => Math.max(5, Math.min(50, Math.round(qty * 0.05)));
  const blank = (mpn: string) => {
    const line = testable.find((l) => l.mpn === mpn);
    const qty = line?.quantity ?? 0;
    return { key: `r${Math.round(qty)}-${mpn}-${testable.length}`, mpn, qty, sampleQty: sampleFor(qty), dateCode: "", preferredDate: "", tests: [] as { name: string; standard?: string }[] };
  };
  /**
   * One row per MPN the operator **chooses**, not one per testable line.
   *
   * The form used to open with a block for every testable line and a tick to exclude the ones you
   * did not want — which is backwards: a booking is usually for one part, occasionally two, and
   * unticking five blocks to book one is work. It opens with a single row and an `+ Add MPN` button
   * instead. Duplicate MPNs are allowed on purpose: splitting one line across two date codes is two
   * lots at the lab, not a mistake.
   *
   * A re-test still seeds from the failed submission — re-screening a lot that passed is paid work
   * nobody asked for, so only the MPNs whose verdict came back FAIL are pre-filled.
   */
  const failedMpns = new Set(
    (b?.lots ?? []).filter((l) => l.testSlotId === prior?.id && l.testStatus === "FAIL").map((l) => l.orderLineMpn),
  );
  const seed = prior
    ? prior.lines
        .filter((l) => failedMpns.size === 0 || failedMpns.has(l.mpn))
        .map((l, i) => ({ key: `rt${i}`, preferredDate: "", ...l }))
    // `onlyMpn` = booked from that MPN's own row, so open on it. The picker still lists every
    // testable line and `+ Add MPN` still works — pre-selection is the shortcut, not a lock.
    : [blank(onlyMpn && testable.some((l) => l.mpn === onlyMpn) ? onlyMpn : testable[0]?.mpn ?? "")];

  const [lab, setLab] = useState(prior?.lab ?? b?.lots[0]?.lab ?? "WHL Shenzhen");
  const [preferredDate, setPreferredDate] = useState("");
  const [note, setNote] = useState("");
  const [retestReason, setRetestReason] = useState(prior ? "Result not acceptable — re-screen required." : "");
  const [rows, setRows] = useState(seed);
  // no outbound mail leaves this app unseen: "details" collects it, "draft" shows exactly what
  // will be sent, and it stays editable right up to the send
  const [step, setStep] = useState<"details" | "draft">("details");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const draftTestSlotMail = useStore((s) => s.draftTestSlotMail);
  if (!b) return null;

  const patch = (i: number, d: Partial<(typeof rows)[number]>) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, ...d } : r)));
  // picking a different MPN re-seeds its quantities off that order line, since the old ones
  // belonged to the part that was there before
  const pickMpn = (i: number, mpn: string) => setRows((p) => p.map((r, j) => {
    if (j !== i) return r;
    const qty = testable.find((l) => l.mpn === mpn)?.quantity ?? r.qty;
    return { ...r, mpn, qty, sampleQty: sampleFor(qty) };
  }));
  const addRow = () => setRows((p) => [...p, { ...blank(testable[0]?.mpn ?? ""), key: `r${Date.now()}` }]);
  const removeRow = (i: number) => setRows((p) => p.filter((_, j) => j !== i));
  const toggleTest = (i: number, name: string) =>
    setRows((p) => p.map((r, j) => {
      if (j !== i) return r;
      const has = r.tests.some((t) => t.name === name);
      // no standard on a booking request — the lab states the standard it screens to on its
      // confirmation, so asking an operator to pick one here was asking them to guess
      return { ...r, tests: has ? r.tests.filter((t) => t.name !== name) : [...r.tests, { name }] };
    }));

  const chosen = rows.filter((r) => !!r.mpn);
  const ok = chosen.length > 0 && chosen.every((r) => r.qty > 0 && r.sampleQty > 0);

  const payload = () => ({
    lab: lab.trim() || "WHL Shenzhen",
    preferredDate: preferredDate || undefined,
    note: note.trim() || undefined,
    retestOfSlotId: prior?.id,
    retestReason: prior ? (retestReason.trim() || undefined) : undefined,
    lines: chosen.map(({ mpn, qty, sampleQty, dateCode, tests, preferredDate: rowDate }) => ({
      mpn, qty, sampleQty, dateCode, tests, preferredDate: rowDate || undefined,
    })),
  });

  const review = () => {
    if (!ok) return;
    const d = draftTestSlotMail(orderId, payload());
    setSubject(d.subject);
    setBody(d.body);
    setStep("draft");
  };

  const send = () => {
    if (!subject.trim() || !body.trim()) return;
    requestTestSlot(orderId, { ...payload(), subject, body });
    onClose();
  };

  return (
    <Dialog open onClose={onClose}
      title={prior ? `Book a re-test — against ${prior.slotNo}`
        : onlyMpn ? `Book a test slot — ${onlyMpn}`
        : "Book a test slot with the lab"}
      footer={step === "details"
        ? <><Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={review} disabled={!ok}><Mail className="h-4 w-4" /> Review the mail</Button></>
        : <><Button variant="ghost" onClick={() => setStep("details")}>← Back to details</Button>
            <Button onClick={send} disabled={!subject.trim() || !body.trim()}><Mail className="h-4 w-4" /> Send to {lab.split(" ")[0]}</Button></>}>
      {step === "draft" ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
            This is the mail that will go to <b className="text-foreground">{lab}</b> — edit anything before
            sending. Nothing has left yet, and the slot is only created once it does. It lands on the
            order&apos;s WHL thread under <b className="text-foreground">Communication</b>, and the lab&apos;s reply
            comes back the same way.
          </div>
          <Labeled label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Labeled>
          <Labeled label="Message" hint={`${chosen.length} MPN(s) · ${chosen.reduce((a, r) => a + r.tests.length, 0)} test(s) quoted`}>
            <Textarea rows={18} className="font-mono text-[11px]" value={body} onChange={(e) => setBody(e.target.value)} />
          </Labeled>
        </div>
      ) : (
      <div className="space-y-3">
        <div className={cn("rounded-lg p-2.5 text-xs", prior ? "bg-warn-bg text-warn" : "bg-muted text-muted-foreground")}>
          {prior ? (
            <>
              Re-testing against <b>{prior.slotNo}</b>{prior.appointmentNo ? ` (${prior.appointmentNo})` : ""}. The
              components are already at {prior.lab}, so the lots this creates start at{" "}
              <b>Components Received by WHL</b> — no dispatch is claimed that never happened.
            </>
          ) : (
            <>
              This <b className="text-foreground">only sends the request</b>. No lot, work order or tracker
              exists until {lab} confirms — check the mailbox on the testing screen to bring the
              confirmation in, and it creates the lots and their test plans.
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Lab"><Input value={lab} onChange={(e) => setLab(e.target.value)} /></Labeled>
          <Labeled label="Preferred start" hint="the default for every MPN below">
            <Input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
          </Labeled>
        </div>
        {prior && (
          <Labeled label="Why it is being re-tested" hint="quoted in the mail">
            <Input value={retestReason} onChange={(e) => setRetestReason(e.target.value)} />
          </Labeled>
        )}

        {testable.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No line on this order needs incoming testing.
          </p>
        ) : (
          <>
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-lg border p-3">
                {/* the MPN picker keeps a fixed width so the meta controls stay on its line
                    instead of wrapping under it */}
                <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <div className="w-[17rem] shrink-0">
                    <Labeled label={`MPN ${rows.length > 1 ? `#${i + 1}` : ""}`}>
                      <Select value={r.mpn} onChange={(e) => pickMpn(i, e.target.value)}>
                        {testable.map((l) => (
                          <option key={l.id} value={l.mpn}>{l.mpn} — {l.make} · order qty {l.quantity}</option>
                        ))}
                      </Select>
                    </Labeled>
                  </div>
                  {/* one group, so a narrow dialog moves all three together instead of orphaning
                      "remove" on its own line */}
                  <span className="ml-auto flex items-center gap-3 whitespace-nowrap pb-2 text-[11px]">
                    <span className="text-faint">{r.tests.length} test(s) selected</span>
                    <button type="button" className="font-medium text-primary hover:underline"
                      onClick={() => patch(i, { tests: r.tests.length === WHL_PROCESSES.length ? [] : WHL_PROCESSES.map((n) => ({ name: n })) })}>
                      {r.tests.length === WHL_PROCESSES.length ? "clear tests" : "select all tests"}
                    </button>
                    {/* always available, including on the last row: deleting it leaves an empty
                        booking, which is recoverable (Add MPN) and better than a control that
                        appears and disappears depending on how many rows there happen to be */}
                    <button type="button" onClick={() => removeRow(i)}
                      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium text-muted-foreground transition hover:border-bad hover:text-bad"
                      title="Delete this MPN from the booking">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </span>
                </div>
                {/* 2×2, not four across: the dialog is ~500px and a four-column row squeezed
                    "Preferred start" onto two label lines with a stub of an input under it */}
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="Lot qty"><Input type="number" value={r.qty} onChange={(e) => patch(i, { qty: +e.target.value })} /></Labeled>
                  <Labeled label="Sample qty" hint="what the lab pulls"><Input type="number" value={r.sampleQty} onChange={(e) => patch(i, { sampleQty: +e.target.value })} /></Labeled>
                  <Labeled label="Date code"><Input value={r.dateCode} onChange={(e) => patch(i, { dateCode: e.target.value })} placeholder="2410" /></Labeled>
                  {/* only quoted to the lab when it differs from the slot-level default above —
                      one part having to go on the bench before another is a real request, but
                      repeating the same date under every MPN is noise */}
                  <Labeled label="Preferred start" hint={preferredDate ? "overrides the default" : "optional"}>
                    <Input type="date" value={r.preferredDate ?? ""} onChange={(e) => patch(i, { preferredDate: e.target.value })} />
                  </Labeled>
                </div>
                <div className="mt-2 grid gap-1 rounded-lg border p-2 sm:grid-cols-2">
                  {WHL_PROCESSES.map((name) => (
                    <label key={name} className="flex items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5" checked={r.tests.some((t) => t.name === name)} onChange={() => toggleTest(i, name)} />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No MPN on this booking — add one to send the request.
              </p>
            )}
            <Button variant="outline" onClick={addRow} title="Add another MPN to this booking — same fields and test plan">
              <Plus className="h-4 w-4" /> Add MPN
            </Button>
          </>
        )}

        <Labeled label="Note to the lab" hint="anything else the booking needs">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Labeled>
        <p className="text-xs text-faint">
          Leaving a test plan empty asks the lab for its standard screen — the confirmation states what it will run.
        </p>
      </div>
      )}
    </Dialog>
  );
}

/**
 * Raise a test lot, two ways.
 *
 * A lot exists because the lab agreed to test it, and that agreement arrives as a **booking
 * appointment** — which names the lots, their samples, the work orders and the test plan. So the
 * normal path is to upload that document and let it write everything. But an operator who has
 * booked over the phone, or is setting up before the paperwork lands, still needs to raise a lot
 * and say what is being run: hence the manual form, which asks for the test plan too (the
 * per-MPN requirements surface is parked — see CONTEXT §9.2 — so this form is where a hand-typed
 * plan gets in).
 *
 * The appointment path here is the **only order-wide** call to `uploadBookingAppointment`: it is
 * the one that *creates* lots. Everywhere else the action is lot-scoped (§9.3).
 */
export function AddLotModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const addLot = useStore((s) => s.addLot);
  const uploadBookingAppointment = useStore((s) => s.uploadBookingAppointment);

  const [mode, setMode] = useState<"manual" | "appointment">("appointment");
  const [mpn, setMpn] = useState(b?.lines[0]?.mpn ?? "");
  const [lotCode, setLotCode] = useState("");
  const [dateCode, setDateCode] = useState("");
  const [qty, setQty] = useState(0);
  const [sampleQty, setSampleQty] = useState(0);
  const [lab, setLab] = useState("WHL Shenzhen");
  const [standard, setStandard] = useState<string>("AS6081");
  const [tests, setTests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!b) return null;

  const toggleTest = (name: string) => setTests((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));

  const save = () => {
    if (!mpn || !lotCode.trim()) return;
    addLot(orderId, {
      orderLineMpn: mpn, lotCode: lotCode.trim(), dateCode, qty, sampleQty,
      lab: lab.trim() || "WHL Shenzhen",
      tests: tests.map((name) => ({ name, standard: standard || undefined })),
    });
    onClose();
  };

  const readAppointment = async (file: { name: string; size: number } | null) => {
    setBusy(true);
    await uploadBookingAppointment(orderId, file);   // order-wide: this is what creates the lots
    setBusy(false);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Add test lot"
      footer={mode === "manual"
        ? <Footer onClose={onClose} onSave={save} saveLabel="Add test lot" disabled={!lotCode.trim() || !mpn} />
        : <Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <div className="space-y-3">
        {/* two ways in, same as the app's other segmented controls */}
        <div className="inline-flex items-center gap-1 rounded-lg border bg-background p-0.5">
          {([
            ["appointment", "From booking appointment"],
            ["manual", "Enter details by hand"],
          ] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-current={mode === m ? "true" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>

        {mode === "appointment" ? (
          <>
            <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
              The lab&apos;s booking appointment is the document that starts testing: it names{" "}
              <b className="text-foreground">which lots</b> go in, the{" "}
              <b className="text-foreground">sample</b> pulled from each, the date codes, the{" "}
              <b className="text-foreground">work order</b> it will bill against, the quoted TAT and the{" "}
              <b className="text-foreground">test plan</b>. Reading it creates the lots and fills their
              trackers in one step — nothing below needs typing.
              <p className="mt-1">A lot that already exists is topped up, never overwritten.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="add-lot-appointment"
                className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  busy ? "pointer-events-none opacity-50" : "cursor-pointer bg-primary text-primary-foreground hover:brightness-110")}>
                <Upload className="h-4 w-4" /> Choose appointment PDF
              </label>
              <input id="add-lot-appointment" type="file" accept="application/pdf,.pdf" className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void readAppointment({ name: f.name, size: f.size });
                }} />
              <Button variant="outline" disabled={busy} onClick={() => void readAppointment(null)}
                title="Fill from a sample booking appointment (demo data — the real lab feed replaces this)">
                <Wand2 className="h-4 w-4" /> Use a sample appointment
              </Button>
              {busy && <span className="text-xs text-muted-foreground">reading…</span>}
            </div>
            <p className="text-xs text-faint">
              No appointment yet? Switch to <b className="text-muted-foreground">Enter details by hand</b>.
            </p>
          </>
        ) : (
          <>
            <Labeled label="MPN">
              <Select value={mpn} onChange={(e) => setMpn(e.target.value)}>
                {b.lines.map((l) => <option key={l.id} value={l.mpn}>{l.mpn}</option>)}
              </Select>
            </Labeled>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Lot code *"><Input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="LOT-C" /></Labeled>
              <Labeled label="Date code"><Input value={dateCode} onChange={(e) => setDateCode(e.target.value)} placeholder="2410" /></Labeled>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Lot qty"><Input type="number" value={qty} onChange={(e) => setQty(+e.target.value)} /></Labeled>
              <Labeled label="Sample qty" hint="what the lab pulls off the lot"><Input type="number" value={sampleQty} onChange={(e) => setSampleQty(+e.target.value)} /></Labeled>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Lab"><Input value={lab} onChange={(e) => setLab(e.target.value)} placeholder="WHL Shenzhen" /></Labeled>
              <Labeled label="Standard" hint="applied to every test ticked below">
                <Select value={standard} onChange={(e) => setStandard(e.target.value)}>
                  <option value="">—</option>
                  {TEST_STANDARDS.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Labeled>
            </div>

            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Test plan — what the lab is running
                </span>
                <span className="text-[11px] text-faint">
                  {tests.length} selected ·{" "}
                  <button type="button" className="font-medium text-primary hover:underline"
                    onClick={() => setTests(tests.length === WHL_PROCESSES.length ? [] : [...WHL_PROCESSES])}>
                    {tests.length === WHL_PROCESSES.length ? "clear" : "select all"}
                  </button>
                </span>
              </div>
              <div className="grid gap-1 rounded-lg border p-2 sm:grid-cols-2">
                {WHL_PROCESSES.map((name) => (
                  <label key={name} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={tests.includes(name)} onChange={() => toggleTest(name)} />
                    <span>{name}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-faint">
                Ticked tests are written onto this lot <b className="text-muted-foreground">and</b>{" "}
                onto the MPN&apos;s
                requirement list, flagged manual and logged. Leave all unticked to inherit whatever the MPN already carries.
              </p>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Record the supplier → WHL leg by hand. The lab can't tell us a shipment exists until
 * it lands, so this stage comes from the supplier's own dispatch advice — which normally
 * arrives on the lot's thread and moves the stage on its own. This is the fallback for a
 * supplier who phoned it in. Everything is optional except the fact of dispatch: chasing
 * a supplier for an AWB shouldn't block the chain from showing the lot as on its way.
 */
export function RecordDispatchModal({
  orderId, lotId, onClose,
}: { orderId: string; lotId: string; onClose: () => void }) {
  const lot = useStore((s) => s.orders[orderId]?.lots.find((l) => l.id === lotId));
  const recordSupplierDispatch = useStore((s) => s.recordSupplierDispatch);
  const [courier, setCourier] = useState(lot?.dispatch?.courier ?? "DHL Express");
  const [awb, setAwb] = useState(lot?.dispatch?.awb ?? "");
  const [dispatchedOn, setDispatchedOn] = useState(lot?.dispatch?.dispatchedOn ?? new Date().toISOString().slice(0, 10));
  const [expectedArrival, setExpectedArrival] = useState(lot?.dispatch?.expectedArrival ?? "");
  const [note, setNote] = useState(lot?.dispatch?.note ?? "");
  if (!lot) return null;

  const save = () => {
    recordSupplierDispatch(orderId, lotId, {
      courier: courier.trim() || undefined,
      awb: awb.trim() || undefined,
      dispatchedOn: dispatchedOn || undefined,
      expectedArrival: expectedArrival || undefined,
      note: note.trim() || undefined,
    });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Record supplier dispatch to WHL"
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Record dispatch" />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
          <b className="text-foreground">{lot.lotCode}</b> · <span className="font-mono">{lot.orderLineMpn}</span> · sample {lot.sampleQty} of {lot.qty}
          {lot.workOrderNo ? <> · WO {lot.workOrderNo}</> : null} → <b className="text-foreground">{lot.lab ?? "WHL"}</b>
          <p className="mt-1">
            Moves the lot to <b className="text-foreground">Supplier Dispatching Components</b>. WHL&apos;s receipt confirmation then advances it again on the next mail sync.
          </p>
          <p className="mt-1 text-faint">
            Only needed if the supplier phoned the details in — a dispatch advice on the lot&apos;s thread records this on its own.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Courier"><Input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="DHL Express" /></Labeled>
          <Labeled label="AWB / tracking no" hint="optional — leave blank if the supplier hasn't shared it">
            <Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="1Z-…" />
          </Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Dispatched on"><Input type="date" value={dispatchedOn} onChange={(e) => setDispatchedOn(e.target.value)} /></Labeled>
          <Labeled label="Expected at lab" hint="optional"><Input type="date" value={expectedArrival} onChange={(e) => setExpectedArrival(e.target.value)} /></Labeled>
        </div>
        <Labeled label="Note" hint="how the supplier told us — mail, call, portal">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Supplier confirmed by mail; samples drawn from the same date-code reel." />
        </Labeled>
      </div>
    </Dialog>
  );
}

/**
 * Record the transfer finance released against WHL's testing invoice, by hand.
 *
 * Normally the lab's own payment acknowledgement closes this stage on the next mail sync —
 * this is the fallback for when finance confirms out of band and the lab hasn't caught up,
 * which is why it's the ghost button and not the primary one.
 */
/**
 * The lab's invoice, typed in. Normally `syncWhlInbox` parses it off WHL's own mail; this is the
 * way out when that mail never arrives, never parsed, or the lab sent the bill by another medium
 * — otherwise the fee track dead-ends at "invoice requested" and an advance-terms lot stays held
 * with no way to release it.
 *
 * The operator is **transcribing** the lab's document, not deciding its terms: the amount is
 * pre-computed from the lab's own rate card so a typo stands out, `How it reached us` is required
 * reading for whoever pays it, and the saved invoice is flagged `entered by hand` everywhere it
 * shows so nobody mistakes it for the mail.
 */
export function MarkLabFeePaidModal({
  orderId, lotId, onClose,
}: { orderId: string; lotId: string; onClose: () => void }) {
  const lot = useStore((s) => s.orders[orderId]?.lots.find((l) => l.id === lotId));
  const markLabFeePaid = useStore((s) => s.markLabFeePaid);
  const [paidRef, setPaidRef] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  if (!lot) return null;
  const inv = lot.labPayment?.invoice;
  const gross = inv ? inv.amount + (inv.taxAmount ?? 0) : 0;

  const save = () => {
    markLabFeePaid(orderId, lotId, { paidRef: paidRef.trim() || undefined, paidAt: paidAt || undefined, note: note.trim() || undefined });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Record WHL fee payment"
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Mark paid" />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
          <b className="text-foreground">{lot.lotCode}</b> · <span className="font-mono">{lot.orderLineMpn}</span>
          {lot.workOrderNo ? <> · WO {lot.workOrderNo}</> : null} · {lot.lab ?? "WHL"}
          {inv ? (
            <p className="mt-1">
              Invoice <b className="text-foreground">{inv.invoiceNo}</b> — {inv.currency} {inv.amount.toLocaleString()}
              {inv.taxAmount ? ` + tax ${inv.taxAmount.toLocaleString()}` : ""} = <b className="text-foreground">{inv.currency} {gross.toLocaleString()}</b>
              {inv.dueDate ? ` · due ${inv.dueDate}` : ""} · <b className="text-foreground">{LAB_TERMS_LABEL[inv.terms].toLowerCase()}</b>{" "}terms
            </p>
          ) : <p className="mt-1 text-warn">No invoice on file yet — recording payment without one is unusual; confirm with finance first.</p>}
          <p className="mt-1">
            Closes the <b className="text-foreground">Payment to WHL</b> stage
            {inv?.terms === "ADVANCE" ? <> and releases the lot from the lab&apos;s hold</> : null}.
            {" "}WHL&apos;s own payment acknowledgement does this automatically on the next mail sync — use this only if finance
            confirmed out of band.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Transfer reference" hint="the UTR / wire ref finance sends back">
            <Input value={paidRef} onChange={(e) => setPaidRef(e.target.value)} placeholder="UTR-…" />
          </Labeled>
          <Labeled label="Paid on"><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Labeled>
        </div>
        <Labeled label="Note" hint="optional — part payment, FX difference, anything the lab should be told">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Labeled>
      </div>
    </Dialog>
  );
}

/**
 * Compose to WHL — pre-filled with the lot's MPN / lot code / PO / work order so the
 * operator never has to look up WHL's address or reference numbers. In-app send logs
 * the message against the lot; "mailto" is offered as the quick fallback.
 */

export function ComposeWhlEmailModal({
  orderId, lotId, templateId, onClose,
}: { orderId: string; lotId?: string; templateId?: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const sendLabEmail = useStore((s) => s.sendLabEmail);

  // context for the templates — pulled off the lot so nothing has to be typed or looked up
  const ctxFor = (lid: string): WhlMailCtx => {
    const l = b?.lots.find((x) => x.id === lid);
    const rep = l ? (l.reports ?? []).find((r) => r.current) : undefined;
    return {
      entity: b?.maskingEntity ?? "1Buy", mpn: l?.orderLineMpn, lotCode: l?.lotCode, qty: l?.qty,
      sampleQty: l?.sampleQty, workOrderNo: l?.workOrderNo, clientPoNo: l?.clientPoNo,
      reportNo: rep?.reportNo ?? l?.reportNo, lab: l?.lab, dateCode: l?.dateCode,
    };
  };

  const [lot, setLot] = useState(lotId ?? b?.lots[0]?.id ?? "");
  const [tplId, setTplId] = useState(templateId ?? WHL_EMAIL_TEMPLATES[0].id);
  const [subject, setSubject] = useState(() => whlTemplate(templateId ?? WHL_EMAIL_TEMPLATES[0].id).subject(ctxFor(lotId ?? b?.lots[0]?.id ?? "")));
  const [body, setBody] = useState(() => whlTemplate(templateId ?? WHL_EMAIL_TEMPLATES[0].id).body(ctxFor(lotId ?? b?.lots[0]?.id ?? "")));
  const [edited, setEdited] = useState(false); // don't clobber the operator's edits on a re-pick

  if (!b) return null;
  const tpl = whlTemplate(tplId);

  // re-fill subject + body from a template (called on template / lot change, and on "reset")
  const fill = (id: string, lid: string) => {
    const t = whlTemplate(id);
    const c = ctxFor(lid);
    setSubject(t.subject(c));
    setBody(t.body(c));
    setEdited(false);
  };

  const mailto = `mailto:${WHL_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const save = () => { if (!subject.trim() || !body.trim()) return; sendLabEmail(orderId, { lotId: lot || undefined, subject, body }); onClose(); };

  return (
    <Dialog open onClose={onClose} title="Email WHL"
      footer={<>
        <a href={mailto} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted">Open in mail client</a>
        <Footer onClose={onClose} onSave={save} saveLabel="Send & log" disabled={!subject.trim() || !body.trim()} />
      </>}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
          To <b className="text-foreground">{WHL_CONTACT}</b> — pick a template, tweak the wording, send.
          Sending in-app keeps the message on the lot&apos;s thread instead of in someone&apos;s Sent items.
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Template" hint={tpl.hint}>
            <Select value={tplId} onChange={(e) => { const v = e.target.value; setTplId(v); fill(v, lot); }}>
              {WHL_EMAIL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Lot (references auto-filled)">
            <Select value={lot} onChange={(e) => { const v = e.target.value; setLot(v); fill(tplId, v); }}>
              <option value="">— no specific lot —</option>
              {b.lots.map((x) => <option key={x.id} value={x.id}>{x.lotCode} · {x.orderLineMpn} · WO {x.workOrderNo ?? "—"}</option>)}
            </Select>
          </Labeled>
        </div>
        <Labeled label="Subject"><Input value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} /></Labeled>
        <Labeled label="Message" hint="pre-filled from the template — edit freely">
          <Textarea className="min-h-[220px] font-mono text-xs" value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
        </Labeled>
        {edited && (
          <button type="button" onClick={() => fill(tplId, lot)} className="text-xs font-medium text-primary hover:underline">
            Reset to the “{tpl.label}” template
          </button>
        )}
      </div>
    </Dialog>
  );
}

/**
 * "The result is in — tell someone." Pre-filled per counterparty from the lot + its
 * current report; the operator edits and sends. Supplier and buyer templates are
 * masked from each other, and attaching the report carries an NDA caveat.
 */

export function NotifyLotResultModal({
  orderId, lotId, party, onClose,
}: { orderId: string; lotId: string; party: NotifyParty; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const notifyLotResult = useStore((s) => s.notifyLotResult);
  const lot = b?.lots.find((x) => x.id === lotId);

  const ctxFor = (): NotifyCtx => {
    const rep = (lot?.reports ?? []).find((r) => r.current) ?? (lot?.reports ?? [])[0];
    return {
      entity: b?.maskingEntity ?? "1Buy", orderNo: b?.orderNo ?? "—", mpn: lot?.orderLineMpn ?? "—",
      lotCode: lot?.lotCode ?? "—", qty: lot?.qty ?? 0, sampleQty: lot?.sampleQty, dateCode: lot?.dateCode,
      reportNo: rep?.reportNo, reportDate: rep?.reportDate, workOrderNo: lot?.workOrderNo,
      conclusion: rep?.conclusion, anyFar: rep?.anyFar, clientPoNo: lot?.clientPoNo,
      supplierPoNo: b?.supplierPoNo, escrowRef: b?.escrow?.invoice?.invoiceNo ?? b?.orderNo,
      releasable: b?.escrow?.poAmount, currency: b?.currency, lab: lot?.lab,
      // the finance mail bills the lab's invoice, not the test report
      invoiceNo: lot?.labPayment?.invoice?.invoiceNo,
      invoiceAmount: lot?.labPayment?.invoice?.amount,
      invoiceTax: lot?.labPayment?.invoice?.taxAmount,
      invoiceCurrency: lot?.labPayment?.invoice?.currency,
      invoiceDueDate: lot?.labPayment?.invoice?.dueDate,
      invoiceFile: lot?.labPayment?.invoice?.fileName,
      invoiceTerms: lot?.labPayment?.invoice?.terms,
    };
  };

  const [to, setTo] = useState(() => notifyTemplate(party).to(ctxFor()));
  const [subject, setSubject] = useState(() => notifyTemplate(party).subject(ctxFor()));
  const [body, setBody] = useState(() => notifyTemplate(party).body(ctxFor()));
  const [attach, setAttach] = useState(party !== "WHL");
  const isFinance = party === "FINANCE";
  const [edited, setEdited] = useState(false);

  if (!b || !lot) return null;
  const tpl = notifyTemplate(party);
  const rep = (lot.reports ?? []).find((r) => r.current) ?? (lot.reports ?? [])[0];
  const inv = lot.labPayment?.invoice;
  const doc = isFinance ? inv?.fileName : rep?.fileName;   // what the attachment tick actually sends
  const reset = () => { const c = ctxFor(); setTo(tpl.to(c)); setSubject(tpl.subject(c)); setBody(tpl.body(c)); setEdited(false); };
  const save = () => {
    if (!to.trim() || !subject.trim() || !body.trim()) return;
    notifyLotResult(orderId, lotId, { party, to: to.trim(), subject, body, attachReport: attach && !!doc });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={tpl.label}
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Send notification" disabled={!to.trim() || !subject.trim() || !body.trim()} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
          <b className="text-foreground">{lot.lotCode}</b> · <span className="font-mono">{lot.orderLineMpn}</span> · qty {lot.qty}
          {isFinance
            ? (inv
                ? <> · invoice <b className="text-foreground">{inv.invoiceNo}</b> — {inv.currency} {(inv.amount + (inv.taxAmount ?? 0)).toLocaleString()}{inv.dueDate ? ` · due ${inv.dueDate}` : ""}
                    {" · "}<b className={inv.terms === "ADVANCE" ? "text-warn" : "text-foreground"}>{LAB_TERMS_LABEL[inv.terms].toLowerCase()}</b>
                    {inv.terms === "ADVANCE" && lot.labPayment?.status !== "PAID" && <span className="text-bad"> — lot held at the lab</span>}</>
                : <span className="text-warn"> · no WHL invoice received yet</span>)
            : (rep ? <> · report <b className="text-foreground">{rep.reportNo}</b> — {rep.conclusion.replace(/_/g, " ").toLowerCase()}{rep.anyFar ? " (F.A.R. flagged)" : ""}</> : " · no report yet")}
        </div>
        {tpl.masking && <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg px-2.5 py-2 text-xs text-warn">{tpl.masking}</p>}
        <Labeled label="To" hint="mock address in the POC — edit freely"><Input value={to} onChange={(e) => { setTo(e.target.value); setEdited(true); }} /></Labeled>
        <Labeled label="Subject"><Input value={subject} onChange={(e) => { setSubject(e.target.value); setEdited(true); }} /></Labeled>
        <Labeled label="Message" hint="pre-filled from the template — edit before sending">
          <Textarea className="min-h-[220px] font-mono text-xs" value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
        </Labeled>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={attach} disabled={!doc} onChange={(e) => setAttach(e.target.checked)} />
          <span>
            {isFinance ? "Attach the WHL invoice" : "Attach the test report"} {doc ? <span className="font-mono text-xs">{doc}</span> : <span className="text-faint">(none received yet)</span>}
            <span className="block text-[11px] text-muted-foreground">
              {isFinance
                ? "Finance needs the invoice itself to release the transfer; the send is logged on the lot's notification log."
                : "WHL reports are issued under NDA — attaching one records the disclosure on the lot's notification log."}
            </span>
          </span>
        </label>
        {edited && <button type="button" onClick={reset} className="text-xs font-medium text-primary hover:underline">Reset to the template</button>}
      </div>
    </Dialog>
  );
}

/**
 * Bulk sibling of NotifyLotResultModal: one digest mail for many lots.
 *
 * Buyer mails are split per client PO — one order can serve several clients, and a
 * client must never see another client's lots. Supplier / escrow / lab are single
 * recipients per order, so those go out as one mail.
 */

export function BulkNotifyModal({
  orderId, lotIds, party, onClose,
}: { orderId: string; lotIds: string[]; party: NotifyParty; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const notifyLotsResult = useStore((s) => s.notifyLotsResult);

  const lots = (b?.lots ?? []).filter((l) => lotIds.includes(l.id));
  const repOf = (l: (typeof lots)[number]) => (l.reports ?? []).find((r) => r.current) ?? (l.reports ?? [])[0];
  const withReport = lots.filter((l) => !!repOf(l));
  const noReport = lots.filter((l) => !repOf(l));
  // finance mails carry invoices, not reports — so "what's attached" and "what's missing" differ
  const withInvoice = lots.filter((l) => !!l.labPayment?.invoice);
  const noInvoice = lots.filter((l) => !l.labPayment?.invoice);

  // groups = one outbound mail each
  const groups = party === "BUYER"
    ? Array.from(new Set(lots.map((l) => l.clientPoNo ?? "—"))).map((po) => ({ key: po, lots: lots.filter((l) => (l.clientPoNo ?? "—") === po) }))
    : [{ key: "ALL", lots }];

  const digestFor = (grp: { key: string; lots: typeof lots }) => notifyDigest(party, {
    entity: b?.maskingEntity ?? "1Buy", orderNo: b?.orderNo ?? "—",
    supplierPoNo: b?.supplierPoNo, clientPoNo: party === "BUYER" && grp.key !== "ALL" ? grp.key : undefined,
    escrowRef: b?.escrow?.invoice?.invoiceNo ?? b?.orderNo, currency: b?.currency, releasable: b?.escrow?.poAmount,
    lots: grp.lots.map((l) => {
      const r = repOf(l);
      const iv = l.labPayment?.invoice;
      return { mpn: l.orderLineMpn, lotCode: l.lotCode, qty: l.qty, sampleQty: l.sampleQty, dateCode: l.dateCode,
        reportNo: r?.reportNo, reportDate: r?.reportDate, conclusion: r?.conclusion, anyFar: r?.anyFar, lab: l.lab, workOrderNo: l.workOrderNo,
        invoiceNo: iv?.invoiceNo, invoiceAmount: iv?.amount, invoiceTax: iv?.taxAmount,
        invoiceCurrency: iv?.currency, invoiceDueDate: iv?.dueDate, invoiceTerms: iv?.terms };
    }),
  });

  const tpl = notifyTemplate(party);
  const [active, setActive] = useState(0);          // which group we're previewing / editing
  const [to, setTo] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState<Record<string, string>>({});
  const [body, setBody] = useState<Record<string, string>>({});
  const [attach, setAttach] = useState(party !== "WHL");
  const isFinance = party === "FINANCE";

  if (!b || lots.length === 0) return null;
  const grp = groups[Math.min(active, groups.length - 1)];
  const d = digestFor(grp);
  const curTo = to[grp.key] ?? tpl.to({ entity: b.maskingEntity, orderNo: b.orderNo, mpn: "", lotCode: "", qty: 0 });
  const curSubject = subject[grp.key] ?? d.subject;
  const curBody = body[grp.key] ?? d.body;

  const send = () => {
    for (const g of groups) {
      const gd = digestFor(g);
      notifyLotsResult(orderId, g.lots.map((l) => l.id), {
        party,
        to: to[g.key] ?? tpl.to({ entity: b.maskingEntity, orderNo: b.orderNo, mpn: "", lotCode: "", qty: 0 }),
        subject: subject[g.key] ?? gd.subject,
        body: body[g.key] ?? gd.body,
        attachReports: attach,
      });
    }
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={`${tpl.label} — ${lots.length} test lot(s)`}
      footer={<Footer onClose={onClose} onSave={send} saveLabel={`Send ${groups.length} mail${groups.length > 1 ? "s" : ""}`} disabled={!curTo.trim() || !curSubject.trim()} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
          One digest instead of {lots.length} separate mails.
          {party === "BUYER" && groups.length > 1 && <> Split into <b className="text-foreground">{groups.length} mails — one per sales order</b>, so no client sees another&apos;s lots.</>}
        </div>
        {tpl.masking && <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg px-2.5 py-2 text-xs text-warn">{tpl.masking}</p>}
        {(isFinance ? noInvoice : noReport).length > 0 && (
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg px-2.5 py-2 text-xs text-warn">
            {isFinance
              ? <>{noInvoice.length} selected test lot(s) have no WHL invoice yet ({noInvoice.map((l) => l.lotCode).join(", ")}) — they are excluded from this payment run. {withInvoice.length} of {lots.length} carry an invoice.</>
              : <>{noReport.length} selected test lot(s) have no report yet ({noReport.map((l) => l.lotCode).join(", ")}) — they are listed as “result pending”. {withReport.length} of {lots.length} carry a report.</>}
          </p>
        )}

        {groups.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g, i) => (
              <button key={g.key} type="button" onClick={() => setActive(i)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${i === (active < groups.length ? active : 0) ? "border-primary bg-accent-soft text-primary" : "hover:border-primary"}`}>
                {g.key} · {g.lots.length} test lot(s)
              </button>
            ))}
          </div>
        )}

        <div className="rounded-lg border">
          <div className="border-b bg-card-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lots in this mail ({grp.lots.length})
          </div>
          <ul className="max-h-40 divide-y overflow-y-auto text-xs">
            {grp.lots.map((l) => {
              const r = repOf(l);
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <span className="font-medium">{l.lotCode}</span>
                  <span className="font-mono text-muted-foreground">{l.orderLineMpn}</span>
                  <span className="text-faint">qty {l.qty}</span>
                  {r ? <span className={r.conclusion === "ACCEPTABLE" ? "text-ok" : "text-bad"}>{r.reportNo} · {r.conclusion.replace(/_/g, " ").toLowerCase()}{r.anyFar ? " (F.A.R.)" : ""}</span>
                     : <span className="text-warn">no report yet</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <Labeled label="To" hint="mock address in the POC — edit freely">
          <Input value={curTo} onChange={(e) => setTo((p) => ({ ...p, [grp.key]: e.target.value }))} />
        </Labeled>
        <Labeled label="Subject">
          <Input value={curSubject} onChange={(e) => setSubject((p) => ({ ...p, [grp.key]: e.target.value }))} />
        </Labeled>
        <Labeled label="Message" hint="digest pre-filled with every lot and its verdict — edit before sending">
          <Textarea className="min-h-[240px] font-mono text-xs" value={curBody} onChange={(e) => setBody((p) => ({ ...p, [grp.key]: e.target.value }))} />
        </Labeled>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={attach}
            disabled={(isFinance ? withInvoice : withReport).length === 0}
            onChange={(e) => setAttach(e.target.checked)} />
          <span>
            {isFinance
              ? <>Attach all available invoices ({withInvoice.length} PDF{withInvoice.length === 1 ? "" : "s"})</>
              : <>Attach all available reports ({withReport.length} PDF{withReport.length === 1 ? "" : "s"})</>}
            <span className="block text-[11px] text-muted-foreground">
              {isFinance
                ? "Finance needs each invoice to release the transfers; the send is logged on every lot the run covered."
                : "Each disclosure is logged on every lot the digest covered."}
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/** Resolve one inbound mail out of the manual-match queue. */
export function MatchLabEmailModal({ orderId, email, onClose }: { orderId: string; email: LabEmail; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const matchLabEmail = useStore((s) => s.matchLabEmail);
  const [lot, setLot] = useState(b?.lots[0]?.id ?? "");
  if (!b) return null;
  const save = () => { if (!lot) return; matchLabEmail(orderId, email.id, lot); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Match inbound email to a lot"
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Match" disabled={!lot} />}>
      <div className="space-y-3">
        <div className="rounded-lg border p-2.5">
          <div className="text-sm font-medium">{email.subject}</div>
          <div className="text-xs text-muted-foreground">{email.by} · {email.at}</div>
          <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{email.body}</p>
        </div>
        {email.matchNote && <p className="text-xs text-warn">{email.matchNote}</p>}
        <Labeled label="Lot" hint="the mail's updates get applied to this lot's tracker">
          <Select value={lot} onChange={(e) => setLot(e.target.value)}>
            {b.lots.map((x) => <option key={x.id} value={x.id}>{x.lotCode} · {x.orderLineMpn} · WO {x.workOrderNo ?? "—"}</option>)}
          </Select>
        </Labeled>
      </div>
    </Dialog>
  );
}

export function UploadEscrowInvoiceModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const uploadEscrowInvoiceManually = useStore((s) => s.uploadEscrowInvoiceManually);
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [feeToBuyer, setFeeToBuyer] = useState(60);
  const [wiringFeeToBuyer, setWiringFeeToBuyer] = useState(40);
  const [feeToSeller, setFeeToSeller] = useState(0);
  const [wiringFeeToSeller, setWiringFeeToSeller] = useState(0);
  const [inspectionPeriod, setInspectionPeriod] = useState("5 business days");
  const [shipWithinDays, setShipWithinDays] = useState("7 business days");
  const [forwarder, setForwarder] = useState("DHL");
  const [forwarderAccountNo, setForwarderAccountNo] = useState("");
  const [feeSharingLabel, setFeeSharingLabel] = useState("100% Buyer / 0% Seller");
  const [returnCondition, setReturnCondition] = useState("7 business days, shipping fees to Seller");
  const [milestone1Pct, setMilestone1Pct] = useState(30);
  const [milestone1Trigger, setMilestone1Trigger] = useState("On shipment to WHL for testing");
  const [milestone2Pct, setMilestone2Pct] = useState(70);
  const [milestone2Trigger, setMilestone2Trigger] = useState("On WHL PASS report");
  if (!b || !b.escrow) return null;

  async function parseOrder() {
    const file = fileRef.current?.files?.[0];
    const name = file?.name ?? "order.pdf";
    setParsing(true);
    try {
      const res = await extractEscrowInvoiceFromOrder({ fileName: name, bytesLen: file?.size ?? 0 });
      setInvoiceNo(res.invoiceNo);
      setFeeToBuyer(res.fees.feeToBuyer); setWiringFeeToBuyer(res.fees.wiringFeeToBuyer);
      setFeeToSeller(res.fees.feeToSeller); setWiringFeeToSeller(res.fees.wiringFeeToSeller);
      setForwarder(res.conditions.forwarder); setForwarderAccountNo(res.conditions.forwarderAccountNo ?? "");
      setShipWithinDays(res.conditions.shipWithinDays); setInspectionPeriod(res.conditions.inspectionPeriod);
      setFeeSharingLabel(res.conditions.feeSharingLabel); setReturnCondition(res.conditions.returnCondition);
      if (res.conditions.releaseMilestones[0]) { setMilestone1Pct(res.conditions.releaseMilestones[0].percent); setMilestone1Trigger(res.conditions.releaseMilestones[0].trigger); }
      if (res.conditions.releaseMilestones[1]) { setMilestone2Pct(res.conditions.releaseMilestones[1].percent); setMilestone2Trigger(res.conditions.releaseMilestones[1].trigger); }
      toast.success(`Parsed ${name} (${Math.round(res.overallConfidence * 100)}% confidence) — review below`);
    } catch (e) {
      toast.error(`Parse failed: ${e instanceof Error ? e.message : String(e)} — enter manually`);
    } finally {
      setParsing(false);
    }
  }

  const save = () => {
    if (!invoiceNo.trim()) return;
    uploadEscrowInvoiceManually(orderId, {
      invoiceNo: invoiceNo.trim(),
      fees: { poTotal: b.escrow!.poAmount, feeToBuyer, wiringFeeToBuyer, feeToSeller, wiringFeeToSeller },
      conditions: {
        forwarder, forwarderAccountNo: forwarderAccountNo.trim() || undefined, shipWithinDays, inspectionPeriod, feeSharingLabel, returnCondition,
        releaseMilestones: [{ percent: milestone1Pct, trigger: milestone1Trigger }, { percent: milestone2Pct, trigger: milestone2Trigger }].filter((m) => m.percent > 0),
      },
    });
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Upload escrow invoice" footer={<Footer onClose={onClose} onSave={save} saveLabel="Attach invoice" disabled={!invoiceNo.trim()} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">Fallback for when the Escrow Agent misses the provider&apos;s email. PO total is fixed from this order: <b className="text-foreground tnum">{money(b.escrow.poAmount, b.escrow.currency)}</b>. Wire instructions use the provider&apos;s standing demo bank account.</div>
        <div className="rounded-lg border p-2.5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Upload the Order — parse it instead of typing the fields below</div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.xlsx,.csv" className="text-xs" />
            <Button variant="outline" onClick={parseOrder} disabled={parsing}><Upload className="h-4 w-4" /> {parsing ? "Parsing…" : "Parse & pre-fill"}</Button>
          </div>
        </div>
        <Labeled label="Invoice no."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="AE2607-1188" /></Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Escrow fee to buyer"><Input type="number" value={feeToBuyer} onChange={(e) => setFeeToBuyer(+e.target.value)} /></Labeled>
          <Labeled label="Wiring fee to buyer"><Input type="number" value={wiringFeeToBuyer} onChange={(e) => setWiringFeeToBuyer(+e.target.value)} /></Labeled>
          <Labeled label="Escrow fee to seller"><Input type="number" value={feeToSeller} onChange={(e) => setFeeToSeller(+e.target.value)} /></Labeled>
          <Labeled label="Wiring fee to seller"><Input type="number" value={wiringFeeToSeller} onChange={(e) => setWiringFeeToSeller(+e.target.value)} /></Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Forwarder"><Input value={forwarder} onChange={(e) => setForwarder(e.target.value)} /></Labeled>
          <Labeled label="Forwarder account no." hint="optional"><Input value={forwarderAccountNo} onChange={(e) => setForwarderAccountNo(e.target.value)} /></Labeled>
          <Labeled label="Ship within (of funds received)"><Input value={shipWithinDays} onChange={(e) => setShipWithinDays(e.target.value)} /></Labeled>
          <Labeled label="Inspection period"><Input value={inspectionPeriod} onChange={(e) => setInspectionPeriod(e.target.value)} /></Labeled>
          <Labeled label="Fee sharing"><Input value={feeSharingLabel} onChange={(e) => setFeeSharingLabel(e.target.value)} /></Labeled>
        </div>
        <Labeled label="Return condition"><Input value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)} /></Labeled>
        <div className="rounded-lg border p-2.5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment-release milestones (as printed on the invoice)</div>
          <div className="grid grid-cols-[64px_1fr] gap-2">
            <Input type="number" value={milestone1Pct} onChange={(e) => setMilestone1Pct(+e.target.value)} />
            <Input value={milestone1Trigger} onChange={(e) => setMilestone1Trigger(e.target.value)} placeholder="Trigger, e.g. on shipment" />
            <Input type="number" value={milestone2Pct} onChange={(e) => setMilestone2Pct(+e.target.value)} />
            <Input value={milestone2Trigger} onChange={(e) => setMilestone2Trigger(e.target.value)} placeholder="Trigger, e.g. on PASS report" />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function UploadPaymentClosureModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const uploadPaymentClosureManually = useStore((s) => s.uploadPaymentClosureManually);
  const [documentNo, setDocumentNo] = useState("");
  const [releasedAmount, setReleasedAmount] = useState(b?.escrow?.poAmount ?? 0);
  if (!b || !b.escrow) return null;
  const save = () => { if (!documentNo.trim()) return; uploadPaymentClosureManually(orderId, { documentNo: documentNo.trim(), releasedAmount }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Upload payment closure manually" footer={<Footer onClose={onClose} onSave={save} saveLabel="Attach" disabled={!documentNo.trim()} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">Fallback for when the Escrow Agent misses the provider&apos;s closure email.</div>
        <Labeled label="Document no."><Input value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} placeholder="PC2607-1188" /></Labeled>
        <Labeled label="Released amount"><Input type="number" value={releasedAmount} onChange={(e) => setReleasedAmount(+e.target.value)} /></Labeled>
      </div>
    </Dialog>
  );
}

export function AddPaymentModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const addPayment = useStore((s) => s.addPayment);
  const [direction, setDirection] = useState<PaymentDirection>("1BUY_TO_SUPPLIER");
  const [mode, setMode] = useState<PaymentMode>(b?.paymentMode ?? "ADVANCE");
  const [amount, setAmount] = useState(b?.buyTotal ?? 0);
  const [triggerDoc, setTriggerDoc] = useState("Supplier PI");
  // CREDIT terms have a real countdown to flag as it nears; ADVANCE/ESCROW default blank since
  // they're expected to be settled immediately (ESCROW is flagged as urgent by mode alone).
  const [dueDate, setDueDate] = useState(() => mode === "CREDIT" ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) : "");
  if (!b) return null;
  const save = () => { if (amount <= 0) return; addPayment(orderId, { direction, mode, amount, triggerDoc, dueDate: dueDate || undefined }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="New payment task" footer={<Footer onClose={onClose} onSave={save} saveLabel="Create" disabled={amount <= 0} />}>
      <div className="space-y-3">
        <Labeled label="Direction"><Select value={direction} onChange={(e) => setDirection(e.target.value as PaymentDirection)}>
          <option value="CLIENT_TO_1BUY">Client → 1Buy</option><option value="1BUY_TO_SUPPLIER">1Buy → Supplier</option></Select></Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Mode"><Select value={mode} onChange={(e) => {
            const v = e.target.value as PaymentMode; setMode(v);
            if (v === "CREDIT" && !dueDate) setDueDate(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
          }}><option>ADVANCE</option><option>ESCROW</option><option>CREDIT</option></Select></Labeled>
          <Labeled label="Amount"><Input type="number" value={amount} onChange={(e) => setAmount(+e.target.value)} /></Labeled>
        </div>
        <Labeled label="Due date" hint="optional — flags this payment as it comes due">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Labeled>
        <Labeled label="Trigger document"><Input value={triggerDoc} onChange={(e) => setTriggerDoc(e.target.value)} /></Labeled>
      </div>
    </Dialog>
  );
}

export function CreateShipmentModal({
  orderId, prefill, onClose,
}: {
  orderId: string;
  /**
   * Pre-fill from one or more tested lots: the goods sit at the lab, so origin defaults
   * to it. Several lots of the same MPN are summed into one line.
   */
  prefill?: { lotCodes?: string[]; lines: { mpn: string; qty: number }[]; from?: string; leg?: ShipmentLeg };
  onClose: () => void;
}) {
  const b = useStore((s) => s.orders[orderId]);
  const createShipment = useStore((s) => s.createShipment);
  const [leg, setLeg] = useState<ShipmentLeg>(prefill?.leg ?? "INBOUND");
  const [carrier, setCarrier] = useState<string>("DHL");
  const [from, setFrom] = useState(prefill?.from ?? b?.supplier.name ?? "");
  const [to, setTo] = useState(fmtAddress(b?.hubAddress) || "1Buy hub");
  const [awb, setAwb] = useState("");
  // booking particulars (needed when 1Buy books the carrier — for DHL + customs).
  // Pre-filled from the supplier's packing list / commercial invoice when those docs are on file.
  const sd = b?.shippingDocs;
  const [pieces, setPieces] = useState(sd?.pieces ?? 1);
  const [weightKg, setWeightKg] = useState(sd?.grossWeightKg ?? 0);
  const [dims, setDims] = useState(sd?.dimensions ?? "");
  const [goods, setGoods] = useState(sd?.goodsDescription ?? "");
  const [hsCode, setHsCode] = useState(sd?.hsCode ?? "");
  const [declaredValue, setDeclaredValue] = useState(sd?.declaredValue ?? 0);
  const [declaredCcy, setDeclaredCcy] = useState(sd?.declaredCurrency ?? b?.currency ?? "USD");
  const [pickupDate, setPickupDate] = useState("");
  const [docInvoice, setDocInvoice] = useState(!!sd?.docs?.includes("Commercial Invoice"));
  const [docPacking, setDocPacking] = useState(!!sd?.docs?.includes("Packing List"));
  const [docCoo, setDocCoo] = useState(!!sd?.docs?.includes("Certificate of Origin"));
  const [docBattery, setDocBattery] = useState(false);
  const [notifyCustoms, setNotifyCustoms] = useState(true);
  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    if (!prefill || !b) return {};
    const out: Record<string, number> = {};
    for (const l of prefill.lines) {
      const cap = remainingToShipLeg(b, l.mpn, prefill.leg ?? "INBOUND");
      out[l.mpn] = Math.max(0, Math.min((out[l.mpn] ?? 0) + l.qty, cap));
    }
    return out;
  });
  if (!b) return null;
  const lineRows = b.lines.map((l) => ({ mpn: l.mpn, remaining: remainingToShipLeg(b, l.mpn, leg) }));
  const anyQty = Object.values(qtys).some((q) => q > 0);
  // Incoterm decides who books the inbound carrier. On C/D terms the supplier books, so we
  // switch to "record the supplier's AWB" mode instead of calling DHL. (Outbound is unaffected.)
  const plan = incotermPlan(b.incoterm);
  const recordMode = leg === "INBOUND" && !plan.weBookFreight;
  const bookMode = leg === "INBOUND" && plan.weBookFreight; // we book DHL — collect full particulars
  const weClear = leg === "INBOUND" && weClearImportCustoms(b); // 1Buy files the India BoE for this order
  // What a forwarder + Indian customs actually need to move the box.
  const detailsOk = pieces >= 1 && weightKg > 0 && goods.trim().length > 0 && hsCode.trim().length > 0 && declaredValue > 0;
  const docsOk = docInvoice && docPacking; // Commercial Invoice + Packing List are mandatory
  const canSave = anyQty && (recordMode ? awb.trim().length > 0 : bookMode ? detailsOk && docsOk : true);
  const save = () => {
    const lines = Object.entries(qtys).map(([mpn, qty]) => ({ mpn, qty })).filter((l) => l.qty > 0);
    const docs = [docInvoice && "Commercial Invoice", docPacking && "Packing List", docCoo && "Certificate of Origin", docBattery && "Battery/DG declaration"].filter(Boolean) as string[];
    const id = createShipment(orderId, {
      leg, carrier, fromLocation: from || "—", toLocation: to || "—",
      boxCount: bookMode ? pieces : 1, grossWeightKg: bookMode ? weightKg : 0, lines,
      awb: recordMode ? awb.trim() : undefined, // supplier's AWB (record mode); otherwise we book it
      notifyCustomsBoe: weClear ? notifyCustoms : undefined,
      ...(bookMode ? { dimensions: dims.trim() || undefined, goodsDescription: goods.trim(), hsCode: hsCode.trim(), declaredValue, declaredCurrency: declaredCcy, pickupReadyDate: pickupDate || undefined, bookingDocs: docs } : {}),
    });
    if (id) onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Create shipment (AWB)" footer={<Footer onClose={onClose} onSave={save} saveLabel={recordMode ? "Record inbound AWB" : leg === "INBOUND" ? "Book AWB (DHL)" : "Create shipment"} disabled={!canSave} />}>
      <div className="space-y-3">
        {leg === "INBOUND" && (
          <div className={cn("rounded-lg border p-2.5 text-xs", recordMode ? "bg-warn-bg text-warn" : "border-primary/40 bg-accent-soft text-primary")}>
            <b>Incoterm {plan.incoterm}</b> · {plan.summary}
            {recordMode
              ? " Enter the AWB the supplier gave you — we won't book a carrier, but we can still track it."
              : " We book the carrier now and the AWB is assigned on booking."}
          </div>
        )}
        {weClear && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
            <input type="checkbox" checked={notifyCustoms} onChange={(e) => setNotifyCustoms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
            <span className="text-muted-foreground"><b className="text-foreground">Notify the Customs handling team to file the BoE (Prior)</b> — mails the Customs team and queues a Bill of Entry on the Customs desk now, so we don&apos;t wait for the shipment to reach port.</span>
          </label>
        )}
        {prefill && (
          <div className="rounded-lg border border-primary/40 bg-accent-soft p-2.5 text-xs text-primary">
            Pre-filled from {prefill.lotCodes?.length === 1 ? "tested lot" : `${prefill.lotCodes?.length ?? prefill.lines.length} tested lots`}
            {prefill.lotCodes?.length ? <> <b>{prefill.lotCodes.join(", ")}</b></> : null}
            {" · "}{prefill.lines.map((l) => `${l.mpn} ×${l.qty}`).join(" · ")}
            {prefill.from ? <> · origin <b>{prefill.from}</b> (where the goods currently sit)</> : null}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Leg"><Select value={leg} onChange={(e) => {
            const lg = e.target.value as ShipmentLeg; setLeg(lg);
            if (lg === "INBOUND") { setFrom(b.supplier.name); setTo(fmtAddress(b.hubAddress) || "1Buy hub"); }
            else { setFrom(fmtAddress(b.hubAddress) || "1Buy hub"); setTo(fmtAddress(b.buyerAddress) || b.buyer.name); }
          }}><option value="INBOUND">INBOUND (supplier → us)</option><option value="OUTBOUND">OUTBOUND (us → client)</option></Select></Labeled>
          <Labeled label={recordMode ? "Carrier (supplier's)" : "Carrier"} hint={recordMode ? "who the supplier shipped with" : "AWB assigned on booking"}><Select value={carrier} onChange={(e) => setCarrier(e.target.value)}><option>DHL</option><option>FEDEX</option><option>DELHIVERY</option></Select></Labeled>
        </div>
        {recordMode && (
          <Labeled label="Supplier's AWB / tracking no." hint="the number on the supplier's dispatch advice"><Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="e.g. DHL 12345678" /></Labeled>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="From"><Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="origin" /></Labeled>
          <Labeled label="To"><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="1Buy hub / client" /></Labeled>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Lines (qty ≤ remaining)</div>
          <div className="space-y-1.5">
            {lineRows.map((r) => (
              <div key={r.mpn} className="flex items-center gap-2">
                <span className="flex-1 font-mono text-xs">{r.mpn}</span>
                <span className="text-xs text-faint">rem {r.remaining}</span>
                <Input type="number" className="w-24" value={qtys[r.mpn] ?? 0} max={r.remaining}
                  onChange={(e) => setQtys((p) => ({ ...p, [r.mpn]: Math.min(+e.target.value, r.remaining) }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Booking particulars + documents — only when WE book the carrier (DHL needs these to price
            & fly the box, and customs needs them to clear it). */}
        {bookMode && (
          <>
            {sd?.status === "RECEIVED" && (
              <div className="rounded-lg border border-primary/40 bg-accent-soft p-2.5 text-xs text-primary">
                Pre-filled from the supplier&apos;s <b>packing list</b> &amp; <b>commercial invoice</b> — pieces, weight, dimensions, HS code &amp; value came from their reply, and the documents are already on file.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 border-t pt-3">
              <Labeled label="Pieces"><Input type="number" value={pieces} onChange={(e) => setPieces(Math.max(1, +e.target.value))} /></Labeled>
              <Labeled label="Gross weight (kg)"><Input type="number" value={weightKg} onChange={(e) => setWeightKg(+e.target.value)} /></Labeled>
              <Labeled label="Dimensions" hint="L×W×H cm"><Input value={dims} onChange={(e) => setDims(e.target.value)} placeholder="40×30×25" /></Labeled>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Goods description"><Input value={goods} onChange={(e) => setGoods(e.target.value)} placeholder="Electronic components — ICs" /></Labeled>
              <Labeled label="HS code"><Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="8542.31" /></Labeled>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Labeled label="Declared value"><Input type="number" value={declaredValue} onChange={(e) => setDeclaredValue(+e.target.value)} /></Labeled>
              <Labeled label="Currency"><Select value={declaredCcy} onChange={(e) => setDeclaredCcy(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Labeled>
              <Labeled label="Pickup ready" hint="EXW pickup date"><Input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} /></Labeled>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Documents handed to the carrier / CHA</div>
              <div className="space-y-1.5">
                <DocCheck label="Commercial Invoice" required checked={docInvoice} onChange={setDocInvoice} />
                <DocCheck label="Packing List" required checked={docPacking} onChange={setDocPacking} />
                <DocCheck label="Certificate of Origin (COO)" hint="for preferential duty" checked={docCoo} onChange={setDocCoo} />
                <DocCheck label="Battery / DG declaration" hint="if the goods contain batteries" checked={docBattery} onChange={setDocBattery} />
              </div>
              {!docsOk && <p className="mt-1.5 text-xs text-warn">Commercial Invoice &amp; Packing List are mandatory — customs can&apos;t clear the shipment without them.</p>}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function DocCheck({ label, hint, required, checked, onChange }: { label: string; hint?: string; required?: boolean; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
      <span className="text-foreground">{label}{required && <span className="text-bad"> *</span>}</span>
      {hint && <span className="text-xs text-faint">— {hint}</span>}
    </label>
  );
}

function docRequestTemplate(b: OrderBundle): string {
  const intl = b.tradeType === "INTERNATIONAL";
  const items = [
    "1. Packing List — piece count, gross weight (kg) and box dimensions (L×W×H)",
    `2. Commercial Invoice — unit values, HS codes and the agreed Incoterm (${b.incoterm})`,
    ...(intl ? ["3. Certificate of Origin (COO)"] : []),
  ];
  return [
    `Dear ${b.supplier.name},`,
    ``,
    `For our order ${b.orderNo} (${b.supplier.name} → 1Buy hub), please share the following shipping documents so we can book the carrier:`,
    ``,
    ...items,
    ``,
    `We specifically need the gross weight and box dimensions from the packing list to finalise the airway bill. Kindly reply at the earliest.`,
    ``,
    `Best regards,`,
    `1Buy Sourcing`,
  ].join("\n");
}

// Editable compose step before we email the supplier for shipping documents (never sent silently).
export function RequestDocsModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const requestShippingDocs = useStore((s) => s.requestShippingDocs);
  const [body, setBody] = useState(() => (b ? docRequestTemplate(b) : ""));
  if (!b) return null;
  const send = () => { requestShippingDocs(orderId, body); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Request shipping documents" footer={<Footer onClose={onClose} onSave={send} saveLabel="Send request" disabled={!body.trim()} />}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="To"><Input value={b.supplier.name} readOnly /></Labeled>
          <Labeled label="Subject"><Input value={`Shipping documents required — ${b.orderNo}`} readOnly /></Labeled>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {shippingDocList(b.tradeType === "INTERNATIONAL").map((d) => <Pill key={d} tone="neutral">{d}</Pill>)}
        </div>
        <Labeled label="Message" hint="review / edit before sending">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={13} />
        </Labeled>
      </div>
    </Dialog>
  );
}

export function FileBOEModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const fileBOE = useStore((s) => s.fileBOE);
  const inbound = (b?.shipments ?? []).filter((s) => s.leg === "INBOUND");
  const firstNo = inbound[0]?.shipmentNo ?? "";
  const existing0 = b?.customs.find((c) => c.shipmentNo === firstNo);
  const sdDocs = existing0?.docs ?? b?.shippingDocs?.docs ?? []; // docs collected from the supplier
  // AWB auto-fills from the selected shipment (blank if it's still a placeholder) — the CHA can add/correct it.
  const awbFor = (no: string) => { const a = inbound.find((s) => s.shipmentNo === no)?.awb; return a && a !== "booking…" && a !== "booking failed" ? a : ""; };
  // DHL returns the waybill + logistics invoice at booking (Shipment.carrierDocs) — these get forwarded to the CHA.
  const carrierDocsFor = (no: string) => inbound.find((s) => s.shipmentNo === no)?.carrierDocs ?? [];
  const [shipmentNo, setShipmentNo] = useState(firstNo);
  const [awb, setAwb] = useState(awbFor(firstNo));
  const [portCode, setPortCode] = useState(existing0?.portCode ?? "INDEL4");
  const [chaName, setChaName] = useState(existing0?.chaName ?? "Speedwing CHA");
  const [assessable, setAssessable] = useState(existing0?.assessableValue ?? b?.shippingDocs?.declaredValue ?? 0);
  const [boeType, setBoeType] = useState<"PRIOR" | "ON_ARRIVAL">("PRIOR");
  const [docPL, setDocPL] = useState(sdDocs.includes("Packing List"));
  const [docCI, setDocCI] = useState(sdDocs.includes("Commercial Invoice"));
  const [docCOO, setDocCOO] = useState(sdDocs.includes("Certificate of Origin"));
  const [docWaybill, setDocWaybill] = useState(carrierDocsFor(firstNo).length > 0);
  if (!b) return null;
  const duty = computeDuty(assessable);
  const carrierDocs = carrierDocsFor(shipmentNo);
  const carrierDocNames = carrierDocs.map((d) => d.fileName).join(", ");
  const file = (mode: "ICEGATE" | "CHA") => {
    if (!shipmentNo) return;
    const docs = [docPL && "Packing List", docCI && "Commercial Invoice", docCOO && "Certificate of Origin", docWaybill && "Waybill + Logistics Invoice (DHL)"].filter(Boolean) as string[];
    fileBOE(orderId, { shipmentNo, portCode, chaName, assessableValue: assessable, boeType, docs, awb: awb.trim() || undefined, mode });
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title="File Bill of Entry" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="outline" onClick={() => file("CHA")} disabled={!shipmentNo}>Send to CHA &amp; mark filed</Button>
        <Button onClick={() => file("ICEGATE")} disabled={!shipmentNo}>File on ICEGATE (API)</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="rounded-lg border border-primary/40 bg-accent-soft p-2.5 text-xs text-primary">
          Attach the documents + details, then either <b>file directly on ICEGATE</b> (via API) or <b>send them to your CHA</b> to file. Either way it&apos;s auto-assessed — duty then shows on the Payments desk.
        </div>
        <Labeled label="Shipment">
          <Select value={shipmentNo} onChange={(e) => { const no = e.target.value; setShipmentNo(no); setAwb(awbFor(no)); setDocWaybill(carrierDocsFor(no).length > 0); }}>
            {inbound.length === 0 && <option value="">— create an inbound shipment first —</option>}
            {inbound.map((s) => <option key={s.id} value={s.shipmentNo}>{s.shipmentNo} · {s.awb}</option>)}
          </Select>
        </Labeled>
        <Labeled label="AWB" hint="auto-filled from the shipment — add / correct it (the IGM match keys on this)">
          <Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="e.g. DHL 89072093" />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="BoE type" hint="Prior = up to 30 days before arrival"><Select value={boeType} onChange={(e) => setBoeType(e.target.value as "PRIOR" | "ON_ARRIVAL")}><option value="ON_ARRIVAL">On-arrival (after IGM)</option><option value="PRIOR">Prior BoE (docs ready early)</option></Select></Labeled>
          <Labeled label="Port code"><Input value={portCode} onChange={(e) => setPortCode(e.target.value)} /></Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="CHA"><Input value={chaName} onChange={(e) => setChaName(e.target.value)} /></Labeled>
          <Labeled label="Assessable value (INR)" hint={`est. duty ≈ ${money(duty, "INR")} at assessment`}><Input type="number" value={assessable} onChange={(e) => setAssessable(+e.target.value)} /></Labeled>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Attachments (eSANCHIT)</div>
          <div className="space-y-1.5">
            <DocCheck label="Packing List" checked={docPL} onChange={setDocPL} />
            <DocCheck label="Commercial Invoice" checked={docCI} onChange={setDocCI} />
            <DocCheck label="Certificate of Origin (COO)" checked={docCOO} onChange={setDocCOO} />
            <DocCheck label="Waybill + Logistics Invoice (DHL)"
              hint={carrierDocs.length ? carrierDocNames : "retrieve from DHL on the Logistics desk after booking the shipment"}
              checked={docWaybill} onChange={setDocWaybill} />
          </div>
          {sdDocs.length === 0 && <p className="mt-1.5 text-xs text-faint">Tip: collect the trade docs from the supplier and the waybill from DHL on the Logistics desk to auto-attach.</p>}
        </div>
      </div>
    </Dialog>
  );
}

export function AllocateDeliveryModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const clientPos = useStore((s) => s.clientPos);
  const allocateDelivery = useStore((s) => s.allocateDelivery);
  const mpns = Array.from(new Set((b?.shipments ?? []).flatMap((s) => s.lines).map((l) => l.mpn)))
    .filter((m) => b && remainingToAllocate(b, m) > 0);
  // Owed cap for an (mpn, client-PO) pair — used to prefill qty on open and on change (no effect → respects lint rule).
  function capForSel(m: string, po?: string) {
    if (!b || !m) return 0;
    const opts = Array.from(new Set(b.sourcingAllocations.filter((a) => a.clientLineMpn === m).map((a) => a.clientPoNo)));
    const usePo = po && opts.includes(po) ? po : (opts[0] ?? "");
    const phys = remainingToAllocate(b, m);
    const ow = usePo ? orderSourcedForClient(b, usePo, m) - deliveredForClientLine(b, usePo, m) : 0;
    return Math.max(0, Math.min(phys, ow));
  }
  const [mpn, setMpn] = useState(mpns[0] ?? "");
  const [clientPoNo, setClientPoNo] = useState("");
  const [qty, setQty] = useState(() => capForSel(mpns[0] ?? ""));
  const [err, setErr] = useState("");
  if (!b) return null;
  // you can only deliver to a client line THIS order actually sourced for the received MPN
  const clientOptions = mpn ? Array.from(new Set(b.sourcingAllocations.filter((a) => a.clientLineMpn === mpn).map((a) => a.clientPoNo))) : [];
  const effectivePo = clientOptions.includes(clientPoNo) ? clientPoNo : (clientOptions[0] ?? "");
  const nameFor = (poNo: string) => clientPos.find((c) => c.clientPoNo === poNo)?.client.name ?? poNo;
  const physical = mpn ? remainingToAllocate(b, mpn) : 0;
  const owed = effectivePo ? orderSourcedForClient(b, effectivePo, mpn) - deliveredForClientLine(b, effectivePo, mpn) : 0;
  const cap = Math.max(0, Math.min(physical, owed));
  const shipNo = (b.shipments.find((s) => s.lines.some((l) => l.mpn === mpn))?.shipmentNo) ?? "—";
  const save = () => {
    const ok = allocateDelivery(orderId, { fromShipmentNo: shipNo, clientPoNo: effectivePo, clientLineMpn: mpn, qty });
    if (!ok) { setErr(`Qty must be 1–${cap} (received & owed to this client).`); return; }
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Allocate to client (who gets what)"
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Allocate" disabled={!mpn || !effectivePo || qty <= 0 || qty > cap} />}>
      {mpns.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing received to allocate yet — create an inbound shipment first.</p>
      ) : (
        <div className="space-y-3">
          <Labeled label="MPN" hint={`received & unallocated: ${physical}`}><Select value={mpn} onChange={(e) => { const nm = e.target.value; setMpn(nm); setClientPoNo(""); setQty(capForSel(nm)); setErr(""); }}>{mpns.map((m) => <option key={m}>{m}</option>)}</Select></Labeled>
          {clientOptions.length === 0 ? (
            <p className="text-xs text-warn">This order hasn&apos;t sourced <span className="font-mono">{mpn}</span> for any client yet — map it on the Allocations tab first.</p>
          ) : (
            <>
              <Labeled label="Sales Order (sourced by this order)"><Select value={effectivePo} onChange={(e) => { const po = e.target.value; setClientPoNo(po); setQty(capForSel(mpn, po)); setErr(""); }}>{clientOptions.map((po) => <option key={po} value={po}>{po} · {nameFor(po)}</option>)}</Select></Labeled>
              <Labeled label="Qty" hint={`owed to this client: ${cap} (prefilled)`}><Input type="number" value={qty} max={cap} onChange={(e) => { setQty(+e.target.value); setErr(""); }} /></Labeled>
            </>
          )}
          {err && <p className="text-xs text-bad">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}

export function AddEventModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const addEvent = useStore((s) => s.addEvent);
  const [eventType, setEventType] = useState("LEAD_TIME_UPDATE");
  const [message, setMessage] = useState("");
  const save = () => { if (!message.trim()) return; addEvent(orderId, { eventType, message }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Log an event" footer={<Footer onClose={onClose} onSave={save} saveLabel="Log event" disabled={!message.trim()} />}>
      <div className="space-y-3">
        <Labeled label="Type"><Select value={eventType} onChange={(e) => setEventType(e.target.value)}>
          {["LEAD_TIME_UPDATE", "DELAY", "PARTIAL_READY", "SUPPLIER_NOTE", "GENERAL"].map((t) => <option key={t}>{t}</option>)}</Select></Labeled>
        <Labeled label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Supplier: 1 week to dispatch remaining." /></Labeled>
      </div>
    </Dialog>
  );
}

export function UploadDocModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const addDocument = useStore((s) => s.addDocument);
  const [docType, setDocType] = useState("PO");
  const [fileName, setFileName] = useState("");
  const save = () => { if (!fileName.trim()) return; addDocument(orderId, { subjectType: "ORDER", docType, fileName }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Attach document (demo)" footer={<Footer onClose={onClose} onSave={save} saveLabel="Attach" disabled={!fileName.trim()} />}>
      <div className="space-y-3">
        <Labeled label="Type"><Select value={docType} onChange={(e) => setDocType(e.target.value)}>
          {["PO", "PI", "CI", "TAX_INVOICE", "WHL_REPORT", "BOE", "PACKING_LIST", "POD", "SUPER_INVOICE", "ESCROW_INVOICE", "PAYMENT_CLOSURE"].map((t) => <option key={t}>{t}</option>)}</Select></Labeled>
        <Labeled label="File name" hint="no real upload in the POC"><Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="document.pdf" /></Labeled>
      </div>
    </Dialog>
  );
}

export function UploadPIModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const attachPI = useStore((s) => s.attachPI);
  const [piNo, setPiNo] = useState(b?.piNo ?? "");
  const [fileName, setFileName] = useState("");
  if (!b) return null;
  const canSave = !!piNo.trim() || !!fileName.trim();
  const save = () => { if (!canSave) return; attachPI(orderId, { piNo: piNo.trim(), fileName: fileName.trim() }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Upload supplier PI" footer={<Footer onClose={onClose} onSave={save} saveLabel="Attach PI" disabled={!canSave} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">The PI is confirmed with the supplier on the sourcing platform — attach the accepted PI to this order for the fulfilment record.</div>
        <Labeled label="PI number"><Input value={piNo} onChange={(e) => setPiNo(e.target.value)} placeholder="PI-2026-0112" /></Labeled>
        <Labeled label="File name" hint="no real upload in the POC"><Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="supplier-pi.pdf" /></Labeled>
      </div>
    </Dialog>
  );
}

export function AddAllocationModal({
  orderId, orderLineId, orderLineMpn, unmapped, onClose,
}: { orderId: string; orderLineId: string; orderLineMpn: string; unmapped: number; onClose: () => void }) {
  const clientPos = useStore((s) => s.clientPos);
  const orders = useStore((s) => s.orders);
  const supplierPos = useStore((s) => s.supplierPos);
  const addSourcingAllocation = useStore((s) => s.addSourcingAllocation);
  const [clientPoNo, setClientPoNo] = useState(clientPos[0]?.clientPoNo ?? "");
  const [clientLineMpn, setClientLineMpn] = useState("");
  const [qty, setQty] = useState(0);
  const [marginPct, setMarginPct] = useState(12);
  // only same-MPN client lines can be mapped (you can't fulfil demand for part X with part Y)
  const clientLines = (clientPos.find((c) => c.clientPoNo === clientPoNo)?.lines ?? []).filter((l) => l.mpn === orderLineMpn);
  const clientRemaining = (() => {
    const demand = clientPos.find((c) => c.clientPoNo === clientPoNo)?.lines.find((l) => l.mpn === clientLineMpn)?.qty ?? 0;
    return demand - sourcedForClientLine(supplierPos, orders, clientPoNo, clientLineMpn);
  })();
  const cap = Math.max(0, Math.min(unmapped, clientRemaining));
  const save = () => {
    if (!clientPoNo || !clientLineMpn || qty <= 0) return;
    if (addSourcingAllocation(orderId, { orderLineId, orderLineMpn, clientPoNo, clientLineMpn, qty, marginPct })) onClose();
  };
  return (
    <Dialog open onClose={onClose} title={`Map ${orderLineMpn} → sales order`}
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Map" disabled={!clientLineMpn || qty <= 0} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">Order line <b className="font-mono text-foreground">{orderLineMpn}</b> · unmapped <b className="text-foreground">{unmapped}</b></div>
        <Labeled label="Sales Order (demand served)"><Select value={clientPoNo} onChange={(e) => { setClientPoNo(e.target.value); setClientLineMpn(""); }}>{clientPos.map((c) => <option key={c.id} value={c.clientPoNo}>{c.clientPoNo} · {c.client.name}</option>)}</Select></Labeled>
        <Labeled label="Sales Order line"><Select value={clientLineMpn} onChange={(e) => setClientLineMpn(e.target.value)}><option value="">— select —</option>{clientLines.map((l) => <option key={l.mpn} value={l.mpn}>{l.mpn} (need {l.qty})</option>)}</Select></Labeled>
        {clientLines.length === 0 && <p className="text-xs text-warn">No <span className="font-mono">{orderLineMpn}</span> demand on this sales order — pick one that ordered this part.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Qty" hint={`max ${cap}`}><Input type="number" value={qty} max={cap} onChange={(e) => setQty(+e.target.value)} /></Labeled>
          <Labeled label="Margin %"><Input type="number" value={marginPct} onChange={(e) => setMarginPct(+e.target.value)} /></Labeled>
        </div>
      </div>
    </Dialog>
  );
}

export function SourceOrderModal({
  clientPoNo, buyerName, clientLineMpn, unitPrice, remaining, onClose,
}: { clientPoNo: string; buyerName: string; clientLineMpn: string; unitPrice: number; remaining: number; onClose: () => void }) {
  const router = useRouter();
  const createSupplierPo = useStore((s) => s.createSupplierPo);
  const [supplier, setSupplier] = useState("");
  const [qty, setQty] = useState(remaining);
  const [price, setPrice] = useState(0); // buy price — operator enters what the supplier charges (NOT the client's sell price)
  const [trade, setTrade] = useState<TradeType>("INTERNATIONAL");
  const [payment, setPayment] = useState<PaymentMode>("ESCROW");
  const [testing, setTesting] = useState<TestingMode>("WHL");
  const [margin, setMargin] = useState(12);
  const save = () => {
    if (!supplier.trim() || qty <= 0) return;
    const id = createSupplierPo({
      supplier, tradeType: trade, incoterm: trade === "INTERNATIONAL" ? "FOB" : "EXW", currency: "USD",
      sellerPaymentMode: payment, lead: 21, testDays: 6, delivery: 9, testing,
      lines: [{ mpn: clientLineMpn, clientPoNo, clientLineMpn, qty, buyUnitPrice: price, marginPct: margin }],
    });
    if (id) { onClose(); router.push("/fulfilment/supplier-pos"); }
  };
  return (
    <Dialog open onClose={onClose} title={`Source ${clientLineMpn} for ${clientPoNo}`}
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Create purchase order" disabled={!supplier.trim() || qty <= 0} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">Buyer <b className="text-foreground">{buyerName}</b> · line <b className="font-mono text-foreground">{clientLineMpn}</b></div>
        <Labeled label="Supplier"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Shenzhen Micro Co" /></Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Qty" hint={`remaining to source: ${remaining}`}><Input type="number" value={qty} max={remaining} onChange={(e) => setQty(+e.target.value)} /></Labeled>
          <Labeled label="Unit price (buy)" hint={`client sells @ ${money(unitPrice)}`}><Input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} placeholder="supplier's price" /></Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Trade type"><Select value={trade} onChange={(e) => setTrade(e.target.value as TradeType)}><option value="INTERNATIONAL">INTERNATIONAL</option><option value="DOMESTIC">DOMESTIC</option></Select></Labeled>
          <Labeled label="Payment"><Select value={payment} onChange={(e) => setPayment(e.target.value as PaymentMode)}><option>ADVANCE</option><option>ESCROW</option><option>CREDIT</option></Select></Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Testing"><Select value={testing} onChange={(e) => setTesting(e.target.value as TestingMode)}><option>NONE</option><option>SUPPLIER_SELF</option><option>WHL</option></Select></Labeled>
          <Labeled label="Margin %"><Input type="number" value={margin} onChange={(e) => setMargin(+e.target.value)} /></Labeled>
        </div>
        <p className="text-xs text-muted-foreground">Creates a <b className="text-foreground">Purchase Order</b> pre-linked to {clientPoNo} · {clientLineMpn}. Create its fulfilment order from the Purchase Orders list. Split across suppliers by sourcing again for the rest.</p>
      </div>
    </Dialog>
  );
}
