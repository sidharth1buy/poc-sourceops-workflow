"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Wallet, Check } from "lucide-react";
import { useStore } from "@/store/store";
import { weClearImportCustoms } from "@/lib/incoterm";
import { customsBucket, BUCKET_META, BUCKET_ORDER, type CustomsBucket } from "@/lib/customs-bucket";
import { Panel, Pill, Button, PageHeader } from "@/components/ui/primitives";
import { FileBOEModal } from "@/components/order/modals";
import { money, cn } from "@/lib/utils";

type CustomsTab = "ALL" | CustomsBucket;
const BUCKET_SLUG: Record<CustomsBucket, string> = { NEW: "new", FILED: "filed", PENDING_PAYMENT: "pending-payment", PAID: "paid", CLEARED: "cleared" };
const SLUG_BUCKET: Record<string, CustomsTab> = { all: "ALL", new: "NEW", filed: "FILED", "pending-payment": "PENDING_PAYMENT", paid: "PAID", cleared: "CLEARED" };

export default function CustomsDeskPage() {
  return (
    <Suspense fallback={<PageHeader title="Customs" description="Loading…" />}>
      <CustomsDesk />
    </Suspense>
  );
}

function CustomsDesk() {
  const orders = useStore((s) => s.orders);
  const clearCustoms = useStore((s) => s.clearCustoms);
  const router = useRouter();
  const params = useSearchParams();

  const focusId = params.get("order") ?? "";
  const [fileFor, setFileFor] = useState(params.get("file") === "1" ? focusId : "");
  const [tab, setTab] = useState<CustomsTab>(SLUG_BUCKET[params.get("tab") ?? ""] ?? "ALL");
  const goTab = (t: CustomsTab) => { setTab(t); router.replace(`/fulfilment/customs?tab=${t === "ALL" ? "all" : BUCKET_SLUG[t]}`); };
  const closeFile = () => { setFileFor(""); router.replace(`/fulfilment/customs?tab=${tab === "ALL" ? "all" : BUCKET_SLUG[tab]}`); };

  // one row per inbound shipment 1Buy clears (international, not DDP)
  const items = Object.values(orders)
    .filter((o) => weClearImportCustoms(o))
    .flatMap((o) => o.shipments.filter((s) => s.leg === "INBOUND").map((s) => ({
      key: s.id, order: o, shipment: s, ce: o.customs.find((c) => c.shipmentNo === s.shipmentNo),
    })))
    .sort((a, b) => String(b.order.createdAt).localeCompare(String(a.order.createdAt)));

  const bucketOf = (it: (typeof items)[number]): CustomsBucket => (it.ce ? customsBucket(it.ce) : "NEW");
  const counts = Object.fromEntries(BUCKET_ORDER.map((bk) => [bk, items.filter((it) => bucketOf(it) === bk).length])) as Record<CustomsBucket, number>;
  const shown = tab === "ALL" ? items : items.filter((it) => bucketOf(it) === tab);

  const TABS: { t: CustomsTab; label: string; count: number }[] = [
    { t: "ALL", label: "All", count: items.length },
    ...BUCKET_ORDER.map((bk) => ({ t: bk as CustomsTab, label: BUCKET_META[bk].label, count: counts[bk] })),
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Customs" description={<>India import clearance for every order <b className="text-foreground">1Buy clears</b> (ICEGATE). File the Bill of Entry — directly via API or through the CHA — pay the assessed duty on the <b className="text-foreground">Payments</b> desk, then release with Out-of-Charge. DDP orders (supplier clears) never appear here.</>} />

      {/* bucket tabs */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b">
        {TABS.map(({ t, label, count }) => (
          <button key={t} onClick={() => goTab(t)}
            className={cn("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm transition",
              tab === t ? "border-primary bg-accent-soft font-semibold text-primary" : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {label}
            {count ? <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{count}</span> : null}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Panel><div className="p-6 text-center text-sm text-muted-foreground">Nothing in this bucket.</div></Panel>
      ) : (
        <div className="space-y-2">
          {shown.map((it) => {
            const bk = bucketOf(it);
            const c = it.ce;
            const focused = focusId === it.order.id;
            return (
              <Panel key={it.key} className={focused ? "ring-2 ring-primary/40" : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link href={`/fulfilment/orders/${it.order.id}`} className="font-mono text-xs font-medium text-primary hover:underline">{it.order.orderNo}</Link>
                      <span className="font-mono text-xs text-muted-foreground">{it.shipment.shipmentNo} · {it.shipment.awb}</span>
                      <Pill tone={BUCKET_META[bk].tone}>{BUCKET_META[bk].label}</Pill>
                      {c?.filingMode && <Pill tone="neutral">{c.filingMode === "CHA" ? "via CHA" : "ICEGATE API"}</Pill>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {it.order.supplier.name} → 1Buy hub · Port {c?.portCode ?? "INDEL4"} · CHA {c?.chaName ?? "—"}
                      {c?.beNo && c.beNo !== "filing…" ? <> · BE <span className="font-mono text-foreground">{c.beNo}</span></> : null}
                      {c?.igmNo ? ` · IGM ${c.igmNo}/${c.igmItemNo}` : ""}
                    </div>
                    {c?.duty && (
                      <div className="text-xs text-muted-foreground">
                        Duty (BCD {money(c.duty.bcd, c.currency)} + SWS {money(c.duty.sws, c.currency)} + IGST {money(c.duty.igst, c.currency)}) = <b className="text-foreground">{money(c.duty.totalDuty, c.currency)}</b>
                        {c.dutyPaidAt && <span className="text-ok"> · paid {c.dutyPaidAt}{c.dutyInvoice ? ` · ${c.dutyInvoice}` : ""}</span>}
                      </div>
                    )}
                    {c?.docs?.length ? <div className="text-xs text-muted-foreground">📎 {c.docs.join(", ")}</div> : null}
                    {c?.icegateRef && <div className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> Out of Charge · ICEGATE {c.icegateRef} · {c.oocDate} — shipment released.</div>}
                  </div>

                  {/* stage action */}
                  <div className="flex shrink-0 items-center gap-2">
                    {bk === "NEW" && <Button variant="outline" onClick={() => setFileFor(it.order.id)}><Plus className="h-4 w-4" /> File BoE</Button>}
                    {bk === "FILED" && <span className="text-xs text-muted-foreground">Filed — auto-assessing…</span>}
                    {bk === "PENDING_PAYMENT" && <Button variant="outline" onClick={() => router.push("/fulfilment/payments?tab=customs")}><Wallet className="h-4 w-4" /> Pay on Payments</Button>}
                    {bk === "PAID" && c && <Button variant="outline" onClick={() => clearCustoms(it.order.id, c.id)}>Release · Out-of-Charge</Button>}
                    {bk === "CLEARED" && <span className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" /> cleared</span>}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {fileFor && <FileBOEModal orderId={fileFor} onClose={closeFile} />}
    </div>
  );
}
