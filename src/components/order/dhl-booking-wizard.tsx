"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Labeled, Input, Select } from "@/components/ui/form";
import { Button, Pill } from "@/components/ui/primitives";
import { useStore } from "@/store/store";
import { remainingToShipLeg } from "@/store/selectors";
import { dhlGetRates, dhlLandedCost, type DhlProduct } from "@/integrations/logistics";
import { CURRENCIES } from "@/data/enums";
import { money, fmtAddress, cn } from "@/lib/utils";

const STEPS = ["Shipment", "Rate", "Pickup", "Confirm"] as const;

// Multi-step DHL Express booking for the inbound leg (we book), mapped to the MyDHL API:
// rates → shipment (+ pickup) → confirm. Supplier docs pre-fill the particulars.
export function DhlBookingWizard({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const b = useStore((s) => s.orders[orderId]);
  const createShipment = useStore((s) => s.createShipment);
  const sd = b?.shippingDocs;
  const [step, setStep] = useState(0);
  // particulars (from the supplier's packing list / commercial invoice)
  const [pieces, setPieces] = useState(sd?.pieces ?? 1);
  const [weightKg, setWeightKg] = useState(sd?.grossWeightKg ?? 0);
  const [dims, setDims] = useState(sd?.dimensions ?? "");
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
  const [notifyFinance, setNotifyFinance] = useState(true);

  if (!b) return null;
  const from = b.supplier.name;
  const to = fmtAddress(b.hubAddress) || "1Buy hub";
  const lines = b.lines.map((l) => ({ mpn: l.mpn, qty: remainingToShipLeg(b, l.mpn, "INBOUND") })).filter((l) => l.qty > 0);
  const detailsOk = weightKg > 0 && goods.trim() && hsCode.trim() && declaredValue > 0 && lines.length > 0;
  const canNext = step === 0 ? detailsOk : step === 1 ? !!productCode : step === 2 ? !!pickupDate : true;
  const product = products.find((p) => p.productCode === productCode);

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

  const book = () => {
    const id = createShipment(orderId, {
      leg: "INBOUND", carrier: "DHL", fromLocation: from, toLocation: to,
      boxCount: pieces, grossWeightKg: weightKg, lines,
      dimensions: dims.trim() || undefined, goodsDescription: goods.trim(), hsCode: hsCode.trim(),
      declaredValue, declaredCurrency: declaredCcy, pickupReadyDate: pickupDate || undefined, bookingDocs: sd?.docs,
      notifyFinanceBoe: notifyFinance,
      productCode: product?.productCode, productName: product?.productName, rateAmount: product?.price,
      rateCurrency: product?.currency, estimatedDelivery: product?.estimatedDelivery,
      bookingMode, pickupDate: pickupDate || undefined, pickupCloseTime: closeTime,
    });
    if (id) onClose();
  };

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      {step > 0 && <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button>}
      {step < STEPS.length - 1
        ? <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Next</Button>
        : <Button onClick={book}>Book with DHL</Button>}
    </>
  );

  return (
    <Dialog open onClose={onClose} title="Book inbound shipment · DHL Express" footer={footer}>
      <div className="space-y-3">
        {/* stepper */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn("rounded-lg border px-2 py-1 text-xs font-medium", i === step ? "border-primary bg-accent-soft text-primary" : i < step ? "border-emerald-400/60 bg-ok-bg text-ok" : "text-muted-foreground")}>{i + 1}. {s}{i < step ? " ✓" : ""}</span>
              {i < STEPS.length - 1 && <span className="text-faint">→</span>}
            </span>
          ))}
        </div>
        <div className="rounded-lg border border-primary/40 bg-accent-soft p-2.5 text-xs text-primary">
          <b>{b.orderNo}</b> · {from} → {to} · Incoterm {b.incoterm}{sd?.status === "RECEIVED" ? " · particulars from supplier docs" : ""}
        </div>

        {/* Step 1 — Shipment particulars */}
        {step === 0 && (
          <>
            <div className="text-xs text-muted-foreground">Lines: {lines.map((l) => `${l.mpn} ×${l.qty}`).join(" · ") || "nothing to ship"}</div>
            <div className="grid grid-cols-3 gap-3">
              <Labeled label="Pieces"><Input type="number" value={pieces} onChange={(e) => setPieces(Math.max(1, +e.target.value))} /></Labeled>
              <Labeled label="Gross weight (kg)"><Input type="number" value={weightKg} onChange={(e) => setWeightKg(+e.target.value)} /></Labeled>
              <Labeled label="Dimensions" hint="L×W×H"><Input value={dims} onChange={(e) => setDims(e.target.value)} placeholder="33×26×29" /></Labeled>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Goods description"><Input value={goods} onChange={(e) => setGoods(e.target.value)} /></Labeled>
              <Labeled label="HS code"><Input value={hsCode} onChange={(e) => setHsCode(e.target.value)} placeholder="8541.10" /></Labeled>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Declared value"><Input type="number" value={declaredValue} onChange={(e) => setDeclaredValue(+e.target.value)} /></Labeled>
              <Labeled label="Currency"><Select value={declaredCcy} onChange={(e) => setDeclaredCcy(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Labeled>
            </div>
          </>
        )}

        {/* Step 2 — Rate */}
        {step === 1 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={getRates} disabled={ratesLoading}>{ratesLoading ? "Fetching…" : products.length ? "Refresh DHL rates" : "Get DHL rates"}</Button>
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
          </>
        )}

        {/* Step 3 — Pickup */}
        {step === 2 && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Labeled label="Pickup mode" hint="combined = with shipment"><Select value={bookingMode} onChange={(e) => setBookingMode(e.target.value as "COMBINED" | "SEPARATE")}><option value="COMBINED">Combined (inline)</option><option value="SEPARATE">Separate (/pickups)</option></Select></Labeled>
              <Labeled label="Pickup date"><Input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} /></Labeled>
              <Labeled label="Close time"><Input value={closeTime} onChange={(e) => setCloseTime(e.target.value)} placeholder="18:00" /></Labeled>
            </div>
            <p className="text-xs text-muted-foreground">
              <b>Combined</b> creates the courier pickup inline with the shipment (one <code>POST /shipments</code> call). <b>Separate</b> books the shipment now and schedules the pickup via <code>POST /pickups</code> — use when the pickup time isn&apos;t known yet or one pickup covers several shipments.
            </p>
          </>
        )}

        {/* Step 4 — Confirm */}
        {step === 3 && (
          <>
            <div className="space-y-1.5 rounded-lg border p-3 text-sm">
              <Row k="Route" v={`${from} → ${to}`} />
              <Row k="Cargo" v={`${pieces} pcs · ${weightKg} kg · ${dims || "—"}`} />
              <Row k="Goods" v={`${goods} · HS ${hsCode} · ${money(declaredValue, declaredCcy)}`} />
              <Row k="DHL product" v={product ? `${product.productName} (${product.productCode}) · ${money(product.price, product.currency)} · ${product.estimatedDelivery}` : "— not selected —"} />
              <Row k="Pickup" v={pickupDate ? `${pickupDate} · by ${closeTime} · ${bookingMode === "SEPARATE" ? "separate" : "combined"}` : "—"} />
              {sd?.docs?.length ? <Row k="Docs" v={sd.docs.join(", ")} /> : null}
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
              <input type="checkbox" checked={notifyFinance} onChange={(e) => setNotifyFinance(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
              <span className="text-muted-foreground"><b className="text-foreground">Notify Finance to file the BoE (Prior)</b> — queues a Bill of Entry on the Customs desk now, without waiting for arrival.</span>
            </label>
            <p className="text-xs text-muted-foreground">Booking calls DHL to assign the AWB{pickupDate ? " and schedule the pickup" : ""}; the waybill + invoice can then be handed to the CHA.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="text-right font-medium">{v}</span></div>;
}
