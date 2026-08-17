"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2, Upload, FileText, Check } from "lucide-react";
import { Panel, Button, PageHeader, FormTabBar, StickyBar } from "@/components/ui/primitives";
import { Labeled, Input, Select, Textarea } from "@/components/ui/form";
import { CURRENCIES, INCOTERMS, PAYMENT_METHODS, DISPATCH_MODES, LAB_LOCATIONS, TEST_FAILURE_BEARERS, CREDIT_DAYS, STANDARD_TNC } from "@/data/enums";
import { SUPPLIERS } from "@/data/directory";
import { useStore } from "@/store/store";
import { sourcedForClientLine } from "@/store/selectors";
import { extractSupplierPo } from "@/integrations/doc-extract";
import { money, qtyfmt, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { TradeType, PaymentMode, TestingMode } from "@/types";

type Row = { linked: boolean; clientPoNo: string; mpn: string; make: string; testing: string; qty: number; buy: number; margin: number };
type TabId = "supplier" | "terms" | "tnc" | "lines";

export default function CreateSupplierPoPage() {
  const router = useRouter();
  const clientPos = useStore((s) => s.clientPos);
  const orders = useStore((s) => s.orders);
  const supplierPos = useStore((s) => s.supplierPos);
  const createSupplierPo = useStore((s) => s.createSupplierPo);
  const canLink = clientPos.length > 0;

  const [f, setF] = useState({
    supplierId: "", supplier: "", supplierGstin: "", supplierState: "", tradeType: "INTERNATIONAL", currency: "USD", incoterm: "EXW",
    sellerPaymentMode: "ADVANCE", creditDays: 30, lead: 1, testDays: 6, delivery: 9, testing: "WHL",
    referenceNo: "", paymentMethod: "Advance via T/T", dispatchedThrough: "", destination: "", destinationPort: "",
    warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen & Hong Kong", relabelCost: 0,
    packing: "Packing list + Commercial Invoice; WHSO# on outside box",
  });
  const set = (k: string, v: string | number) => setF((p) => ({ ...p, [k]: v }));
  const handleSelectSupplier = (supplierId: string) => {
    const supplier = SUPPLIERS.find((s) => s.id === supplierId);
    if (supplier) {
      setF((p) => ({
        ...p,
        supplierId: supplier.id,
        supplier: supplier.name,
        supplierGstin: supplier.gstin || "",
        supplierState: supplier.country === "IN" ? "Tamil Nadu" : supplier.country,
      }));
    }
  };
  // Standard T&Cs — tickboxes seeded from STANDARD_TNC defaults + a free-text "additional".
  const [tnc, setTnc] = useState<Record<string, boolean>>(() => Object.fromEntries(STANDARD_TNC.map((t) => [t.id, t.on])));
  const [tncExtra, setTncExtra] = useState("");
  const toggleTnc = (id: string) => setTnc((p) => ({ ...p, [id]: !p[id] }));
  const termsConditions = [
    ...STANDARD_TNC.filter((t) => tnc[t.id]).map((t) => t.label),
    ...tncExtra.split("\n").map((s) => s.trim()).filter(Boolean),
  ];
  const newRow = (): Row => ({ linked: canLink, clientPoNo: clientPos[0]?.clientPoNo ?? "", mpn: "", make: "", testing: f.testing, qty: 0, buy: 0, margin: 12 });
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [tab, setTab] = useState<TabId>("supplier");
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"upload" | "manual">("upload");
  const [parsedFrom, setParsedFrom] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  async function parse() {
    const file = fileRef.current?.files?.[0];
    const name = file?.name ?? "supplier-po.pdf";
    setParsing(true);
    try {
      const res = await extractSupplierPo({ fileName: name, bytesLen: file?.size ?? 0 });
      setF((p) => ({
        ...p,
        supplier: res.fields.supplier, supplierGstin: res.fields.supplierGstin, supplierState: res.fields.supplierState,
        tradeType: res.fields.tradeType, currency: res.fields.currency, incoterm: res.fields.incoterm,
        sellerPaymentMode: res.fields.sellerPaymentMode, testing: res.fields.testing, referenceNo: res.fields.referenceNo,
        paymentMethod: res.fields.paymentMethod, dispatchedThrough: res.fields.dispatchedThrough, destination: res.fields.destination,
        warranty: res.fields.warranty, testFailureBearer: res.fields.testFailureBearer, labLocation: res.fields.labLocation, packing: res.fields.packing,
      }));
      setRows(res.lines.map((l) => ({ linked: false, clientPoNo: clientPos[0]?.clientPoNo ?? "", mpn: l.mpn, make: l.make, testing: res.fields.testing, qty: l.qty, buy: l.buy, margin: l.margin })));
      setParsedFrom(name);
      toast.success(`Parsed ${name} (${Math.round(res.overallConfidence * 100)}% confidence) — review & link in the tabs`);
    } catch (e) {
      toast.error(`Parse failed: ${e instanceof Error ? e.message : String(e)} — enter manually`);
      setMode("manual");
    } finally {
      setParsing(false);
    }
  }

  const updateRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, newRow()]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const demandOf = (poNo: string, mpn: string) => clientPos.find((c) => c.clientPoNo === poNo)?.lines.find((l) => l.mpn === mpn)?.qty ?? 0;
  const sellOf = (poNo: string, mpn: string) => clientPos.find((c) => c.clientPoNo === poNo)?.lines.find((l) => l.mpn === mpn)?.unitPrice ?? 0;
  const makeOf = (poNo: string, mpn: string) => clientPos.find((c) => c.clientPoNo === poNo)?.lines.find((l) => l.mpn === mpn)?.make ?? "";
  const remainingFor = (row: Row, idx: number) => {
    if (!row.linked || !row.clientPoNo || !row.mpn) return Infinity;
    const draftOther = rows.reduce((a, r, j) => (j !== idx && r.linked && r.clientPoNo === row.clientPoNo && r.mpn === row.mpn ? a + r.qty : a), 0);
    return demandOf(row.clientPoNo, row.mpn) - sourcedForClientLine(supplierPos, orders, row.clientPoNo, row.mpn) - draftOther;
  };

  const valid = rows.filter((r) => r.qty > 0 && r.mpn.trim() && (!r.linked || r.clientPoNo));
  const overIdx = rows.findIndex((r, i) => r.linked && r.mpn && r.qty > remainingFor(r, i));
  const buyTotal = valid.reduce((a, r) => a + r.qty * r.buy, 0);
  const sellTotal = valid.reduce((a, r) => a + r.qty * (r.linked ? sellOf(r.clientPoNo, r.mpn) : r.buy), 0);
  const canSubmit = f.supplier.trim() && valid.length > 0 && overIdx < 0;

  function submit() {
    if (!canSubmit) return;
    const id = createSupplierPo({
      supplier: f.supplier, tradeType: f.tradeType as TradeType, incoterm: f.incoterm, currency: f.currency,
      sellerPaymentMode: f.sellerPaymentMode as PaymentMode, lead: f.lead, testDays: f.testDays, delivery: f.delivery,
      testing: f.testing as TestingMode, supplierGstin: f.supplierGstin, supplierState: f.supplierState,
      creditDays: f.sellerPaymentMode === "CREDIT" ? f.creditDays : undefined,
      termsConditions: termsConditions.length ? termsConditions : undefined,
      relabelCost: f.relabelCost > 0 ? f.relabelCost : undefined,
      terms: { referenceNo: f.referenceNo, paymentMethod: f.paymentMethod, dispatchedThrough: f.dispatchedThrough, destination: f.destination, destinationPort: f.incoterm === "CIF" ? f.destinationPort : undefined, warranty: f.warranty, testFailureBearer: f.testFailureBearer, labLocation: f.labLocation, packing: f.packing },
      lines: valid.map((r) => r.linked
        ? { mpn: r.mpn, make: makeOf(r.clientPoNo, r.mpn), testing: r.testing as TestingMode, clientPoNo: r.clientPoNo, clientLineMpn: r.mpn, qty: r.qty, buyUnitPrice: r.buy, marginPct: r.margin }
        : { mpn: r.mpn, make: r.make, testing: r.testing as TestingMode, qty: r.qty, buyUnitPrice: r.buy, marginPct: r.margin }),
    });
    if (id) router.push("/fulfilment/supplier-pos");
  }

  const tabs: { id: TabId; label: string; invalid?: boolean }[] = [
    { id: "supplier", label: "Supplier & terms", invalid: !f.supplier.trim() },
    { id: "terms", label: "PO terms" },
    { id: "tnc", label: "Terms & Conditions" },
    { id: "lines", label: "Lines", invalid: valid.length === 0 || overIdx >= 0 },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24">
      <Link href="/fulfilment/supplier-pos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Purchase Orders</Link>
      <PageHeader title="New Purchase Order" description={<>Step 2 — our PO to a supplier. Each line can <b className="text-foreground">reference a sales-order line</b> (partial ok, multi-client) — or be <b className="text-foreground">unlinked</b> and mapped later. This creates the document only; you&apos;ll <b className="text-foreground">create the fulfilment order</b> from it next.</>} />

      <div className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
        {(["upload", "manual"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={cn("flex-1 rounded-md px-3 py-1.5 font-medium transition", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {m === "upload" ? "Upload PO / PI" : "Enter manually"}
          </button>
        ))}
      </div>

      {mode === "upload" && (
        <Panel>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
            <FileText className="h-8 w-8 text-faint" />
            <p className="text-sm text-muted-foreground">Drop the purchase order / PI (PDF / XLSX / CSV) — we parse it and pre-fill the tabs below. Lines come in <b className="text-foreground">unlinked</b>; link them to sales-order demand in the Lines tab.</p>
            <input ref={fileRef} type="file" accept=".pdf,.xlsx,.csv" className="text-xs" />
            <Button onClick={parse} disabled={parsing}><Upload className="h-4 w-4" /> {parsing ? "Parsing…" : "Parse & pre-fill"}</Button>
            {parsedFrom && <p className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Parsed <b>{parsedFrom}</b> — review &amp; link in the tabs.</p>}
          </div>
        </Panel>
      )}

      <FormTabBar tabs={tabs} active={tab} onChange={setTab} />
      <p className="-mt-3 text-[11px] text-faint"><span className="text-bad">*</span> required</p>

      {tab === "supplier" && (
      <Panel title="Supplier & terms">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Labeled label="Supplier (us → supplier)" required>
            <Select value={f.supplierId} onChange={(e) => handleSelectSupplier(e.target.value)}>
              <option value="">-- Select a supplier --</option>
              {SUPPLIERS.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Supplier GSTIN / UIN"><Input value={f.supplierGstin} onChange={(e) => set("supplierGstin", e.target.value)} placeholder="(blank if foreign)" /></Labeled>
          <Labeled label="Supplier state / region"><Input value={f.supplierState} onChange={(e) => set("supplierState", e.target.value)} placeholder="Hong Kong" /></Labeled>
          <Labeled label="Trade type"><Select value={f.tradeType} onChange={(e) => set("tradeType", e.target.value)}><option>INTERNATIONAL</option><option>DOMESTIC</option></Select></Labeled>
          <Labeled label="Currency"><Select value={f.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Labeled>
          <Labeled label="Incoterm"><Select value={f.incoterm} onChange={(e) => set("incoterm", e.target.value)}>{INCOTERMS.map((c) => <option key={c}>{c}</option>)}</Select></Labeled>
          <Labeled label="We pay supplier"><Select value={f.sellerPaymentMode} onChange={(e) => set("sellerPaymentMode", e.target.value)}><option>ADVANCE</option><option>ESCROW</option><option>CREDIT</option></Select></Labeled>
          {f.sellerPaymentMode === "CREDIT" && (
            <Labeled label="Days of credit"><Select value={f.creditDays} onChange={(e) => set("creditDays", +e.target.value)}>{CREDIT_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}</Select></Labeled>
          )}
          <Labeled label="Default testing (per new line)"><Select value={f.testing} onChange={(e) => set("testing", e.target.value)}><option>NONE</option><option>SUPPLIER_SELF</option><option>WHL</option></Select></Labeled>
          <Labeled label="Lead (days)"><Input type="number" value={f.lead} onChange={(e) => set("lead", +e.target.value)} /></Labeled>
          <Labeled label="Testing (days)"><Input type="number" value={f.testDays} onChange={(e) => set("testDays", +e.target.value)} /></Labeled>
          <Labeled label="Delivery (days)"><Input type="number" value={f.delivery} onChange={(e) => set("delivery", +e.target.value)} /></Labeled>
        </div>
      </Panel>
      )}

      {tab === "terms" && (
      <Panel title="PO terms — payment · logistics · testing">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Labeled label="Reference no (RFQ / PO ref)"><Input value={f.referenceNo} onChange={(e) => set("referenceNo", e.target.value)} placeholder="RFQBUNDLE_…" /></Labeled>
          <Labeled label="Payment method"><Select value={f.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>{PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}</Select></Labeled>
          <Labeled label="Dispatched through"><Select value={f.dispatchedThrough} onChange={(e) => set("dispatchedThrough", e.target.value)}><option value="">— select —</option>{DISPATCH_MODES.map((d) => <option key={d}>{d}</option>)}</Select></Labeled>
          <Labeled label="Destination"><Input value={f.destination} onChange={(e) => set("destination", e.target.value)} placeholder="1Buy hub / lab" /></Labeled>
          {f.incoterm === "CIF" && (
            <Labeled label="Ship to (destination port)"><Input value={f.destinationPort} onChange={(e) => set("destinationPort", e.target.value)} placeholder="Nhava Sheva (INNSA)" /></Labeled>
          )}
          <Labeled label="Warranty"><Input value={f.warranty} onChange={(e) => set("warranty", e.target.value)} placeholder="1 year" /></Labeled>
          <Labeled label="Test-failure cost borne by"><Select value={f.testFailureBearer} onChange={(e) => set("testFailureBearer", e.target.value)}>{TEST_FAILURE_BEARERS.map((t) => <option key={t}>{t}</option>)}</Select></Labeled>
          <Labeled label="Test lab location"><Select value={f.labLocation} onChange={(e) => set("labLocation", e.target.value)}>{LAB_LOCATIONS.map((l) => <option key={l}>{l}</option>)}</Select></Labeled>
          <Labeled label="Relabelling cost at hub"><Input type="number" value={f.relabelCost} onChange={(e) => set("relabelCost", +e.target.value)} placeholder="0" /></Labeled>
        </div>
        <div className="mt-3"><Labeled label="Packing / labelling"><Textarea value={f.packing} onChange={(e) => set("packing", e.target.value)} placeholder="Packing list + Commercial Invoice; WHSO# on outside box…" /></Labeled></div>
      </Panel>
      )}

      {tab === "tnc" && (
      <Panel title="Terms & Conditions">
        <p className="mb-3 text-xs text-muted-foreground">Standard clauses carried onto the order. The usual ones are pre-ticked — untick any that don&apos;t apply, add extras below.</p>
        <div className="space-y-2">
          {STANDARD_TNC.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm hover:bg-muted/40">
              <input type="checkbox" checked={!!tnc[t.id]} onChange={() => toggleTnc(t.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
              <span className={cn(tnc[t.id] ? "text-foreground" : "text-muted-foreground")}>{t.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-4"><Labeled label="Additional conditions (one per line)"><Textarea value={tncExtra} onChange={(e) => setTncExtra(e.target.value)} placeholder="e.g. Country of origin certificate required for each lot" /></Labeled></div>
        <p className="mt-2 text-xs text-muted-foreground"><b className="text-foreground tnum">{termsConditions.length}</b> condition(s) will be attached to this PO and its order.</p>
      </Panel>
      )}

      {tab === "lines" && (
      <Panel title="Lines" actions={<Button variant="outline" onClick={addRow}><Plus className="h-4 w-4" /> Add line</Button>}>
        {!canLink && <p className="mb-2 text-xs text-warn">No sales orders exist yet — lines will be created <b>unlinked</b>; map them once a sales order is available.</p>}
        <div className="mb-1 hidden grid-cols-[1.3fr_1.3fr_4.5rem_5rem_2rem] gap-2 px-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Sales Order / MPN <span className="text-bad">*</span></span><span>Client line / Manufacturer</span><span className="text-right">Qty <span className="text-bad">*</span></span><span className="text-right">Buy <span className="text-bad">*</span></span><span />
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => {
            const rem = remainingFor(r, i);
            const over = r.linked && r.mpn !== "" && r.qty > rem;
            const cpo = clientPos.find((c) => c.clientPoNo === r.clientPoNo);
            return (
              <div key={i} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-1 text-xs">
                  <button disabled={!canLink} onClick={() => updateRow(i, { linked: true })}
                    className={cn("rounded-md border px-2 py-0.5 font-medium disabled:opacity-40", r.linked ? "border-primary bg-accent-soft text-primary" : "text-muted-foreground")}>Linked</button>
                  <button onClick={() => updateRow(i, { linked: false })}
                    className={cn("rounded-md border px-2 py-0.5 font-medium", !r.linked ? "border-primary bg-accent-soft text-primary" : "text-muted-foreground")}>Unlinked (map later)</button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.3fr_1.3fr_4.5rem_5rem_2rem]">
                  {r.linked ? (
                    <>
                      <Select value={r.clientPoNo} onChange={(e) => updateRow(i, { clientPoNo: e.target.value, mpn: "" })}>
                        {clientPos.map((c) => <option key={c.id} value={c.clientPoNo}>{c.clientPoNo} · {c.client.name}</option>)}
                      </Select>
                      <Select value={r.mpn} onChange={(e) => updateRow(i, { mpn: e.target.value })}>
                        <option value="">— client line —</option>
                        {cpo?.lines.map((l) => {
                          const lr = demandOf(r.clientPoNo, l.mpn) - sourcedForClientLine(supplierPos, orders, r.clientPoNo, l.mpn);
                          return <option key={l.mpn} value={l.mpn}>{l.mpn} · rem {lr}</option>;
                        })}
                      </Select>
                    </>
                  ) : (
                    <>
                      <Input value={r.mpn} onChange={(e) => updateRow(i, { mpn: e.target.value })} placeholder="MPN (unlinked)" />
                      <Input value={r.make} onChange={(e) => updateRow(i, { make: e.target.value })} placeholder="Manufacturer" />
                    </>
                  )}
                  <Input type="number" value={r.qty} onChange={(e) => updateRow(i, { qty: +e.target.value })} placeholder="Qty" className={cn(over && "border-bad")} />
                  <Input type="number" value={r.buy} onChange={(e) => updateRow(i, { buy: +e.target.value })} placeholder="Buy" />
                  <button onClick={() => removeRow(i)} className="flex items-center justify-center rounded-lg border text-muted-foreground hover:border-bad hover:text-bad"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                  <label className="inline-flex items-center gap-1 text-muted-foreground">testing
                    <select value={r.testing} onChange={(e) => updateRow(i, { testing: e.target.value })} className="rounded border bg-background px-1 py-0.5 text-[11px] outline-none focus:border-primary">
                      <option value="NONE">None</option><option value="SUPPLIER_SELF">Self</option><option value="WHL">WHL</option>
                    </select>
                  </label>
                  {r.linked && <span>remaining to source: <b className={over ? "text-bad" : "text-muted-foreground"}>{isFinite(rem) ? qtyfmt(rem) : "—"}</b></span>}
                  {r.linked && r.mpn && <span>client sell price: {money(sellOf(r.clientPoNo, r.mpn), f.currency)}</span>}
                  {!r.linked && <span className="text-warn">unlinked — will need mapping to a buyer PO to complete</span>}
                  {over && <span className="text-bad">qty exceeds remaining</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-4 border-t pt-3 text-sm">
          <span className="text-muted-foreground">Buy <b className="text-foreground tnum">{money(buyTotal, f.currency)}</b></span>
          <span className="text-muted-foreground">Sell <b className="text-foreground tnum">{money(sellTotal, f.currency)}</b></span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Tip: mix lines from <b className="text-foreground">different sales orders</b> to consolidate, or leave lines <b className="text-foreground">unlinked</b> and map them later.</p>
      </Panel>
      )}

      <StickyBar>
        <span className="text-xs text-muted-foreground">Creates the Purchase Order document; create its fulfilment order from the Purchase Orders list. {!canSubmit && <span className="text-warn">Add supplier &amp; valid lines (within remaining).</span>}</span>
        <Button onClick={submit} disabled={!canSubmit}>Create Purchase Order →</Button>
      </StickyBar>
    </div>
  );
}
