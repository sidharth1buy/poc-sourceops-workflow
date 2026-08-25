"use client";

// THE WHL INBOX — every unmatched lab email, across every order, with the test slot to file it on.
//
// This is where the per-order "manual match queue" went (2026-08-25). That panel sat on each
// order's Communication tab, which was the wrong place for it twice over:
//
//   · an unmatched mail belongs to no test slot **by definition** — that is what makes it
//     unmatched — so a screen scoped to one submission could never be the place to resolve it,
//     and it was the one panel on that tab that had to ignore the scope;
//   · worse, it could only offer that order's lots. An unroutable mail is precisely the one whose
//     order we cannot trust: WHL quoting the wrong client PO is a normal way for a mail to land on
//     the wrong thread, and the old queue's dropdown made that mistake impossible to correct.
//
// So the dropdown here lists **every test slot on every order**, grouped by order, and matching
// across orders moves the mail onto the target order's thread (`matchLabEmail`'s `toOrderId`).
// The board's "N WHL emails await matching" card links here.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, MailQuestion, Search } from "lucide-react";
import { useStore } from "@/store/store";
import { unmatchedEmails } from "@/store/selectors";
import { Button, PageHeader, Panel, Pill, RoleLocked } from "@/components/ui/primitives";
import { Input, Select } from "@/components/ui/form";
import { useRole } from "@/lib/role";
import { qtyfmt } from "@/lib/utils";

export default function WhlInboxPage() {
  const orders = useStore((s) => s.orders);
  const matchLabEmail = useStore((s) => s.matchLabEmail);
  const syncWhlInbox = useStore((s) => s.syncWhlInbox);
  const { canAccessTesting, canEditTests } = useRole();

  const [q, setQ] = useState("");
  /** the slot picked per email, as `<orderId>:<lotId>` — one draft per row, nothing global */
  const [pick, setPick] = useState<Record<string, string>>({});

  /** every unmatched mail, newest first, carrying the order it currently sits on */
  const rows = useMemo(
    () => Object.values(orders)
      .filter((b) => b.status !== "CANCELLED")
      .flatMap((b) => unmatchedEmails(b).map((m) => ({ m, b })))
      .sort((x, y) => String(y.m.at).localeCompare(String(x.m.at))),
    [orders],
  );

  /** every test slot on every order — the whole point of this screen being board-level */
  const slotGroups = useMemo(
    () => Object.values(orders)
      .filter((b) => b.status !== "CANCELLED" && b.lots.length > 0)
      .map((b) => ({ b, lots: b.lots }))
      .sort((x, y) => (x.b.orderNo < y.b.orderNo ? 1 : -1)),
    [orders],
  );
  const slotCount = slotGroups.reduce((a, g) => a + g.lots.length, 0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(({ m, b }) =>
      `${b.orderNo} ${m.subject} ${m.body} ${m.by} ${(m.attachments ?? []).join(" ")}`.toLowerCase().includes(needle));
  }, [rows, q]);

  if (!canAccessTesting) {
    return (
      <div className="space-y-5">
        <PageHeader title="WHL inbox" description="WHL testing — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="match WHL email" /></Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/fulfilment/testing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Testing
      </Link>

      <PageHeader
        title="WHL inbox — mail waiting on a test slot"
        description="Inbound lab mail that could not be filed automatically: no lot code, MPN or work order the parser recognised. Pick the test slot it belongs to — any slot on any order — and its updates apply to that lot."
      />

      <Panel
        title={`Awaiting a match · ${filtered.length}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, subject, sender, file…" className="w-60 pl-8" />
            </div>
          </div>
        }>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing waiting — every inbound WHL email is filed against a test slot. 🎉
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No unmatched email matches that search.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(({ m, b }) => {
              const chosen = pick[m.id] ?? "";
              const [toOrderId, lotId] = chosen ? chosen.split(":") : ["", ""];
              const target = toOrderId ? orders[toOrderId] : undefined;
              const targetLot = target?.lots.find((l) => l.id === lotId);
              return (
                <div key={m.id} className="rounded-[var(--radius)] border bg-warn-bg/30 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-[20rem] flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <MailQuestion className="h-3.5 w-3.5 text-warn" />
                        <span className="tnum">{m.at}</span>
                        <span>{m.by}</span>
                        {/* which thread it landed on — not necessarily the order it is about */}
                        <Pill tone="neutral">arrived on {b.orderNo}</Pill>
                        {m.kind && <Pill tone="info">{m.kind.replace(/_/g, " ").toLowerCase()}</Pill>}
                      </div>
                      <div className="mt-1 text-sm font-medium">{m.subject}</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{m.body}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="text-warn">{m.matchNote ?? "No lot code, MPN or work order in the message"}</span>
                        {m.attachments?.length ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <FileText className="h-3 w-3" /> {m.attachments.join(", ")}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* the mapping itself: one dropdown over every slot on every order */}
                    <div className="w-full sm:w-[26rem]">
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        File it against a test slot
                      </label>
                      <Select value={chosen} onChange={(e) => setPick((p) => ({ ...p, [m.id]: e.target.value }))}>
                        <option value="">Select a test slot — {slotCount} across {slotGroups.length} order(s)</option>
                        {slotGroups.map((g) => (
                          <optgroup key={g.b.id} label={`${g.b.orderNo} — ${g.b.buyer.name} → ${g.b.supplier.name}`}>
                            {g.lots.map((l) => (
                              <option key={l.id} value={`${g.b.id}:${l.id}`}>
                                {l.lotCode} · {l.orderLineMpn}
                                {l.workOrderNo ? ` · WO ${l.workOrderNo}` : ""}
                                {l.testSlotNo ? ` · ${l.testSlotNo}` : ""} · qty {qtyfmt(l.qty)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button disabled={!canEditTests || !targetLot}
                          title={canEditTests ? "Apply this mail's updates to the chosen test slot" : "Only SC / Mgmt may match WHL email"}
                          onClick={() => {
                            if (!targetLot || !target) return;
                            matchLabEmail(b.id, m.id, targetLot.id, target.id !== b.id ? target.id : undefined);
                            setPick((p) => ({ ...p, [m.id]: "" }));
                          }}>
                          Match to this slot
                        </Button>
                        {targetLot && target && target.id !== b.id && (
                          <span className="text-[11px] text-warn">
                            different order — the mail moves onto {target.orderNo}&apos;s thread
                          </span>
                        )}
                        {targetLot && (
                          <Link href={`/fulfilment/testing/${target!.id}?mpn=${encodeURIComponent(targetLot.orderLineMpn)}&lot=${targetLot.id}`}
                            className="text-[11px] font-medium text-primary hover:underline">
                            open that slot first →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Unroutable mail is held here rather than dropped or applied to the wrong test slot. Matching applies its
            updates — a report, an invoice, a receipt confirmation, a progress note — to that lot&apos;s tracker and moves
            the stage it establishes. A booking confirmation never appears here: it is order-level by design.
          </p>
          {rows.length > 0 && (
            <Button variant="outline" onClick={() => rows.forEach(({ b }) => syncWhlInbox(b.id))}
              title="Poll every order's mailbox again — a later mail sometimes names the work order the earlier one omitted">
              Check every mailbox
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
