// THE LOGISTICS DESK'S CONVERSATION ABOUT ONE ORDER — and nobody else's.
//
// The order-wide correspondence view (order-correspondence.ts) joins everything
// said to anyone: the laboratory thread, the escrow agent's mailbox, the lot.
// None of that is the logistics desk's concern, and a desk shown other desks'
// mail reads none of it. This builder is deliberately narrower: the supplier's
// shipping-document exchange, the desk's own thread with the carrier / broker /
// dock / insurer, the documents it produced and sent, and the milestone acts
// (booking, waybill to the broker, proof of delivery) that ARE correspondence
// even though a form performed them.
//
// NEWEST FIRST, direction first on the row — the thread is read to find out
// whose move it is, and those two facts answer it.

import type { OrderBundle } from "@/types";
import { LOGISTICS_PARTY_LABEL, type LogisticsParty } from "@/integrations/logistics";

export type ThreadKind = "MAIL" | "DOCUMENT" | "MILESTONE";

export interface ThreadItem {
  id: string;
  /** The chain this email belongs to (root id). Only manual mail chains. */
  threadId?: string;
  with: LogisticsParty;
  way: "OUT" | "IN";
  subject: string;
  body?: string;
  at: string;
  /** The named mailbox or record on the other side. */
  who: string;
  cc?: string[];
  bcc?: string[];
  kind: ThreadKind;
  /** File names on the mail — openable; the file is rendered on demand. */
  attachments?: string[];
  /** True for real mail that can be answered — records and milestones cannot. */
  replyable?: boolean;
}

export const THREAD_PARTY_LABEL = LOGISTICS_PARTY_LABEL;

const label = (key: string) => THREAD_PARTY_LABEL[key as LogisticsParty] ?? key;

/*
 * EMAIL CATEGORIES. Every mail is filed somewhere — and can be filed in
 * SEVERAL places at once: a carrier's freight invoice belongs under the
 * Logistics partner AND under Finance, and ticking both is how one email
 * appears in both filters. Defaults to the party the mail is with; an email
 * mapped to nothing sits under OTHERS. Filing is a decision, so it is stored
 * per email on the order — not guessed again on every render.
 */
export type EmailCategory = Exclude<LogisticsParty, "OTHER"> | "OTHERS";

export const CATEGORY_ORDER: EmailCategory[] = [
  "SUPPLIER", "CARRIER", "CHA", "WAREHOUSE", "CLIENT", "INSURER", "FINANCE", "OTHERS",
];

export const CATEGORY_LABEL: Record<EmailCategory, string> = {
  SUPPLIER: LOGISTICS_PARTY_LABEL.SUPPLIER,
  CARRIER: LOGISTICS_PARTY_LABEL.CARRIER,
  CHA: LOGISTICS_PARTY_LABEL.CHA,
  WAREHOUSE: LOGISTICS_PARTY_LABEL.WAREHOUSE,
  CLIENT: LOGISTICS_PARTY_LABEL.CLIENT,
  INSURER: LOGISTICS_PARTY_LABEL.INSURER,
  FINANCE: LOGISTICS_PARTY_LABEL.FINANCE,
  OTHERS: "Others",
};

/** Every category an item is filed under: the manual filing, else its party, else Others. */
export function categoriesOf(item: ThreadItem, b: OrderBundle): EmailCategory[] {
  const filed = b.logisticsEmailCategories?.[item.id];
  if (filed !== undefined) {
    const valid = filed.filter((c): c is EmailCategory => c in CATEGORY_LABEL);
    /* An explicitly emptied filing means "mapped to nothing" — Others. */
    return valid.length ? valid : ["OTHERS"];
  }
  if (item.with && item.with !== "OTHER") return [item.with];
  return ["OTHERS"];
}

