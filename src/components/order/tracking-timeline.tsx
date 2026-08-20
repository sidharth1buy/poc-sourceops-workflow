"use client";

import { trackingTimeline } from "@/integrations/logistics";
import { cn } from "@/lib/utils";
import type { Shipment } from "@/types";

function fmtHop(base: number, hrs: number) {
  const d = new Date(base + hrs * 3_600_000);
  /*
   * Pinned locale + timezone, not the environment's. This renders on the
   * server too, and `undefined` let Node and the browser format the same
   * instant differently — a hydration mismatch that regenerated the whole
   * page tree on every load.
   */
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

// DHL-style scan history for a shipment — a vertical timeline derived from the current status.
// Shared by the order's Shipment card and the cross-order Logistics desk.
export function TrackingTimeline({ s, isImport }: { s: Shipment; isImport: boolean }) {
  const hops = trackingTimeline(s.status, s.fromLocation, s.toLocation, isImport);
  if (hops.length === 0) return <p className="mt-3 text-xs text-muted-foreground">Booked — awaiting carrier pickup scan.</p>;
  const base = new Date(s.dispatchDate || s.deliveryDate || "2026-08-14T04:00:00Z").getTime();
  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tracking · {s.carrier}
        {s.awb && s.awb !== "booking…" && s.awb !== "booking failed" && <span className="font-mono text-[10px] normal-case text-faint">{s.awb}</span>}
      </div>
      <ol>
        {hops.map((h, i) => {
          const last = i === hops.length - 1;
          return (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", last ? "bg-primary ring-2 ring-primary/30" : "bg-ok")} />
                {!last && <span className="min-h-[1.75rem] w-px flex-1 bg-border" />}
              </div>
              <div className="pb-2">
                <div className={cn("text-sm text-foreground", last && "font-medium")}>{h.description}</div>
                <div className="text-xs text-muted-foreground">{h.location} · {fmtHop(base, h.hrs)} · <span className="font-mono text-[10px]">{h.status}</span></div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
