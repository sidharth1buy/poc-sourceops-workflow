"use client";

// The four things that have to be settled before a consignment can fly, shown
// on the row where the booking is about to happen.
//
// They are DERIVED, never chosen: insurance and export clearance follow the
// Incoterm, dangerous goods follows what is in the box, and who the carrier
// bills follows the term as well. A dropdown would let somebody record the
// wrong one, and all four are only discovered to be wrong at the airport or on
// an invoice weeks later.
//
// Compact by default — one line per item — because on the majority of orders
// all four are already answered and the row is about booking, not about
// compliance. It is the BLOCKER that has to be unmissable, not the list.

import { AlertTriangle, Ban, Check, HelpCircle } from "lucide-react";
import type { ComplianceItem, ComplianceSeverity } from "@/lib/consignment-compliance";
import { Pill } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const TONE: Record<ComplianceSeverity, { pill: "bad" | "warn" | "neutral" | "ok"; word: string }> = {
  BLOCKER: { pill: "bad", word: "blocks booking" },
  REQUIRED: { pill: "warn", word: "needed" },
  CHECK: { pill: "neutral", word: "confirm" },
  SETTLED: { pill: "ok", word: "settled" },
};

const ICON: Record<ComplianceSeverity, typeof Check> = {
  BLOCKER: Ban,
  REQUIRED: AlertTriangle,
  CHECK: HelpCircle,
  SETTLED: Check,
};

export function ComplianceStrip({ items }: { items: ComplianceItem[] }) {
  const blockers = items.filter((i) => i.severity === "BLOCKER");
  const open = items.filter((i) => i.severity === "REQUIRED" || i.severity === "CHECK");

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          Before it can fly
        </span>
        {items.map((i) => (
          <Pill key={i.id} tone={TONE[i.severity].pill}>
            {i.label}
          </Pill>
        ))}
      </div>

      {/* Only what is actually outstanding gets a sentence. A settled item with a
          paragraph beside it is a warning about nothing, and four of those on
          every row is how people stop reading the strip. */}
      {(blockers.length > 0 || open.length > 0) && (
        <ul className="mt-1.5 space-y-1">
          {[...blockers, ...open].map((i) => {
            const Icon = ICON[i.severity];
            return (
              <li key={i.id} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                <Icon
                  className={cn(
                    "mt-0.5 h-3 w-3 shrink-0",
                    i.severity === "BLOCKER" ? "text-bad" : i.severity === "REQUIRED" ? "text-warn" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0">
                  <b className="text-foreground">{i.label}</b>
                  {" — "}
                  <span className={i.severity === "BLOCKER" ? "text-bad" : "text-muted-foreground"}>{i.answer}</span>
                  {/* The consequence only where something is actually owed. On a
                      "confirm this" item it is a paragraph about a hypothetical,
                      and three of those on every row is how the strip stops
                      being read. */}
                  {i.ifMissed && i.severity !== "CHECK" && (
                    <span className="text-muted-foreground"> {i.ifMissed}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
