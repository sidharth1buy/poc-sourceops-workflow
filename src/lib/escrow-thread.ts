// THE ESCROW DESK'S CONVERSATION ABOUT ONE ORDER.
//
// The twin of `lib/logistics-thread.ts`, deliberately the same shape: a
// ThreadItem per message, categories every email is filed under, chains that
// group a root with its replies, and a "who owes us a reply" check. An escrow
// desk that has learned the Logistics Communication tab reads this one without
// being taught again.
//
// WHO THE PARTIES ARE IS FIXED HERE, unlike logistics. An escrow order only
// ever involves HKin (the agent), the seller, our own Finance team and the
// client — so the address is matched against the contacts the escrow order
// already carries rather than guessed from the domain.

import type { Escrow, EscrowAgentEmail, OrderBundle } from "@/types";

export type EscrowParty = "HKIN" | "SUPPLIER" | "FINANCE" | "CLIENT" | "OTHER";

export const ESCROW_PARTY_LABEL: Record<EscrowParty, string> = {
  HKIN: "Escrow agent (HKin)",
  SUPPLIER: "Seller",
  FINANCE: "Finance",
  CLIENT: "Client",
  OTHER: "Other contact",
};

/** An email is filed under one or more of these; OTHERS holds what maps to nothing. */
export type EscrowCategory = Exclude<EscrowParty, "OTHER"> | "OTHERS";

export const ESCROW_CATEGORY_ORDER: EscrowCategory[] = ["HKIN", "SUPPLIER", "FINANCE", "CLIENT", "OTHERS"];

export const ESCROW_CATEGORY_LABEL: Record<EscrowCategory, string> = {
  HKIN: ESCROW_PARTY_LABEL.HKIN,
  SUPPLIER: ESCROW_PARTY_LABEL.SUPPLIER,
  FINANCE: ESCROW_PARTY_LABEL.FINANCE,
  CLIENT: ESCROW_PARTY_LABEL.CLIENT,
  OTHERS: "Others",
};

/** The mailbox we use for each party on this order. */
export function escrowContact(e: Escrow, p: EscrowParty): string {
  switch (p) {
    case "HKIN": return e.hkinCsContactEmail || "billing@hkin-escrow.example";
    case "SUPPLIER": return e.sellerContact.email && e.sellerContact.email !== "—" ? e.sellerContact.email : "sales@supplier.demo";
    case "FINANCE": return "finance@1buy.ai";
    case "CLIENT": return e.buyerContact.email && e.buyerContact.email !== "—" ? e.buyerContact.email : "orders@client.demo";
    case "OTHER": return "";
  }
}

/**
 * Who a typed address belongs to. The escrow order's own contacts first, then
 * plain heuristics; anything unrecognised is OTHER, which files under Others.
 */
export function inferEscrowParty(e: Escrow, email: string): EscrowParty {
  const x = email.trim().toLowerCase();
  if (!x) return "OTHER";
  const known: EscrowParty[] = ["HKIN", "SUPPLIER", "FINANCE", "CLIENT"];
  for (const p of known) if (escrowContact(e, p).toLowerCase() === x) return p;
  if (/hkin|escrow|billing@/.test(x)) return "HKIN";
  if (/finance|accounts|payable|treasury/.test(x)) return "FINANCE";
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (x.includes(slug(e.sellerContact.company).slice(0, 8))) return "SUPPLIER";
  if (x.includes(slug(e.buyerContact.company).slice(0, 8))) return "CLIENT";
  return "OTHER";
}

export interface EscrowThreadItem {
  id: string;
  threadId?: string;
  with: EscrowParty;
  way: "OUT" | "IN";
  subject: string;
  body?: string;
  at: string;
  /** The named mailbox on the other side. */
  who: string;
  cc?: string;
  bcc?: string;
  attachments?: string[];
  /** Real mail can be answered; nothing here is a milestone record, so all of it is. */
  replyable: boolean;
}

/** Every message on the escrow order, newest first. */
export function escrowThreadItems(b: OrderBundle): EscrowThreadItem[] {
  const e = b.escrow;
  if (!e) return [];
  return [...e.agentEmails]
    .map((m: EscrowAgentEmail): EscrowThreadItem => {
      const out = m.direction === "SENT";
      const counterparty = out ? (m.to ?? "") : m.from;
      return {
        id: m.id,
        threadId: m.threadId,
        with: inferEscrowParty(e, counterparty),
        way: out ? "OUT" : "IN",
        subject: m.subject,
        body: m.snippet,
        at: m.receivedAt,
        who: counterparty || (out ? "—" : m.from),
        cc: m.cc,
        bcc: m.bcc,
        attachments: m.attachmentFileName ? [m.attachmentFileName] : undefined,
        replyable: true,
      };
    })
    .sort((a, z) => (z.at || "").localeCompare(a.at || ""));
}

/** Every category an item is filed under: the manual filing, else its party, else Others. */
export function escrowCategoriesOf(item: EscrowThreadItem, b: OrderBundle): EscrowCategory[] {
  const filed = b.escrow?.emailCategories?.[item.id];
  if (filed !== undefined) {
    const valid = filed.filter((c): c is EscrowCategory => c in ESCROW_CATEGORY_LABEL);
    /* An explicitly emptied filing means "mapped to nothing" — Others. */
    return valid.length ? valid : ["OTHERS"];
  }
  if (item.with && item.with !== "OTHER") return [item.with];
  return ["OTHERS"];
}

/** One conversation: the root email and everything chained onto it. */
export interface EscrowMailChain {
  key: string;
  root: EscrowThreadItem;
  /** Oldest first — the order a chain is read in. */
  emails: EscrowThreadItem[];
  lastAt: string;
}

/** Fold the flat list into chains, newest conversation first. */
export function groupEscrowChains(items: EscrowThreadItem[]): EscrowMailChain[] {
  const byKey = new Map<string, EscrowThreadItem[]>();
  for (const i of items) {
    const key = i.threadId ?? i.id;
    const arr = byKey.get(key);
    if (arr) arr.push(i);
    else byKey.set(key, [i]);
  }
  return Array.from(byKey.entries())
    .map(([key, arr]) => {
      const emails = [...arr].sort((a, z) => (a.at || "").localeCompare(z.at || ""));
      const root = emails.find((x) => x.id === key) ?? emails[0];
      return { key, root, emails, lastAt: emails[emails.length - 1].at || "" };
    })
    .sort((a, z) => z.lastAt.localeCompare(a.lastAt));
}

/**
 * Who owes this thread a reply — our newest mail to them is more recent than
 * their newest to us. Drives the "check for replies" affordance.
 */
export function escrowPartiesOwingReply(b: OrderBundle): EscrowParty[] {
  const items = escrowThreadItems(b);
  const parties = Array.from(new Set(items.map((m) => m.with)));
  return parties.filter((p) => {
    /* items are newest-first, so the first hit is the latest message. */
    const last = items.find((m) => m.with === p);
    return last?.way === "OUT";
  });
}
