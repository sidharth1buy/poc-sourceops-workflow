"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Labeled, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { useStore } from "@/store/store";
import { remainingToShipLeg, remainingToAllocate, sourcedForClientLine, orderSourcedForClient, deliveredForClientLine } from "@/store/selectors";
import { computeDuty } from "@/lib/fx";
import { money, fmtAddress } from "@/lib/utils";
import { WHL_CONTACT, WHL_EMAIL_TEMPLATES, whlTemplate, notifyTemplate, notifyDigest, LAB_TERMS_LABEL, type WhlMailCtx, type NotifyCtx } from "@/data/enums";
import type {
  PaymentDirection, PaymentMode, ShipmentLeg, JourneyPhase, TradeType, TestingMode, LabEmail, NotifyParty,
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

export function AddLotModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const addLot = useStore((s) => s.addLot);
  const [mpn, setMpn] = useState(b?.lines[0]?.mpn ?? "");
  const [lotCode, setLotCode] = useState("");
  const [dateCode, setDateCode] = useState("");
  const [qty, setQty] = useState(0);
  const [sampleQty, setSampleQty] = useState(0);
  if (!b) return null;
  const save = () => { if (!mpn || !lotCode.trim()) return; addLot(orderId, { orderLineMpn: mpn, lotCode, dateCode, qty, sampleQty, lab: "WHL Shenzhen" }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Add test lot" footer={<Footer onClose={onClose} onSave={save} saveLabel="Add lot" disabled={!lotCode.trim()} />}>
      <div className="space-y-3">
        <Labeled label="MPN"><Select value={mpn} onChange={(e) => setMpn(e.target.value)}>{b.lines.map((l) => <option key={l.id} value={l.mpn}>{l.mpn}</option>)}</Select></Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Lot code"><Input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="LOT-C" /></Labeled>
          <Labeled label="Date code"><Input value={dateCode} onChange={(e) => setDateCode(e.target.value)} placeholder="2410" /></Labeled>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Lot qty"><Input type="number" value={qty} onChange={(e) => setQty(+e.target.value)} /></Labeled>
          <Labeled label="Sample qty"><Input type="number" value={sampleQty} onChange={(e) => setSampleQty(+e.target.value)} /></Labeled>
        </div>
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
    <Dialog open onClose={onClose} title={`${tpl.label} — ${lots.length} lot(s)`}
      footer={<Footer onClose={onClose} onSave={send} saveLabel={`Send ${groups.length} mail${groups.length > 1 ? "s" : ""}`} disabled={!curTo.trim() || !curSubject.trim()} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
          One digest instead of {lots.length} separate mails.
          {party === "BUYER" && groups.length > 1 && <> Split into <b className="text-foreground">{groups.length} mails — one per client PO</b>, so no client sees another&apos;s lots.</>}
        </div>
        {tpl.masking && <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg px-2.5 py-2 text-xs text-warn">{tpl.masking}</p>}
        {(isFinance ? noInvoice : noReport).length > 0 && (
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg px-2.5 py-2 text-xs text-warn">
            {isFinance
              ? <>{noInvoice.length} selected lot(s) have no WHL invoice yet ({noInvoice.map((l) => l.lotCode).join(", ")}) — they are excluded from this payment run. {withInvoice.length} of {lots.length} carry an invoice.</>
              : <>{noReport.length} selected lot(s) have no report yet ({noReport.map((l) => l.lotCode).join(", ")}) — they are listed as “result pending”. {withReport.length} of {lots.length} carry a report.</>}
          </p>
        )}

        {groups.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g, i) => (
              <button key={g.key} type="button" onClick={() => setActive(i)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${i === (active < groups.length ? active : 0) ? "border-primary bg-accent-soft text-primary" : "hover:border-primary"}`}>
                {g.key} · {g.lots.length} lot(s)
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
    <Dialog open onClose={onClose} title="Upload escrow invoice manually" footer={<Footer onClose={onClose} onSave={save} saveLabel="Attach invoice" disabled={!invoiceNo.trim()} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">Fallback for when the Escrow Agent misses the provider&apos;s email. PO total is fixed from this order: <b className="text-foreground tnum">{money(b.escrow.poAmount, b.escrow.currency)}</b>. Wire instructions use the provider&apos;s standing demo bank account.</div>
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
  if (!b) return null;
  const save = () => { if (amount <= 0) return; addPayment(orderId, { direction, mode, amount, triggerDoc }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="New payment task" footer={<Footer onClose={onClose} onSave={save} saveLabel="Create" disabled={amount <= 0} />}>
      <div className="space-y-3">
        <Labeled label="Direction"><Select value={direction} onChange={(e) => setDirection(e.target.value as PaymentDirection)}>
          <option value="CLIENT_TO_1BUY">Client → 1Buy</option><option value="1BUY_TO_SUPPLIER">1Buy → Supplier</option></Select></Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}><option>ADVANCE</option><option>ESCROW</option><option>CREDIT</option></Select></Labeled>
          <Labeled label="Amount"><Input type="number" value={amount} onChange={(e) => setAmount(+e.target.value)} /></Labeled>
        </div>
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
  const save = () => {
    const lines = Object.entries(qtys).map(([mpn, qty]) => ({ mpn, qty })).filter((l) => l.qty > 0);
    const id = createShipment(orderId, { leg, carrier, fromLocation: from || "—", toLocation: to || "—", boxCount: 1, grossWeightKg: 0, lines });
    if (id) onClose();
  };
  return (
    <Dialog open onClose={onClose} title="Create shipment (AWB)" footer={<Footer onClose={onClose} onSave={save} saveLabel="Create shipment" disabled={!anyQty} />}>
      <div className="space-y-3">
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
          <Labeled label="Carrier" hint="AWB assigned on booking"><Select value={carrier} onChange={(e) => setCarrier(e.target.value)}><option>DHL</option><option>FEDEX</option><option>DELHIVERY</option></Select></Labeled>
        </div>
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
      </div>
    </Dialog>
  );
}

export function FileBOEModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const fileBOE = useStore((s) => s.fileBOE);
  const inbound = (b?.shipments ?? []).filter((s) => s.leg === "INBOUND");
  const [shipmentNo, setShipmentNo] = useState(inbound[0]?.shipmentNo ?? "");
  const [portCode, setPortCode] = useState("INDEL4");
  const [chaName, setChaName] = useState("Speedwing CHA");
  const [assessable, setAssessable] = useState(0);
  if (!b) return null;
  const duty = computeDuty(assessable);
  const save = () => { if (!shipmentNo) return; fileBOE(orderId, { shipmentNo, portCode, chaName, assessableValue: assessable }); onClose(); };
  return (
    <Dialog open onClose={onClose} title="File Bill of Entry (ICEGATE)" footer={<Footer onClose={onClose} onSave={save} saveLabel="File via ICEGATE" disabled={!shipmentNo} />}>
      <div className="space-y-3">
        <Labeled label="Shipment">
          <Select value={shipmentNo} onChange={(e) => setShipmentNo(e.target.value)}>
            {inbound.length === 0 && <option value="">— create an inbound shipment first —</option>}
            {inbound.map((s) => <option key={s.id} value={s.shipmentNo}>{s.shipmentNo} · {s.awb}</option>)}
          </Select>
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Port code"><Input value={portCode} onChange={(e) => setPortCode(e.target.value)} /></Labeled>
          <Labeled label="CHA"><Input value={chaName} onChange={(e) => setChaName(e.target.value)} /></Labeled>
        </div>
        <Labeled label="Assessable value (INR)" hint={`est. duty ≈ ${money(duty, "INR")} — ICEGATE assesses & issues the BE + ref`}><Input type="number" value={assessable} onChange={(e) => setAssessable(+e.target.value)} /></Labeled>
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
              <Labeled label="Client PO (sourced by this order)"><Select value={effectivePo} onChange={(e) => { const po = e.target.value; setClientPoNo(po); setQty(capForSel(mpn, po)); setErr(""); }}>{clientOptions.map((po) => <option key={po} value={po}>{po} · {nameFor(po)}</option>)}</Select></Labeled>
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
    <Dialog open onClose={onClose} title={`Map ${orderLineMpn} → client PO`}
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Map" disabled={!clientLineMpn || qty <= 0} />}>
      <div className="space-y-3">
        <div className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">Order line <b className="font-mono text-foreground">{orderLineMpn}</b> · unmapped <b className="text-foreground">{unmapped}</b></div>
        <Labeled label="Client PO (demand served)"><Select value={clientPoNo} onChange={(e) => { setClientPoNo(e.target.value); setClientLineMpn(""); }}>{clientPos.map((c) => <option key={c.id} value={c.clientPoNo}>{c.clientPoNo} · {c.client.name}</option>)}</Select></Labeled>
        <Labeled label="Client PO line"><Select value={clientLineMpn} onChange={(e) => setClientLineMpn(e.target.value)}><option value="">— select —</option>{clientLines.map((l) => <option key={l.mpn} value={l.mpn}>{l.mpn} (need {l.qty})</option>)}</Select></Labeled>
        {clientLines.length === 0 && <p className="text-xs text-warn">No <span className="font-mono">{orderLineMpn}</span> demand on this client PO — pick a PO that ordered this part.</p>}
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
      footer={<Footer onClose={onClose} onSave={save} saveLabel="Create supplier PO" disabled={!supplier.trim() || qty <= 0} />}>
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
        <p className="text-xs text-muted-foreground">Creates a <b className="text-foreground">Supplier PO</b> pre-linked to {clientPoNo} · {clientLineMpn}. Create its fulfilment order from the Supplier POs list. Split across suppliers by sourcing again for the rest.</p>
      </div>
    </Dialog>
  );
}
