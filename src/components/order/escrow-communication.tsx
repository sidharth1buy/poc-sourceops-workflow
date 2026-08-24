"use client";

// EVERYTHING SAID ON ONE ESCROW ORDER, AS ONE CONVERSATION.
//
// Built to replicate the Logistics Communication tab exactly: a real mail head
// (To / CC / BCC / Subject / File-under / Message), an AI drafter that reads
// THIS escrow order's state, proper chains where every email can be replied to
// in place, category filing with multi-select, and attachments that preview on
// the page rather than downloading.
//
// It replaced a flat six-column table of `agentEmails`, which showed the same
// facts but answered none of the questions a desk actually has: whose move is
// it, what belongs together, and how do I answer this one.
//
// AD-HOC MAIL NEVER MOVES THE ESCROW STATE. Everything that advances the eight
// states still goes through the Action tab's own send/receive flow; this tab is
// the record plus a way to nudge people. That separation is deliberate — a
// free-text mail must not be able to fake a funding confirmation.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Inbox, Paperclip, Reply, Sparkles, Tag } from "lucide-react";
import { useStore } from "@/store/store";
import {
  ESCROW_CATEGORY_LABEL,
  ESCROW_CATEGORY_ORDER,
  ESCROW_PARTY_LABEL,
  escrowCategoriesOf,
  escrowPartiesOwingReply,
  escrowThreadItems,
  groupEscrowChains,
  inferEscrowParty,
  type EscrowCategory,
  type EscrowMailChain,
  type EscrowThreadItem,
} from "@/lib/escrow-thread";
import { buildEscrowDraft } from "@/lib/escrow-drafter";
import type { OrderBundle } from "@/types";
import { Button, Panel, Pill } from "@/components/ui/primitives";
import { Input, Labeled, Textarea } from "@/components/ui/form";
import { DocPreview } from "@/components/logistics/doc-preview";
import { mockDocContent } from "@/lib/download";
import { cn } from "@/lib/utils";

