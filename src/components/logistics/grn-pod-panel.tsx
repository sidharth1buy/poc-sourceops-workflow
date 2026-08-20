"use client";

// THE TWO RECORDS THAT CLOSE AN INBOUND ORDER OUT.
//
// The goods receipt note is the warehouse's count against the packing list; the
// proof of delivery is the carrier's record that the handover happened. One
// without the other is a claim nobody can win, so the order is delivered only
// when BOTH are on file — and this panel exists to collect exactly those two
// things, inline, no dialogs.
//
// BOTH FORMS STAY LOCKED UNTIL THE GOODS REACH THE WAREHOUSE. A receipt issued
// for a consignment still at customs would be fiction with a document number,
// and showing the forms early invites exactly that.

import { useState } from "react";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { useStore } from "@/store/store";
import { INBOUND_ORDER, type InboundView } from "@/lib/logistics-order";
import type { OrderBundle } from "@/types";
import { Button } from "@/components/ui/primitives";
import { Input, Labeled, Textarea } from "@/components/ui/form";

export function GrnPodPanel({ b, v }: { b: OrderBundle; v: InboundView }) {
  const issueGrn = useStore((s) => s.issueGrn);
  const recordInboundPod = useStore((s) => s.recordInboundPod);

  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(b.lines.map((l) => [l.mpn, l.quantity])),
  );
  const [discrepancy, setDiscrepancy] = useState("");
  const [podRef, setPodRef] = useState("");

  const atWarehouse = v.stageIndex >= INBOUND_ORDER.indexOf("AT_WAREHOUSE");

  if (v.delivered) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-400/60 bg-ok-bg p-3 text-sm text-ok">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>Delivered.</b> {v.grnNo} issued {b.grn?.receivedAt} and the carrier&rsquo;s proof of
          delivery came back {v.podAt}
          {b.shipments.find((s) => s.leg === "INBOUND")?.podRef ? ` (${b.shipments.find((s) => s.leg === "INBOUND")!.podRef})` : ""}.
          {b.grn?.discrepancy ? ` Noted at the dock: ${b.grn.discrepancy}` : ""}
        </span>
      </div>
    );
  }

  if (!atWarehouse) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        These two records close the order out, and they can only be made once the consignment is
        physically at the warehouse. Until then the work is above — getting it here.
      </p>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* ── The warehouse's half: the count ─────────────────────────────── */}
      <div className="rounded-lg border p-3">
        <h4 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
          <PackageCheck className="h-4 w-4 text-primary" />
          Goods receipt note
        </h4>
        {b.grn ? (
          <p className="text-xs text-ok">
            <b>{b.grn.grnNo}</b> issued {b.grn.receivedAt} by {b.grn.receivedBy} —{" "}
            {b.grn.lines.reduce((a, l) => a + l.receivedQty, 0)} pcs counted in.
            {b.grn.discrepancy ? <span className="text-warn"> Noted: {b.grn.discrepancy}</span> : ""}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              What was actually counted in at the dock, against what the order expects. Short or
              damaged? Say so in the note — it opens the damage-notice work below.
            </p>
            <div className="mb-2 space-y-1.5">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-1 text-[10px] font-medium uppercase tracking-wide text-faint">
                <span>Part</span>
                <span className="w-16 text-right">Expected</span>
                <span className="w-20 text-right">Received</span>
              </div>
              {b.lines.map((l) => (
                <div key={l.mpn} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <span className="truncate font-mono text-xs">{l.mpn}</span>
                  <span className="w-16 text-right text-xs text-muted-foreground tnum">{l.quantity}</span>
                  <Input
                    type="number"
                    min={0}
                    className="w-20 text-right"
                    value={qty[l.mpn] ?? 0}
                    onChange={(e) => setQty((q) => ({ ...q, [l.mpn]: Math.max(0, +e.target.value) }))}
                  />
                </div>
              ))}
            </div>
            <Labeled label="Anything short, damaged or queried" hint="optional">
              <Textarea
                rows={2}
                value={discrepancy}
                onChange={(e) => setDiscrepancy(e.target.value)}
                placeholder="e.g. 1 of 12 cartons crushed — contents intact, photographed"
              />
            </Labeled>
            <Button
              className="mt-2"
              onClick={() =>
                issueGrn(
                  b.id,
                  b.lines.map((l) => ({ mpn: l.mpn, expectedQty: l.quantity, receivedQty: qty[l.mpn] ?? 0 })),
                  discrepancy,
                )
              }
            >
              Issue goods receipt note
            </Button>
          </>
        )}
      </div>

      {/* ── The carrier's half: their record of the handover ─────────────── */}
      <div className="rounded-lg border p-3">
        <h4 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Proof of delivery
        </h4>
        {v.podAt ? (
          <p className="text-xs text-ok">
            Back from the carrier on <b>{v.podAt}</b>
            {b.shipments.find((s) => s.leg === "INBOUND")?.podRef ? ` · ${b.shipments.find((s) => s.leg === "INBOUND")!.podRef}` : ""}
            . {!b.grn && "Waiting on the goods receipt note to call the order delivered."}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              The logistics partner&rsquo;s own record that the consignment was handed over. Without
              it, a damage claim has nothing to pin on the carrier — chase it the same day the truck
              leaves.
            </p>
            <Labeled label="POD reference" hint="optional — the carrier's reference or signatory">
              <Input value={podRef} onChange={(e) => setPodRef(e.target.value)} placeholder="e.g. DHL ePOD 8827-441 / signed R. Mehta" />
            </Labeled>
            <Button className="mt-2" variant="outline" onClick={() => recordInboundPod(b.id, podRef)}>
              Record proof of delivery
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
