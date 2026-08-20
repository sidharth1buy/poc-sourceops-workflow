"use client";

// THE TO-AND-FRO ON ONE ORDER, FOR THE LOGISTICS DESK ONLY.
//
// Real mail semantics, not a log: To / CC / BCC / Subject / Message, an AI
// drafter that reads THIS order's state (stage, date pressure, documents owed,
// dock discrepancies) and writes the mail for the chosen counterparty, and
// proper chains — every sent mail starts a thread, every email in a thread
// can be replied to, and the reply lands in that chain, not at the top of a
// flat pile.
//
// EVERY EMAIL IS FILED UNDER A CATEGORY (defaulting to its counterparty;
// Finance and Others exist for the mail that belongs elsewhere or nowhere),
// and ATTACHMENTS OPEN ON THE PAGE with the download inside the preview.
//
// Records and milestones (the booking, the waybill handover, the supplier
// document exchange, sent documents) appear in the same stream — they are
// correspondence too — but stand alone: nobody replies to a milestone.

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, FileText, Flag, Inbox, Paperclip, Reply, Sparkles, Tag } from "lucide-react";
import { useStore } from "@/store/store";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  categoryOf,
  groupChains,
  logisticsThreadItems,
  partiesOwingReply,
  THREAD_PARTY_LABEL,
  type EmailCategory,
  type MailChain,
  type ThreadItem,
} from "@/lib/logistics-thread";
import { aiDraftEmail, type LogisticsParty } from "@/integrations/logistics";
import { buildDraft } from "@/lib/email-drafter";
import type { OrderBundle } from "@/types";
import { Button, Pill } from "@/components/ui/primitives";
import { Input, Labeled, Select, Textarea } from "@/components/ui/form";
import { DocPreview } from "@/components/logistics/doc-preview";
import { mockDocContent } from "@/lib/download";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PARTIES: LogisticsParty[] = ["SUPPLIER", "CARRIER", "CHA", "WAREHOUSE", "CLIENT", "INSURER", "FINANCE"];

const splitAddresses = (v: string) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

