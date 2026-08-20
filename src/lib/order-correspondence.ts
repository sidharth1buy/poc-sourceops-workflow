// Everything anybody said about one order, in one thread.
//
// The correspondence on an order is currently scattered across four places that
// never meet: the supplier's shipping-document exchange (`shippingDocs`), the
// laboratory thread (`labEmails`), the escrow agent's mailbox
// (`escrow.agentEmails`), and the notes recorded as events. Each screen shows
// its own and none shows the order's.
//
// That matters because the question people actually ask is never "what did the
// lab say" — it is "what has been said to anyone about this order, and who
// owes whom a reply". A supplier chasing a delivery date, a lab asking for a
// purchase-order reference and an escrow agent waiting on a confirmation are
// the same conversation from the order's point of view, and they are usually
// only reconciled when somebody forwards three mail threads to a fourth person.
//
// So this joins them, newest first, each entry saying which way it went and who
// the other party was. It is a pure derivation — nothing here sends anything,
// and every message still lives on the record that owns it.

import type { OrderBundle } from "@/types";

/** Which way the message went, from 1Buy's point of view. */
export type Way = "OUT" | "IN";

/** Who we were talking to. Drives the filter chips and the party column. */
export type Counterparty = "SUPPLIER" | "LAB" | "ESCROW" | "CLIENT" | "INTERNAL";

export interface Correspondence {
  id: string;
  at: string;
  way: Way;
  with: Counterparty;
  /** Named party where we know it — "WHL Reports", the supplier's name. */
  who: string;
  subject: string;
  /** The message itself where we hold it, else a one-line summary. */
  body?: string;
  attachments?: string[];
  /** Where this message actually lives, so the reader can go and act on it. */
  source: "Shipping docs" | "Testing" | "Escrow" | "Event";
}

const COUNTERPARTY_LABEL: Record<Counterparty, string> = {
  SUPPLIER: "Supplier",
  LAB: "Testing laboratory",
  ESCROW: "Escrow agent",
  CLIENT: "Client",
  INTERNAL: "Internal",
};

export const counterpartyLabel = (c: Counterparty) => COUNTERPARTY_LABEL[c];

/**
 * The order's whole conversation, newest first.
 *
 * Deliberately tolerant of missing timestamps: seeded fixtures and hand-entered
 * records do not all carry one, and a message with no date is still a message —
 * dropping it would make the thread quietly incomplete, which is worse than
 * showing it undated at the end.
 */
export function orderCorrespondence(b: OrderBundle): Correspondence[] {
  const out: Correspondence[] = [];

  // ── The supplier's shipping-document exchange ──────────────────────────
  const sd = b.shippingDocs;
  if (sd) {
    out.push({
      id: `sd-req-${b.id}`,
      at: sd.requestedAt ?? "",
      way: "OUT",
      with: "SUPPLIER",
      who: b.supplier.name,
      subject: `Shipping documents requested — ${sd.requested.join(", ")}`,
      body: sd.requestBody,
      source: "Shipping docs",
    });
    if (sd.status === "RECEIVED") {
      out.push({
        id: `sd-rep-${b.id}`,
        at: sd.receivedAt ?? "",
        way: "IN",
        with: "SUPPLIER",
        who: b.supplier.name,
        subject: "Shipping documents received",
        body: `${sd.pieces} pcs · ${sd.grossWeightKg} kg · ${sd.dimensions}. HS ${sd.hsCode ?? "—"}, declared ${sd.declaredValue ?? "—"} ${sd.declaredCurrency ?? ""}.`,
        attachments: sd.docs,
        source: "Shipping docs",
      });
    }
  }

  // ── The laboratory thread ──────────────────────────────────────────────
  for (const e of b.labEmails ?? []) {
    out.push({
      id: `lab-${e.id}`,
      at: e.at,
      way: e.direction === "OUT" ? "OUT" : "IN",
      with: "LAB",
      who: e.by,
      subject: e.lotCode ? `${e.subject} · ${e.lotCode}` : e.subject,
      body: e.body,
      attachments: e.attachments,
      source: "Testing",
    });
  }

  // ── The escrow agent's mailbox ─────────────────────────────────────────
  for (const e of b.escrow?.agentEmails ?? []) {
    out.push({
      id: `esc-${e.id}`,
      at: e.receivedAt,
      // The escrow model calls them SENT/RECEIVED; the thread calls everything
      // OUT/IN so three vocabularies do not meet on one screen.
      way: e.direction === "SENT" ? "OUT" : "IN",
      with: "ESCROW",
      who: e.direction === "SENT" ? (e.to ?? "Escrow agent") : e.from,
      subject: e.subject,
      body: e.snippet,
      attachments: e.attachmentFileName ? [e.attachmentFileName] : undefined,
      source: "Escrow",
    });
  }

  /*
   * Events that record something SAID rather than something done.
   *
   * The event log is mostly state changes — "advanced to CUSTOMS" is not
   * correspondence and would drown the thread. Only the notes a person wrote
   * are pulled in, and they are marked internal so nobody mistakes a file note
   * for something a counterparty was told.
   */
  for (const ev of b.events ?? []) {
    // Hand-written only. `addEvent` stamps SC_MANUAL; the seeded and
    // system-generated rows carry other sources and are state changes, not
    // things anybody said.
    if (!/manual/i.test(ev.source) || !ev.message?.trim()) continue;
    out.push({
      id: `ev-${ev.id}`,
      at: ev.occurredAt,
      way: "OUT",
      with: "INTERNAL",
      who: ev.recordedBy || "1Buy",
      subject: ev.eventType || "Note",
      body: ev.message,
      source: "Event",
    });
  }

  // Newest first; undated entries sort to the end rather than the top, where
  // they would look like the latest thing that happened.
  return out.sort((a, z) => (z.at || "").localeCompare(a.at || ""));
}

/** Counts for the filter chips, so nothing has to be opened to be sized. */
export function correspondenceCounts(items: Correspondence[]) {
  const by = (c: Counterparty) => items.filter((i) => i.with === c).length;
  return {
    all: items.length,
    supplier: by("SUPPLIER"),
    lab: by("LAB"),
    escrow: by("ESCROW"),
    client: by("CLIENT"),
    internal: by("INTERNAL"),
    out: items.filter((i) => i.way === "OUT").length,
    in: items.filter((i) => i.way === "IN").length,
  };
}