export function EscrowCommunication({ b }: { b: OrderBundle }) {
  const sendEscrowMessage = useStore((s) => s.sendEscrowMessage);
  const checkEscrowReplies = useStore((s) => s.checkEscrowReplies);
  const setCategories = useStore((s) => s.setEscrowEmailCategories);

  const items = useMemo(() => escrowThreadItems(b), [b]);
  const owing = useMemo(() => escrowPartiesOwingReply(b), [b]);

  const filed = useMemo(
    () => new Map(items.map((i) => [i.id, escrowCategoriesOf(i, b)] as const)),
    [items, b],
  );
  const counts = useMemo(() => {
    const c = new Map<EscrowCategory, number>();
    for (const cats of filed.values()) for (const cat of cats) c.set(cat, (c.get(cat) ?? 0) + 1);
    return c;
  }, [filed]);

  const [filter, setFilter] = useState<"ALL" | EscrowCategory>("ALL");
  const [toEmail, setToEmail] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fileUnder, setFileUnder] = useState<EscrowCategory[]>([]);
  const [drafting, setDrafting] = useState(false);
  const toggleFile = (c: EscrowCategory) => setFileUnder((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]));

  const chains = useMemo(() => groupEscrowChains(items), [items]);
  const shown = filter === "ALL" ? chains : chains.filter((c) => c.emails.some((e) => (filed.get(e.id) ?? []).includes(filter)));

  const draft = () => {
    if (!toEmail.trim()) { toast.error("Type the address first — the drafter writes for whoever it is to"); return; }
    setDrafting(true);
    /* Local derivation, then a short beat so it reads as work being done —
     * the escrow adapters are mocks too, so nothing here pretends otherwise. */
    setTimeout(() => {
      const d = buildEscrowDraft(b, inferEscrowParty(b.escrow!, toEmail));
      setSubject(d.subject);
      setBody(d.body);
      setDrafting(false);
      toast.success("Draft ready", { description: `${d.intent} — read it over and edit before sending.` });
    }, 500);
  };

  const send = () => {
    sendEscrowMessage(b.id, {
      toEmail, subject, body, cc, bcc,
      categories: fileUnder.length ? fileUnder : undefined,
    });
    setSubject(""); setBody(""); setCc(""); setBcc(""); setFileUnder([]); setToEmail("");
  };

  return (
    <Panel title="Communication — every message sent or received on this order">
      <div className="space-y-3">
        {/* ── Write to somebody ─────────────────────────────────────────── */}
        <div className="rounded-lg border p-3">
          <h4 className="mb-2 text-[13px] font-semibold">Write to a counterparty</h4>
          <div className="grid gap-2 sm:grid-cols-3">
            <Labeled label="To" hint="type the email address">
              <Input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="name@company.com" />
            </Labeled>
            <Labeled label="CC" hint="comma-separated">
              <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="e.g. ops-lead@1buy.ai" />
            </Labeled>
            <Labeled label="BCC" hint="comma-separated">
              <Input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="optional" />
            </Labeled>
          </div>
          <Labeled label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`e.g. ${b.orderNo} — release instruction`} />
          </Labeled>
          {/* Tick every filter this mail should appear in — one email, many files. */}
          <div className="mb-1 mt-2">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">File under — tick all that apply (none = filed by who it&rsquo;s to)</span>
            <div className="flex flex-wrap gap-1.5">
              {ESCROW_CATEGORY_ORDER.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleFile(c)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    fileUnder.includes(c) ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {fileUnder.includes(c) ? "✓ " : ""}{ESCROW_CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <Labeled label="Message">
            <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Plain words — or let the drafter read the order and write it." />
          </Labeled>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={draft} disabled={drafting}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {drafting ? "Drafting…" : "Draft with AI"}
            </Button>
            <Button onClick={send} disabled={!subject.trim() || !body.trim()}>Send</Button>
            <Button variant="outline" onClick={() => checkEscrowReplies(b.id)} disabled={owing.length === 0}
              title={owing.length === 0 ? "Nobody owes this thread a reply" : undefined}>
              <Inbox className="mr-1.5 h-3.5 w-3.5" />
              Check for replies
              {owing.length > 0 && <span className="ml-1.5 rounded-full bg-warn-bg px-1.5 text-[10px] font-semibold text-warn">{owing.length} owed</span>}
            </Button>
            {owing.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                Waiting on: {owing.map((p) => ESCROW_PARTY_LABEL[p]).join(", ")}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Mail sent here is a record and a nudge — it never moves the escrow state. The steps that
            do live on the <b className="text-foreground">Action</b> tab.
          </p>
        </div>

        {/* ── The files, as chips ───────────────────────────────────────── */}
        {items.length > 0 && (
          <div className="no-scrollbar flex flex-wrap gap-1.5">
            <Chip label="All" count={items.length} active={filter === "ALL"} onClick={() => setFilter("ALL")} />
            {ESCROW_CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
              <Chip key={c} label={ESCROW_CATEGORY_LABEL[c]} count={counts.get(c) ?? 0} active={filter === c} onClick={() => setFilter(filter === c ? "ALL" : c)} />
            ))}
          </div>
        )}

        {/* ── The conversations, newest activity first ──────────────────── */}
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "Nothing has been said on this order yet. Sending the order to the seller, instructing Finance and every HKin notice all land here."
              : "Nothing is filed under that category."}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((chain) => (
              <ChainCard key={chain.key} b={b} chain={chain} filed={filed} onCategories={(id, cats) => setCategories(b.id, id, cats)} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/* ── One conversation: root mail + everything chained on it ─────────────── */
function ChainCard({
  b, chain, filed, onCategories,
}: {
  b: OrderBundle;
  chain: EscrowMailChain;
  filed: Map<string, EscrowCategory[]>;
  onCategories: (id: string, cats: EscrowCategory[]) => void;
}) {
  const isChain = chain.emails.length > 1;
  const [replyTo, setReplyTo] = useState<EscrowThreadItem | null>(null);

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
            categories={filed.get(e.id) ?? ["OTHERS"]}
            onCategories={(cats) => onCategories(e.id, cats)}
            onReply={() => setReplyTo(replyTo?.id === e.id ? null : e)}
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
  e, orderNo, indent, last, categories, onCategories, onReply, replying,
}: {
  e: EscrowThreadItem;
  orderNo: string;
  indent: boolean;
  last: boolean;
  categories: EscrowCategory[];
  onCategories: (cats: EscrowCategory[]) => void;
  onReply: () => void;
  replying: boolean;
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
        <Pill tone={out ? "neutral" : "info"}>{ESCROW_PARTY_LABEL[e.with]}</Pill>
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
        {e.cc ? <span>· cc {e.cc}</span> : null}
        {e.bcc ? <span>· bcc {e.bcc}</span> : null}
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
        </span>
      </div>

      {/* The filing — tick every filter this email should appear in. */}
      <div className="flex flex-wrap items-center gap-1 px-2.5 pb-1.5 text-[11px] text-muted-foreground">
        <Tag className="h-3 w-3" />
        <span className="mr-0.5">filed under</span>
        {ESCROW_CATEGORY_ORDER.map((cat) => {
          const on = categories.includes(cat);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onCategories(on ? categories.filter((x) => x !== cat) : [...categories.filter((x) => x !== "OTHERS" || cat === "OTHERS"), cat])}
              className={cn(
                "rounded-full border px-2 py-0.5 font-medium transition",
                on ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {on ? "✓ " : ""}{ESCROW_CATEGORY_LABEL[cat]}
            </button>
          );
        })}
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
  replyTo: EscrowThreadItem;
  threadId: string;
  onSent: () => void;
  onCancel: () => void;
}) {
  const sendEscrowMessage = useStore((s) => s.sendEscrowMessage);
  const [toEmail, setToEmail] = useState(replyTo.who);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(replyTo.subject.startsWith("Re: ") ? replyTo.subject : `Re: ${replyTo.subject}`);
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);

  const draft = () => {
    setDrafting(true);
    setTimeout(() => {
      const d = buildEscrowDraft(b, replyTo.with, { subject: replyTo.subject, body: replyTo.body, who: replyTo.who });
      setSubject(d.subject);
      setBody(d.body);
      setDrafting(false);
      toast.success("Reply drafted", { description: "Read it over and edit before sending." });
    }, 500);
  };

  return (
    <div className="border-t bg-muted/20 p-2.5">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Replying to <b className="text-foreground">{replyTo.who}</b> — this lands in the same chain.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Labeled label="To (email)" hint="editable"><Input value={toEmail} onChange={(e) => setToEmail(e.target.value)} /></Labeled>
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
        <Button onClick={() => { sendEscrowMessage(b.id, { toEmail, subject, body, cc, bcc, threadId }); onSent(); }}
          disabled={!subject.trim() || !body.trim()}>Send reply</Button>
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