export function LogisticsCommunication({ b }: { b: OrderBundle }) {
  const sendLogisticsMessage = useStore((s) => s.sendLogisticsMessage);
  const checkLogisticsInbox = useStore((s) => s.checkLogisticsInbox);
  const setCategory = useStore((s) => s.setLogisticsEmailCategory);

  const items = useMemo(() => logisticsThreadItems(b), [b]);
  const owing = useMemo(() => partiesOwingReply(b), [b]);

  /* Every item resolved to its file, once. */
  const filed = useMemo(
    () => new Map(items.map((i) => [i.id, categoryOf(i, b)] as const)),
    [items, b],
  );
  const counts = useMemo(() => {
    const c = new Map<EmailCategory, number>();
    for (const cat of filed.values()) c.set(cat, (c.get(cat) ?? 0) + 1);
    return c;
  }, [filed]);

  const [filter, setFilter] = useState<"ALL" | EmailCategory>("ALL");

  /* ── The composer — a real mail head, plus the drafter. ────────────────── */
  const [party, setParty] = useState<LogisticsParty>("CARRIER");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fileUnder, setFileUnder] = useState<"" | EmailCategory>("");
  const [drafting, setDrafting] = useState(false);

  /*
   * Chains are filtered by their emails' categories: a chain stays visible if
   * anything in it is filed under the active category.
   */
  const chains = useMemo(() => groupChains(items), [items]);
  const shown = filter === "ALL" ? chains : chains.filter((c) => c.emails.some((e) => filed.get(e.id) === filter));

  const draft = async () => {
    setDrafting(true);
    try {
      /* The intelligence is local (it reads the order); the adapter simulates
       * the model round-trip so it shows on the Integrations board. */
      const d = buildDraft(b, party);
      const res = await aiDraftEmail({ orderNo: b.orderNo, party, intent: d.intent, draft: { subject: d.subject, body: d.body } });
      setSubject(res.subject);
      setBody(res.body);
      toast.success("Draft ready", { description: `${d.intent} — read it over and edit before sending.` });
    } catch {
      toast.error("Drafter busy — try again");
    } finally {
      setDrafting(false);
    }
  };

  const send = () => {
    sendLogisticsMessage(b.id, {
      to: party,
      cc: splitAddresses(cc),
      bcc: splitAddresses(bcc),
      subject,
      body,
      category: fileUnder || undefined,
    });
    setSubject(""); setBody(""); setCc(""); setBcc(""); setFileUnder("");
  };

  return (
    <div className="space-y-3">
      {/* ── Write to somebody ─────────────────────────────────────────────── */}
      <div className="rounded-lg border p-3">
        <h4 className="mb-2 text-[13px] font-semibold">Write to a counterparty</h4>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr_1fr]">
          <Labeled label="To">
            <Select value={party} onChange={(e) => setParty(e.target.value as LogisticsParty)}>
              {PARTIES.map((p) => (
                <option key={p} value={p}>{THREAD_PARTY_LABEL[p]}</option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="CC" hint="comma-separated">
            <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="e.g. ops-lead@1buy.ai" />
          </Labeled>
          <Labeled label="BCC" hint="comma-separated">
            <Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="optional" />
          </Labeled>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
          <Labeled label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`e.g. ${b.orderNo} — pickup window tomorrow?`} />
          </Labeled>
          <Labeled label="File under" hint="category">
            <Select value={fileUnder} onChange={(e) => setFileUnder(e.target.value as "" | EmailCategory)}>
              <option value="">Same as recipient</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </Select>
          </Labeled>
        </div>
        <Labeled label="Message">
          <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Plain words — or let the drafter read the order and write it." />
        </Labeled>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* The drafter reads the order — stage, date pressure, what this
              counterparty still owes — and writes the most useful mail. */}
          <Button variant="outline" onClick={draft} disabled={drafting}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {drafting ? "Drafting…" : "Draft with AI"}
          </Button>
          <Button onClick={send} disabled={!subject.trim() || !body.trim()}>Send</Button>
          <Button variant="outline" onClick={() => checkLogisticsInbox(b.id)} disabled={owing.length === 0}
            title={owing.length === 0 ? "Nobody owes this thread a reply" : undefined}>
            <Inbox className="mr-1.5 h-3.5 w-3.5" />
            Check for replies
            {owing.length > 0 && <span className="ml-1.5 rounded-full bg-warn-bg px-1.5 text-[10px] font-semibold text-warn">{owing.length} owed</span>}
          </Button>
          {owing.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Waiting on: {owing.map((p) => THREAD_PARTY_LABEL[p]).join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* ── The files, as chips. ──────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="no-scrollbar flex flex-wrap gap-1.5">
          <Chip label="All" count={items.length} active={filter === "ALL"} onClick={() => setFilter("ALL")} />
          {CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
            <Chip key={c} label={CATEGORY_LABEL[c]} count={counts.get(c) ?? 0} active={filter === c} onClick={() => setFilter(filter === c ? "ALL" : c)} />
          ))}
        </div>
      )}

      {/* ── The conversations, newest activity first ──────────────────────── */}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "Nothing has been said on this order yet. Asking the supplier for documents, booking the carrier and sending a document all land here."
            : "Nothing is filed under that category."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((chain) => (
            <ChainCard key={chain.key} b={b} chain={chain} filed={filed} onCategory={(id, cat) => setCategory(b.id, id, cat)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── One conversation: root mail + everything chained on it ─────────────── */
function ChainCard({
  b, chain, filed, onCategory,
}: {
  b: OrderBundle;
  chain: MailChain;
  filed: Map<string, EmailCategory>;
  onCategory: (id: string, cat: EmailCategory) => void;
}) {
  const sendLogisticsMessage = useStore((s) => s.sendLogisticsMessage);
  const isChain = chain.emails.length > 1;
  /* Which email's reply composer is open, if any. */
  const [replyTo, setReplyTo] = useState<ThreadItem | null>(null);

  return (
    <li className={cn("rounded-lg border", isChain && "border-primary/30")}>
      {isChain && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Reply className="h-3 w-3" />
          <span className="font-medium text-foreground">{chain.root.subject}</span>
          <span>· {chain.emails.length} emails in this chain</span>
          <span className="ml-auto">{chain.lastAt}</span>
        </div>
      )}
      <ul>
        {chain.emails.map((e, i) => (
          <EmailRow
            key={e.id}
            e={e}
            orderNo={b.orderNo}
            indent={isChain && i > 0}
            last={i === chain.emails.length - 1}
            category={filed.get(e.id) ?? "OTHERS"}
            onCategory={(cat) => onCategory(e.id, cat)}
            onReply={e.replyable ? () => setReplyTo(replyTo?.id === e.id ? null : e) : undefined}
            replying={replyTo?.id === e.id}
          />
        ))}
      </ul>
      {replyTo && (
        <ReplyComposer
          b={b}
          replyTo={replyTo}
          threadId={chain.key}
          onSent={() => setReplyTo(null)}
          onCancel={() => setReplyTo(null)}
        />
      )}
    </li>
  );
}

/* ── One email ───────────────────────────────────────────────────────────── */
function EmailRow({
  e, orderNo, indent, last, category, onCategory, onReply, replying,
}: {
  e: ThreadItem;
  orderNo: string;
  indent: boolean;
  last: boolean;
  category: EmailCategory;
  onCategory: (cat: EmailCategory) => void;
  onReply?: () => void;
  replying?: boolean;
}) {
  const out = e.way === "OUT";
  const Arrow = out ? ArrowUpRight : ArrowDownLeft;
  const hasBody = Boolean(e.body?.trim());
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const contentFor = (name: string) =>
    mockDocContent(name.replace(/\.pdf$/i, ""), orderNo, {
      [out ? "Sent to" : "Received from"]: e.who,
      Date: e.at || "undated",
      Subject: e.subject,
    }, e.body);

  return (
    <li className={cn(!last && "border-b", indent && "pl-6")}>
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
        className={cn("flex w-full flex-wrap items-center gap-x-2 gap-y-1 p-2.5 text-left text-sm", hasBody && "hover:bg-muted")}
      >
        <Arrow className={cn("h-3.5 w-3.5 shrink-0", out ? "text-muted-foreground" : "text-primary")} />
        <Pill tone={out ? "neutral" : "info"}>{THREAD_PARTY_LABEL[e.with]}</Pill>
        {e.kind === "DOCUMENT" && <Pill tone="info"><FileText className="mr-1 inline h-3 w-3" />document</Pill>}
        {e.kind === "MILESTONE" && <Pill tone="ok"><Flag className="mr-1 inline h-3 w-3" />milestone</Pill>}
        <span className="min-w-0 flex-1 truncate font-medium">{e.subject}</span>
        {e.attachments?.length ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="h-3 w-3" />
            {e.attachments.length}
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">{e.at || "undated"}</span>
      </button>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pb-1.5 text-[11px] text-muted-foreground">
        <span>{out ? "to" : "from"} <b className="text-foreground">{e.who}</b></span>
        {e.cc?.length ? <span>· cc {e.cc.join(", ")}</span> : null}
        {e.bcc?.length ? <span>· bcc {e.bcc.join(", ")}</span> : null}
        {e.attachments?.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setPreview(preview === a ? null : a)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium hover:bg-muted",
              preview === a ? "border-primary bg-accent-soft text-primary" : "bg-card text-primary",
            )}
            title="Preview this document"
          >
            <Paperclip className="h-3 w-3" />
            {a}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-2">
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium hover:bg-muted",
                replying ? "border-primary bg-accent-soft text-primary" : "bg-card text-primary",
              )}
            >
              <Reply className="h-3 w-3" />
              {replying ? "Cancel reply" : "Reply"}
            </button>
          )}
          <span className="inline-flex items-center gap-1">
            <Tag className="h-3 w-3" />
            <span>filed under</span>
            <select
              value={category}
              onChange={(ev) => onCategory(ev.target.value as EmailCategory)}
              className="rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-medium text-foreground"
            >
              {CATEGORY_ORDER.map((cat) => (
                <option key={cat} value={cat}>{CATEGORY_LABEL[cat]}</option>
              ))}
            </select>
          </span>
        </span>
      </div>

      {preview && (
        <div className="px-2.5 pb-2.5">
          <DocPreview title={preview} content={contentFor(preview)} onClose={() => setPreview(null)} />
        </div>
      )}

      {open && hasBody && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t bg-muted/30 p-2.5 text-[11px] leading-relaxed">{e.body}</pre>
      )}
    </li>
  );
}