/** Everything the desk has said and been sent on this order, newest first. */
export function logisticsThreadItems(b: OrderBundle): ThreadItem[] {
  const items: ThreadItem[] = [];
  const sd = b.shippingDocs;
  const leg = b.shipments.find((s) => s.leg === "INBOUND");
  const customs = b.customs?.[0];

  // The supplier document exchange — the first mail on almost every order.
  if (sd) {
    items.push({
      id: "sd-req", with: "SUPPLIER", way: "OUT", kind: "MAIL",
      subject: `Shipping documents requested — ${sd.requested.join(", ")}`,
      body: sd.requestBody, at: sd.requestedAt ?? "", who: "supplier documents desk",
    });
    if (sd.status === "RECEIVED") {
      items.push({
        id: "sd-recv", with: "SUPPLIER", way: "IN", kind: "MAIL",
        subject: `Shipping documents received — ${(sd.docs ?? sd.requested).join(", ")}`,
        body: [
          sd.pieces ? `${sd.pieces} boxes · ${sd.grossWeightKg ?? "?"} kg · ${sd.dimensions ?? "dims n/a"}` : undefined,
          sd.goodsDescription ? `${sd.goodsDescription} · HS ${sd.hsCode ?? "—"}` : undefined,
          sd.declaredValue ? `Declared ${sd.declaredCurrency ?? ""} ${sd.declaredValue}` : undefined,
        ].filter(Boolean).join("\n"),
        at: sd.receivedAt ?? "", who: "supplier documents desk",
        attachments: (sd.docs ?? sd.requested).map((d) => `${d}.pdf`),
      });
    }
  }

  // Milestone acts that are correspondence, performed by forms.
  if (leg && leg.awb !== "booking…" && leg.awb !== "booking failed" && leg.awb) {
    items.push({
      id: "bk", with: "CARRIER", way: "OUT", kind: "MILESTONE",
      subject: `Booking placed with ${leg.carrier} — AWB ${leg.awb}`,
      body: `${leg.fromLocation} → ${leg.toLocation} · ${leg.boxCount} boxes · ${leg.grossWeightKg} kg${leg.productName ? ` · ${leg.productName}` : ""}${leg.pickupWindow ? ` · pickup ${leg.pickupWindow}` : ""}`,
      at: leg.dispatchDate ?? leg.updatedAt ?? "", who: leg.carrier,
    });
  }
  if (customs?.awbSentToChaAt && leg) {
    items.push({
      id: "awb-cha", with: "CHA", way: "OUT", kind: "MILESTONE",
      subject: `Waybill and invoice handed to the broker — AWB ${leg.awb}`,
      body: `For filing against shipment ${customs.shipmentNo}${customs.chaName ? ` · ${customs.chaName}` : ""}`,
      at: customs.awbSentToChaAt, who: customs.chaName ?? "customs broker",
    });
  }
  if (leg?.pod) {
    items.push({
      id: "pod", with: "CARRIER", way: "IN", kind: "MILESTONE",
      subject: `Proof of delivery returned${leg.podRef ? ` — ${leg.podRef}` : ""}`,
      body: "The carrier's record that the consignment was handed over at the warehouse.",
      at: leg.pod, who: leg.carrier,
    });
  }

  // Documents the desk produced and sent — one row per document, filed under
  // its first recipient so the party filters still find it.
  for (const d of b.logisticsOutbox ?? []) {
    const names = d.to.map(label).join(", ");
    items.push({
      id: d.id, with: (d.to[0] as LogisticsParty) ?? "CARRIER", way: "OUT", kind: "DOCUMENT",
      subject: `${d.name} sent to ${names}`,
      body: d.body, at: d.at, who: names,
    });
  }

  // The desk's own mail, both directions.
  for (const m of b.logisticsThread ?? []) {
    items.push({ id: m.id, threadId: m.threadId, with: m.with, way: m.way, kind: "MAIL", subject: m.subject, body: m.body, at: m.at, who: m.who, cc: m.cc, bcc: m.bcc, attachments: m.attachments, replyable: true });
  }

  return items.sort((a, z) => (z.at || "").localeCompare(a.at || ""));
}

/**
 * Who owes this thread a reply — our newest mail to them is more recent than
 * their newest to us. Drives the "check for replies" affordance.
 */
export function partiesOwingReply(b: OrderBundle): LogisticsParty[] {
  const thread = b.logisticsThread ?? [];
  const parties = Array.from(new Set(thread.map((m) => m.with)));
  return parties.filter((p) => {
    const last = [...thread].reverse().find((m) => m.with === p);
    return last?.way === "OUT";
  });
}

/** One conversation: the root email and everything chained onto it. */
export interface MailChain {
  /** Root id for mail chains; the item's own id for standalone records. */
  key: string;
  root: ThreadItem;
  /** All emails in the chain, oldest first — the order a chain is read in. */
  emails: ThreadItem[];
  lastAt: string;
}

/**
 * Fold the flat item list into chains. Replyable mail groups on its root;
 * records and milestones are single-item chains. Sorted by latest activity,
 * newest conversation first.
 */
export function groupChains(items: ThreadItem[]): MailChain[] {
  const byKey = new Map<string, ThreadItem[]>();
  for (const i of items) {
    const key = i.replyable ? (i.threadId ?? i.id) : i.id;
    const arr = byKey.get(key);
    if (arr) arr.push(i);
    else byKey.set(key, [i]);
  }
  return Array.from(byKey.entries())
    .map(([key, arr]) => {
      const emails = [...arr].sort((a, z) => (a.at || "").localeCompare(z.at || ""));
      const root = emails.find((e) => e.id === key) ?? emails[0];
      return { key, root, emails, lastAt: emails[emails.length - 1].at || "" };
    })
    .sort((a, z) => z.lastAt.localeCompare(a.lastAt));
}
