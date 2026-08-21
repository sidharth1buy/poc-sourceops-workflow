"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Labeled, Input, Select } from "@/components/ui/form";
import { Button, Pill } from "@/components/ui/primitives";
import { useStore } from "@/store/store";
import { remainingToShipLeg } from "@/store/selectors";
import { dhlGetRates, dhlLandedCost, type DhlProduct } from "@/integrations/logistics";
import { CURRENCIES } from "@/data/enums";
import { money, fmtAddress, cn } from "@/lib/utils";

// DHL Express booking for the inbound leg (we book), mapped to the MyDHL API.
// Supplier docs pre-fill the particulars.
//
// ONE CONTINUOUS FORM, NOT A WIZARD. The four parts — particulars, rate,
// pickup, review — are sections on one page, filled in a single pass. A
// stepper made somebody click Next three times to see what the whole job was;
// here the whole job is visible at once, the review updates live as fields
// change, and the one Book button at the end stays disabled until the form
// says exactly what is still missing.
//
// A FORM ON THE PAGE, NOT A DIALOG. Booking is the logistics desk's biggest
// single act on an order — it deserves the page, room to read, and survives a
// stray click outside it.
export function DhlBookingForm({ orderId, onDone }: { orderId: string; onDone?: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const createShipment = useStore((s) => s.createShipment);
  const sd = b?.shippingDocs;
  // particulars (from the supplier's packing list / commercial invoice)
  // Boxes: DHL packages[] — each row is N identical boxes of a given per-box weight + size.
  // We seed one box from the packing-list totals; the SC can add rows for mixed-size cargo.
  const [boxes, setBoxes] = useState<{ count: number; weightKg: number; dims: string }[]>(() => {
    const count = sd?.pieces ?? 1;
    const perBox = count > 0 ? Math.round(((sd?.grossWeightKg ?? 0) / count) * 100) / 100 : (sd?.grossWeightKg ?? 0);
    const dims = (sd?.dimensions ?? "").replace(/\s*[×x]\s*\d+\s*$/, "").trim(); // strip any trailing "× N"
    return [{ count, weightKg: perBox, dims }];
  });
  const [goods, setGoods] = useState(sd?.goodsDescription ?? "Electronic components");
  const [hsCode, setHsCode] = useState(sd?.hsCode ?? "");
  const [declaredValue, setDeclaredValue] = useState(sd?.declaredValue ?? 0);
  const [declaredCcy, setDeclaredCcy] = useState(sd?.declaredCurrency ?? b?.currency ?? "USD");
  // rate
  const [products, setProducts] = useState<DhlProduct[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [landed, setLanded] = useState<number | null>(null);
  // pickup
  const [bookingMode, setBookingMode] = useState<"COMBINED" | "SEPARATE">("COMBINED");
  const [pickupDate, setPickupDate] = useState(sd?.receivedAt ?? "");
  const [closeTime, setCloseTime] = useState("18:00");
  const [notifyCustoms, setNotifyCustoms] = useState(true);
  // Paperless Trade — attach the commercial invoice image to the shipment so DHL transmits it electronically.
  const [attachCI, setAttachCI] = useState(true);

  const setBox = (i: number, patch: Partial<{ count: number; weightKg: number; dims: string }>) => setBoxes((bs) => bs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addBox = () => setBoxes((bs) => [...bs, { count: 1, weightKg: 0, dims: "" }]);
  const removeBox = (i: number) => setBoxes((bs) => (bs.length > 1 ? bs.filter((_, j) => j !== i) : bs));
  const pieces = boxes.reduce((a, x) => a + (x.count || 0), 0);
  const weightKg = Math.round(boxes.reduce((a, x) => a + (x.count || 0) * (x.weightKg || 0), 0) * 100) / 100;
  const dimsSummary = boxes.filter((x) => x.count > 0).map((x) => `${x.dims || "?"}${x.count > 1 ? ` ×${x.count}` : ""}`).join("; ");

  if (!b) return null;
  const from = b.supplier.name;
  const to = fmtAddress(b.hubAddress) || "1Buy hub";
  const lines = b.lines.map((l) => ({ mpn: l.mpn, qty: remainingToShipLeg(b, l.mpn, "INBOUND") })).filter((l) => l.qty > 0);
  const detailsOk = pieces > 0 && weightKg > 0 && goods.trim() && hsCode.trim() && declaredValue > 0 && lines.length > 0;
  const product = products.find((p) => p.productCode === productCode);
  /* The one gate: particulars complete and a DHL product picked. Pickup is optional. */
  const canBook = Boolean(detailsOk && productCode);
  const missing = !detailsOk
    ? "Complete the shipment particulars (boxes, weight, goods, HS code, value) first."
    : !productCode
      ? "Get DHL rates and pick a product to book against."
      : null;

  const getRates = async () => {
    setRatesLoading(true);
    const tid = toast.loading("📡 Calling DHL Global Forwarding — Rates API…");
    try {
      const r = await dhlGetRates({ from, to, weightKg, declaredValue, currency: declaredCcy });
      setProducts(r.products);
      if (r.products.length && !productCode) setProductCode(r.products[0].productCode);
      toast.success(`✓ DHL returned ${r.products.length} products`, { id: tid });
    } catch { toast.error("DHL rates failed", { id: tid }); }
    finally { setRatesLoading(false); }
  };
  const estLanded = async () => {
    const tid = toast.loading("📡 Calling DHL — Landed Cost API…");
    try { const r = await dhlLandedCost({ declaredValue, currency: declaredCcy }); setLanded(r.totalCost); toast.success(`Est. landed cost ${money(r.totalCost, r.currency)}`, { id: tid }); }
    catch { toast.error("Landed cost failed", { id: tid }); }
  };

  // Attach the supplier docs to the booking; the commercial invoice rides along only when Paperless Trade is on.
  const bookingDocs = (() => {
    const set = new Set(sd?.docs ?? []);
    if (attachCI) set.add("Commercial Invoice"); else set.delete("Commercial Invoice");
    return Array.from(set);
  })();

  const book = () => {
    const id = createShipment(orderId, {
      leg: "INBOUND", carrier: "DHL", fromLocation: from, toLocation: to,
      boxCount: pieces, grossWeightKg: weightKg, lines,
      packages: boxes.filter((x) => x.count > 0).map((x) => ({ count: x.count, weightKg: x.weightKg, dimensions: x.dims.trim() || undefined })),
      dimensions: dimsSummary || undefined, goodsDescription: goods.trim(), hsCode: hsCode.trim(),
      declaredValue, declaredCurrency: declaredCcy, pickupReadyDate: pickupDate || undefined, bookingDocs,
      notifyCustomsBoe: notifyCustoms,
      productCode: product?.productCode, productName: product?.productName, rateAmount: product?.price,
      rateCurrency: product?.currency, estimatedDelivery: product?.estimatedDelivery,
      bookingMode, pickupDate: pickupDate || undefined, pickupCloseTime: closeTime,
    });
    if (id) onDone?.();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/40 bg-accent-soft p-2.5 text-xs text-primary">
        <b>{b.orderNo}</b> · {from} → {to} · Incoterm {b.incoterm}{sd?.status === "RECEIVED" ? " · particulars from supplier docs" : ""}
      </div>

      {/* ── 1 · Shipment particulars ─────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHead n={1} title="Shipment particulars" done={Boolean(detailsOk)} />
        <div className="text-xs text-muted-foreground">Lines: {lines.map((l) => `${l.mpn} ×${l.qty}`).join(" · ") || "nothing to ship"}</div>
        {/* Boxes (DHL packages[]) — one row per box size; add rows for mixed cargo */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Boxes</span>
            <span className="text-xs text-muted-foreground">{pieces} pcs · {weightKg} kg total</span>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-center gap-2 px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-faint">
            <span>Qty</span><span>Weight/box (kg)</span><span>Dimensions (L×W×H)</span><span></span>
          </div>
          <div className="space-y-1.5">
            {boxes.map((bx, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-center gap-2">
                <Input type="number" min={1} value={bx.count} onChange={(e) => setBox(i, { count: Math.max(1, +e.target.value) })} />
                <Input type="number" min={0} step="0.01" value={bx.weightKg} onChange={(e) => setBox(i, { weightKg: +e.target.value })} />
                <Input value={bx.dims} onChange={(e) => setBox(i, { dims: e.target.value })} placeholder="40×30×25" />
                <button type="button" onClick={() => removeBox(i)} disabled={boxes.length === 1}
                  className="rounded-md border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40" title="Remove box">✕</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addBox} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">+ Add box</button>
          <p className="mt-1 text-[11px] text-faint">Boxes are auto-created from the supplier&apos;s packing list; add or edit rows here for mixed-size cargo.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Goods description"><Input value={goods} onChange={(e) => setGoods(e.target.value)} /></Labeled>
          <Labeled label="HS code"><Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="8541.10" /></Labeled>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Declared value"><Input type="number" value={declaredValue} onChange={(e) => setDeclaredValue(+e.target.value)} /></Labeled>
          <Labeled label="Currency"><Select value={declaredCcy} onChange={(e) => setDeclaredCcy(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Labeled>
        </div>
      </section>

      {/* ── 2 · Rate & service ───────────────────────────────────────────── */}
      <section className="space-y-3 border-t pt-3">
        <SectionHead n={2} title="Rate & service" done={Boolean(productCode)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={getRates} disabled={ratesLoading || !detailsOk}
            title={!detailsOk ? "Complete the particulars above first — rates are quoted on them" : undefined}>
            {ratesLoading ? "Fetching…" : products.length ? "Refresh DHL rates" : "Get DHL rates"}
          </Button>
          <Button variant="ghost" onClick={estLanded}>Estimate landed cost</Button>
          {landed != null && <span className="text-xs text-muted-foreground">Landed ≈ <b className="text-foreground">{money(landed, declaredCcy)}</b></span>}
        </div>
        {products.length === 0
          ? <p className="text-xs text-muted-foreground">Get rates for {from} → {to} · {weightKg} kg to pick a DHL product.</p>
          : <div className="space-y-1.5">
              {products.map((p) => (
                <label key={p.productCode} className={cn("flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-2.5 text-sm", productCode === p.productCode ? "border-primary bg-accent-soft" : "")}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="dhlprod" checked={productCode === p.productCode} onChange={() => setProductCode(p.productCode)} className="h-4 w-4 accent-[var(--primary)]" />
                    <b>{p.productName}</b> <Pill tone="neutral">{p.productCode}</Pill> <span className="text-xs text-muted-foreground">{p.estimatedDelivery}</span>
                  </span>
                  <b className="text-foreground">{money(p.price, p.currency)}</b>
                </label>
              ))}
            </div>}
      </section>

      {/* ── 3 · Pickup ───────────────────────────────────────────────────── */}
      <section className="space-y-3 border-t pt-3">
        <SectionHead n={3} title="Pickup" done={bookingMode === "SEPARATE" || Boolean(pickupDate)} optional />
        <div className="grid gap-3 sm:grid-cols-3">
          <Labeled label="Pickup mode" hint="combined = with shipment">
            <Select value={bookingMode} onChange={(e) => {
              const m = e.target.value as "COMBINED" | "SEPARATE";
              setBookingMode(m);
              // Separate = pickup arranged later from the Pickups tab — date/time don't apply here.
              if (m === "SEPARATE") { setPickupDate(""); setCloseTime(""); }
              else if (!closeTime) setCloseTime("18:00");
            }}>
              <option value="COMBINED">Combined (inline)</option>
              <option value="SEPARATE">Separate (/pickups)</option>
            </Select>
          </Labeled>
          <Labeled label="Pickup date" hint={bookingMode === "SEPARATE" ? "n/a — scheduled separately" : "leave blank = no pickup"}>
            <Input type="date" value={pickupDate} disabled={bookingMode === "SEPARATE"} onChange={(e) => setPickupDate(e.target.value)} className={bookingMode === "SEPARATE" ? "opacity-50" : undefined} />
          </Labeled>
          <Labeled label="Close time">
            <Input value={bookingMode === "SEPARATE" ? "" : closeTime} disabled={bookingMode === "SEPARATE"} onChange={(e) => setCloseTime(e.target.value)} placeholder={bookingMode === "SEPARATE" ? "N/A" : "18:00"} className={bookingMode === "SEPARATE" ? "opacity-50" : undefined} />
          </Labeled>
        </div>
        {bookingMode === "SEPARATE" ? (
          <p className="text-xs text-muted-foreground"><b>Separate</b> books the shipment now and the pickup is scheduled later via <code>POST /pickups</code> — use when the pickup time isn&apos;t known yet or one pickup covers several shipments. No date/time needed here.</p>
        ) : pickupDate ? (
          <p className="text-xs text-muted-foreground"><b>Combined</b> creates the courier pickup inline with the shipment — one <code>POST /shipments</code> call returns both the AWB and the pickup confirmation.</p>
        ) : (
          <p className="text-xs text-warn">No pickup will be scheduled — we&apos;ll only book the AWB. Add a pickup date here, or switch to <b>Separate</b> to arrange it later.</p>
        )}
      </section>

      {/* ── 4 · Review & book — updates live as the fields above change ──── */}
      <section className="space-y-3 border-t pt-3">
        <SectionHead n={4} title="Review & book" done={canBook} />
        <div className="space-y-1.5 rounded-lg border p-3 text-sm">
          <Row k="Route" v={`${from} → ${to}`} />
          <Row k="Cargo" v={`${pieces} ${pieces === 1 ? "box" : "boxes"} · ${weightKg} kg · ${dimsSummary || "—"}`} />
          <Row k="Goods" v={`${goods} · HS ${hsCode || "—"} · ${money(declaredValue, declaredCcy)}`} />
          <Row k="DHL product" v={product ? `${product.productName} (${product.productCode}) · ${money(product.price, product.currency)} · ${product.estimatedDelivery}` : "— not selected —"} />
          <Row k="Pickup" v={pickupDate ? `${pickupDate} · by ${closeTime} · ${bookingMode === "SEPARATE" ? "separate" : "combined"}` : bookingMode === "SEPARATE" ? "scheduled separately" : "—"} />
          {bookingDocs.length ? <Row k="Docs attached" v={bookingDocs.join(", ")} /> : null}
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
          <input type="checkbox" checked={attachCI} onChange={(e) => setAttachCI(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
          <span className="text-muted-foreground"><b className="text-foreground">Attach Commercial Invoice (Paperless Trade)</b> — DHL transmits the CI image electronically with the shipment{sd?.docs?.includes("Commercial Invoice") ? "" : "; add the supplier's CI on the Documents tab if not yet collected"}.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
          <input type="checkbox" checked={notifyCustoms} onChange={(e) => setNotifyCustoms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
          <span className="text-muted-foreground"><b className="text-foreground">Notify the Customs handling team to file the BoE (Prior)</b> — queues a Bill of Entry on the Customs desk now, without waiting for arrival.</span>
        </label>
        <p className="text-xs text-muted-foreground">Booking calls DHL to assign the AWB{pickupDate ? " and schedule the pickup" : ""}; the waybill + invoice can then be handed to the CHA.</p>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          {/* Never a dead button without a reason: what is missing is said in place. */}
          {missing && <span className="text-xs text-warn">{missing}</span>}
          <Button onClick={book} disabled={!canBook}>Book with DHL</Button>
        </div>
      </section>
    </div>
  );
}

/** Numbered section heading — the old wizard steps, now landmarks on one page. */
function SectionHead({ n, title, done, optional }: { n: number; title: string; done: boolean; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold",
        done ? "border-emerald-400/60 bg-ok-bg text-ok" : "border-primary bg-accent-soft text-primary",
      )}>
        {done ? "✓" : n}
      </span>
      <h4 className="text-[13px] font-semibold">{title}</h4>
      {optional && <span className="text-[10px] uppercase tracking-wide text-faint">optional</span>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v}</span></div>;
}
