"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeft, Upload, FileText, Plus, Trash2, Check } from "lucide-react";
import { Panel, Button, PageHeader, FormTabBar, StickyBar } from "@/components/ui/primitives";
import { Labeled, Input, Select } from "@/components/ui/form";
import { useStore } from "@/store/store";
import { PAYMENT_METHODS } from "@/data/enums";
import { extractClientPo } from "@/integrations/doc-extract";
import { money, cn } from "@/lib/utils";
import { toast } from "sonner";
import type { PaymentMode } from "@/types";

type Line = { mpn: string; make: string; dateCode: string; qty: number; price: number; requiredBy: string };
type TabId = "parties" | "terms" | "lines";

export default function CreateClientPoPage() {
  const router = useRouter();
  const createClientPo = useStore((s) => s.createClientPo);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"upload" | "manual">("upload");
  const [tab, setTab] = useState<TabId>("parties");
  const [parsedFrom, setParsedFrom] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [f, setF] = useState({
    clientName: "", clientPoNo: "", paymentMode: "CREDIT", clientGstin: "", clientState: "",
    referenceNo: "", gstNote: "GST extra @ actual", paymentMethod: "", deliveryTerms: "", testingTerms: "", warranty: "",
    addrLine1: "", addrCity: "", addrState: "", addrPincode: "", addrCountry: "IN",
  });
  const [lines, setLines] = useState<Line[]>([{ mpn: "", make: "", dateCode: "", qty: 0, price: 0, requiredBy: "" }]);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function parse() {
    const file = fileRef.current?.files?.[0];
    const name = file?.name ?? "client-po.pdf";
    setParsing(true);
    try {
      const res = await extractClientPo({ fileName: name, bytesLen: file?.size ?? 0 });
      setF((p) => ({
        ...p,
        clientName: res.fields.clientName, clientPoNo: res.fields.clientPoNo, paymentMode: res.fields.paymentMode,
        clientGstin: res.fields.clientGstin, clientState: res.fields.clientState, referenceNo: res.fields.referenceNo,
        gstNote: res.fields.gstNote, paymentMethod: res.fields.paymentMethod, deliveryTerms: res.fields.deliveryTerms,
        warranty: res.fields.warranty,
        addrLine1: res.deliveryAddress.line1, addrCity: res.deliveryAddress.city, addrState: res.deliveryAddress.state,
        addrPincode: res.deliveryAddress.pincode, addrCountry: res.deliveryAddress.country,
      }));
      setLines(res.lines.map((l) => ({ mpn: l.mpn, make: "", dateCode: "", qty: l.qty, price: l.price, requiredBy: l.requiredBy })));
      setParsedFrom(name);
      toast.success(`Parsed ${name} (${Math.round(res.overallConfidence * 100)}% confidence) — review below`);
    } catch (e) {
      toast.error(`Parse failed: ${e instanceof Error ? e.message : String(e)} — enter manually`);
      setMode("manual");
    } finally {
      setParsing(false);
    }
  }
  const updateLine = (i: number, k: keyof Line, v: string | number) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((ls) => [...ls, { mpn: "", make: "", dateCode: "", qty: 0, price: 0, requiredBy: "" }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const valid = lines.filter((l) => l.mpn.trim() && l.qty > 0);
  const total = valid.reduce((a, l) => a + l.qty * l.price, 0);
  const canSubmit = f.clientName.trim() && valid.length > 0;

  function submit() {
    if (!canSubmit) return;
    const poNo = createClientPo({
      clientName: f.clientName, clientPoNo: f.clientPoNo, paymentMode: f.paymentMode as PaymentMode,
      clientGstin: f.clientGstin, clientState: f.clientState,
      deliveryAddress: { name: f.clientName || undefined, line1: f.addrLine1, city: f.addrCity, state: f.addrState, pincode: f.addrPincode, country: f.addrCountry },
      terms: { referenceNo: f.referenceNo, gstNote: f.gstNote, paymentMethod: f.paymentMethod, deliveryTerms: f.deliveryTerms, testingTerms: f.testingTerms, warranty: f.warranty },
      lines: valid.map((l) => ({ mpn: l.mpn, make: l.make, dateCode: l.dateCode, qty: l.qty, unitPrice: l.price, requiredBy: l.requiredBy })),
    });
    if (poNo) router.push("/fulfilment/client-pos");
  }

  const tabs: { id: TabId; label: string; invalid?: boolean }[] = [
    { id: "parties", label: "Client & parties", invalid: !f.clientName.trim() },
    { id: "terms", label: "PO terms" },
    { id: "lines", label: "Demand lines", invalid: valid.length === 0 },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24">
      <Link href="/fulfilment/client-pos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Sales Orders</Link>
      <PageHeader title="New Sales Order" description="Step 1 — record the buyer's demand. Next you'll create purchase order(s) that reference these lines. Upload to auto-fill or enter manually." />

      <div className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
        {(["upload", "manual"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={cn("flex-1 rounded-md px-3 py-1.5 font-medium transition", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {m === "upload" ? "Upload PO" : "Enter manually"}
          </button>
        ))}
      </div>

      {mode === "upload" && (
        <Panel>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
            <FileText className="h-8 w-8 text-faint" />
            <p className="text-sm text-muted-foreground">Drop the client&apos;s PO (PDF / XLSX / CSV) — we parse it and pre-fill the tabs below.</p>
            <input ref={fileRef} type="file" accept=".pdf,.xlsx,.csv" className="text-xs" />
            <Button onClick={parse} disabled={parsing}><Upload className="h-4 w-4" /> {parsing ? "Parsing…" : "Parse & pre-fill"}</Button>
            {parsedFrom && <p className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Parsed <b>{parsedFrom}</b> — review &amp; edit in the tabs.</p>}
          </div>
        </Panel>
      )}

      <FormTabBar tabs={tabs} active={tab} onChange={setTab} />
      <p className="-mt-3 text-[11px] text-faint"><span className="text-bad">*</span> required</p>

      {tab === "parties" && (
        <Panel title="Client & parties">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Labeled label="Client (buyer)" required hint="Parsed from the uploaded PO — edit if needed">
              <Input value={f.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Upload a PO to auto-fill, or type the buyer's name" />
            </Labeled>
            <Labeled label="Sales Order no"><Input value={f.clientPoNo} onChange={(e) => set("clientPoNo", e.target.value)} placeholder="GIPL/26-27/PO/121" /></Labeled>
            <Labeled label="Client pays us"><Select value={f.paymentMode} onChange={(e) => set("paymentMode", e.target.value)}><option>ADVANCE</option><option>ESCROW</option><option>CREDIT</option></Select></Labeled>
            <Labeled label="Client GSTIN / UIN"><Input value={f.clientGstin} onChange={(e) => set("clientGstin", e.target.value)} placeholder="33AALCG9069K1Z0" /></Labeled>
            <Labeled label="Client state"><Input value={f.clientState} onChange={(e) => set("clientState", e.target.value)} placeholder="Tamil Nadu" /></Labeled>
          </div>
          <div className="mt-4 border-t pt-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Buyer delivery address <span className="text-faint">(where we ship the finished order)</span></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Labeled label="Address line"><Input value={f.addrLine1} onChange={(e) => set("addrLine1", e.target.value)} placeholder="Plot / street" /></Labeled>
              <Labeled label="City"><Input value={f.addrCity} onChange={(e) => set("addrCity", e.target.value)} placeholder="Bengaluru" /></Labeled>
              <Labeled label="State"><Input value={f.addrState} onChange={(e) => set("addrState", e.target.value)} placeholder="Karnataka" /></Labeled>
              <Labeled label="Pincode"><Input value={f.addrPincode} onChange={(e) => set("addrPincode", e.target.value)} placeholder="560001" /></Labeled>
              <Labeled label="Country"><Input value={f.addrCountry} onChange={(e) => set("addrCountry", e.target.value)} placeholder="IN" /></Labeled>
            </div>
          </div>
        </Panel>
      )}

      {tab === "terms" && (
        <Panel title="PO terms — payment · logistics · testing">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Labeled label="Reference no"><Input value={f.referenceNo} onChange={(e) => set("referenceNo", e.target.value)} placeholder="GIPL/26-27/PO/121" /></Labeled>
            <Labeled label="GST note"><Input value={f.gstNote} onChange={(e) => set("gstNote", e.target.value)} placeholder="GST extra @ actual" /></Labeled>
            <Labeled label="Payment method"><Select value={f.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}><option value="">— select —</option>{PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}</Select></Labeled>
            <Labeled label="Delivery terms"><Input value={f.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} placeholder="Delivered to hub, DDP" /></Labeled>
            <Labeled label="Testing terms"><Input value={f.testingTerms} onChange={(e) => set("testingTerms", e.target.value)} placeholder="Test report along with shipment" /></Labeled>
            <Labeled label="Warranty"><Input value={f.warranty} onChange={(e) => set("warranty", e.target.value)} placeholder="1 year" /></Labeled>
          </div>
        </Panel>
      )}

      {tab === "lines" && (
        <Panel title="Demand lines" actions={<Button variant="outline" onClick={addLine}><Plus className="h-4 w-4" /> Add line</Button>}>
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_1fr_5rem_4.5rem_5.5rem_8rem_2rem] gap-2 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>MPN <span className="text-bad">*</span></span><span>Manufacturer</span><span>Date code</span><span className="text-right">Qty <span className="text-bad">*</span></span><span className="text-right">Unit price</span><span className="text-right">Required by</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_5rem_4.5rem_5.5rem_8rem_2rem]">
                <Input value={l.mpn} onChange={(e) => updateLine(i, "mpn", e.target.value)} placeholder="MPN" />
                <Input value={l.make} onChange={(e) => updateLine(i, "make", e.target.value)} placeholder="Manufacturer" />
                <Input value={l.dateCode} onChange={(e) => updateLine(i, "dateCode", e.target.value)} placeholder="25+" />
                <Input type="number" value={l.qty} onChange={(e) => updateLine(i, "qty", +e.target.value)} placeholder="Qty" />
                <Input type="number" value={l.price} onChange={(e) => updateLine(i, "price", +e.target.value)} placeholder="Price" />
                <Input type="date" value={l.requiredBy} onChange={(e) => updateLine(i, "requiredBy", e.target.value)} />
                <button onClick={() => removeLine(i)} className="flex items-center justify-center rounded-lg border text-muted-foreground hover:border-bad hover:text-bad"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end border-t pt-3 text-sm text-muted-foreground">PO value <b className="ml-1 text-foreground tnum">{money(total)}</b></div>
        </Panel>
      )}

      <StickyBar>
        <span className="text-xs text-muted-foreground">Creates the sales order (demand). {!canSubmit && <span className="text-warn">Add a client &amp; at least one line.</span>}</span>
        <Button onClick={submit} disabled={!canSubmit}>Create Sales Order →</Button>
      </StickyBar>
    </div>
  );
}