/* ── Replying to one specific email, inside its chain ────────────────────── */
function ReplyComposer({
  b, replyTo, threadId, onSent, onCancel,
}: {
  b: OrderBundle;
  replyTo: ThreadItem;
  threadId: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const sendLogisticsMessage = useStore((s) => s.sendLogisticsMessage);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(replyTo.subject.startsWith("Re: ") ? replyTo.subject : `Re: ${replyTo.subject}`);
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);

  const draft = async () => {
    setDrafting(true);
    try {
      const d = buildDraft(b, replyTo.with, { subject: replyTo.subject, body: replyTo.body, who: replyTo.who });
      const res = await aiDraftEmail({ orderNo: b.orderNo, party: replyTo.with, intent: d.intent, draft: { subject: d.subject, body: d.body } });
      setSubject(res.subject);
      setBody(res.body);
      toast.success("Reply drafted", { description: "Read it over and edit before sending." });
    } catch {
      toast.error("Drafter busy — try again");
    } finally {
      setDrafting(false);
    }
  };

  const send = () => {
    sendLogisticsMessage(b.id, {
      to: replyTo.with,
      cc: splitAddresses(cc),
      bcc: splitAddresses(bcc),
      subject,
      body,
      threadId,
    });
    onSent();
  };

  return (
    <div className="border-t bg-muted/20 p-2.5">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Replying to <b className="text-foreground">{replyTo.who}</b> — this lands in the same chain.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Labeled label="CC" hint="comma-separated"><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional" /></Labeled>
        <Labeled label="BCC" hint="comma-separated"><Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="optional" /></Labeled>
      </div>
      <Labeled label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Labeled>
      <Labeled label="Message">
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the reply — or draft it from the order's context." />
      </Labeled>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="outline" onClick={draft} disabled={drafting}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {drafting ? "Drafting…" : "Draft with AI"}
        </Button>
        <Button onClick={send} disabled={!subject.trim() || !body.trim()}>Send reply</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
        active ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
      <Pill tone="neutral">{count}</Pill>
    </button>
  );
}
