"use client";

// WHERE THE CONSIGNMENT IS, DRAWN AS THE JOURNEY IT ACTUALLY MAKES.
//
// Eight stops, in the order a person meets them, with the current one named in
// plain words. The strip below states the delivered rule and which half of it
// is still missing — because "delivered" here is a defined term (goods receipt
// note AND proof of delivery), not a feeling about a van having left.

import { Check } from "lucide-react";
import { INBOUND_META, INBOUND_ORDER, PRESSURE_META, type InboundView } from "@/lib/logistics-order";
import { Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export function InboundStepper({ v }: { v: InboundView }) {
  return (
    <div>
      {/* The journey. */}
      <ol className="flex flex-wrap items-center gap-y-2">
        {INBOUND_ORDER.map((stage, i) => {
          const done = i < v.stageIndex || v.delivered;
          const current = i === v.stageIndex && !v.delivered;
          return (
            <li key={stage} className="flex items-center">
              <span className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold",
                    done && "border-emerald-400/60 bg-ok-bg text-ok",
                    current && "border-primary bg-accent-soft text-primary ring-2 ring-primary/20",
                    !done && !current && "text-faint",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "mt-1 max-w-[72px] text-center text-[10px] leading-tight",
                    current ? "font-semibold text-primary" : done ? "text-ok" : "text-muted-foreground",
                  )}
                >
                  {INBOUND_META[stage].label}
                </span>
              </span>
              {i < INBOUND_ORDER.length - 1 && (
                <span className={cn("mx-1 mb-4 h-px w-4 sm:w-6", done ? "bg-emerald-400/60" : "bg-border")} />
              )}
            </li>
          );
        })}
      </ol>

      {/* What the current stop means, in the reader's words. */}
      <p className="mt-2 text-xs text-muted-foreground">
        <b className="text-foreground">{INBOUND_META[v.stage].label}:</b> {INBOUND_META[v.stage].what}
      </p>

      {/* The delivered rule — both documents, named, with what is missing. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
        <span className="font-medium">Delivered means both:</span>
        <Pill tone={v.grnNo ? "ok" : "warn"}>{v.grnNo ? `Goods receipt note ${v.grnNo}` : "Goods receipt note — not issued"}</Pill>
        <Pill tone={v.podAt ? "ok" : "warn"}>{v.podAt ? `Proof of delivery · ${v.podAt}` : "Proof of delivery — not back"}</Pill>
        {v.deliveryGap && <span className="w-full text-muted-foreground sm:w-auto">{v.deliveryGap}</span>}
      </div>

      {/* How hard the date presses, and why. */}
      <p className={cn("mt-2 text-xs", v.pressure === "OVERDUE" || v.pressure === "CRITICAL" ? "text-bad" : v.pressure === "TIGHT" ? "text-warn" : "text-muted-foreground")}>
        <b>{PRESSURE_META[v.pressure].label}.</b> {v.because}
      </p>
    </div>
  );
}
