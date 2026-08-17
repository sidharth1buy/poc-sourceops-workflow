# RULES.md — Project Rules & Conventions

Coding standards, patterns, and DO/DON'Ts for poc-sourceops-workflow.

## Golden Rule

**This is an internal POC.** Prioritize:
1. **Clarity** — code is read 10x more than written
2. **Simplicity** — no premature abstraction
3. **Speed** — ship quick feedback loops to the user

Avoid: heavy architectural patterns, complex generics, extensive test coverage (manual testing is fine for POC).

---

## TypeScript & Code Style

### Type Safety
- **strict mode on** — catch bugs early
- **No `any`** unless unavoidable (external API dumps)
- **Prefer `unknown`** over `any` for untyped data
- **Types centralized** in `src/types/index.ts` (not scattered per-domain)

### Naming
- **Files:** `kebab-case.tsx` / `kebab-case.ts`
- **Components:** `PascalCase` (e.g., `OrderWorkspace`)
- **Hooks:** `use-kebab-case` or `useCamelCase` (both exist, pick one per file)
- **Types:** singular, descriptive (e.g., `OrderBundle`, not `OrderDto` or `IOrder`)
- **Constants:** `SCREAMING_SNAKE_CASE` (e.g., `DEFAULT_CURRENCY`)
- **Private/internal:** prefix with `_` (e.g., `_computeGateReason`)

### Formatting
- **Prettier:** single quotes, 2-space indent, LF endings, no trailing commas
- **Line length:** 100 chars soft limit (not hard); readable is more important than exactly 80
- **Imports:** alphabetized within groups (stdlib, npm, relative)

### Comments
- **No obvious comments** — code should be self-documenting
- **"Why" comments only** — if the reason isn't obvious from the code
- **Examples:**
  ❌ `// set the name`  
  ✅ `// persist optimistic state before async, so UI doesn't flicker`

---

## Zustand Store Patterns

### Actions (Mutations)
```ts
// ✅ DO: Use immer for immutable updates
createOrder: (spo: SupplierPO) => set((s) => {
  const bundle = scaffold(spo);
  s.orders[bundle.id] = bundle;
})

// ❌ DON'T: Manual immutable assignment (verbose)
createOrder: (spo) => set((s) => ({
  ...s,
  orders: { ...s.orders, [id]: bundle }
}))

// ❌ DON'T: Mutate without immer
createOrder: (spo) => set((s) => {
  s.orders[id] = bundle;  // no immer = mutation
  return s;
})
```

### Guards (Pre-action Checks)
```ts
// ✅ DO: Guard early, return null (no-op) if blocked
advanceStep: (orderId, phase) => set((s) => {
  const b = s.orders[orderId];
  const reason = gateReason(b, b.journey.find(j => j.phase === phase)!);
  if (reason) {
    toast.error(`Can't advance: ${reason}`);
    return; // no-op
  }
  // proceed with mutation
})

// ❌ DON'T: Mutate first, then check (leaves bad state)
advanceStep: (orderId, phase) => set((s) => {
  const b = s.orders[orderId];
  b.journey.find(...)!.status = "DONE"; // premature
  if (!isAllowed(...)) return; // too late
})
```

### Async Actions (Integrations)
```ts
// ✅ DO: Optimistic update + async resolve + rollback on error
fundEscrow: (orderId, amount, banking) => set((s) => {
  const b = s.orders[orderId];
  b.escrow!.status = "FUNDED"; // optimistic
}),
// Then in a separate effect/action:
callHkinFund(orderId).then(result => {
  set((s) => {
    s.orders[orderId].escrow!.events.push({
      type: "FUND",
      amount: result.materialAmount,
      ...
    });
  });
  logIntegrationCall(...)
}).catch(err => {
  set((s) => {
    s.orders[orderId].escrow!.status = "OPEN"; // rollback
  });
  toast.error(`Fund failed: ${err.message}`);
});
```

### Selectors (Pure Functions)
```ts
// ✅ DO: Pure functions, no side effects, accept state as argument
export const escrowRemaining = (b: OrderBundle) =>
  Math.max(0, (b.escrow?.materialAmount ?? 0) - escrowReleased(b) - escrowRefunded(b));

// ❌ DON'T: Hooks or side effects in selectors
export const escrowRemaining = (b: OrderBundle) => {
  const store = useStore(); // ❌ Can't use hooks
  return ...;
}
```

---

## React Patterns

### Components
```ts
// ✅ DO: 'use client' for interactive components
'use client';
import { useState } from 'react';

export function OrderWorkspace({ order }: Props) {
  const [tab, setTab] = useState<Tab>('Overview');
  // ...
}

// ✅ DO: Server Components for pages (no 'use client')
export default function OrdersPage() {
  const orders = await fetchOrders(); // server-side
  return <OrdersList orders={orders} />;
}

// ❌ DON'T: Mix client/server in one component
export default function Page() {
  'use client'; // contradicts being a page
  const [state, setState] = useState(...);
}
```

### Props & Composition
```ts
// ✅ DO: Props are explicit, typed
interface OrderWorkspaceProps {
  orderId: string;
  onClose?: () => void;
  persona: Persona;
}

export function OrderWorkspace({ orderId, onClose, persona }: OrderWorkspaceProps) { }

// ❌ DON'T: Prop spreading for everything
export function OrderWorkspace(props) {
  const { ...rest } = props; // vague
}

// ❌ DON'T: Optional children when not needed
interface Props { children?: React.ReactNode }
// children is only for layouts/wrappers, not data containers
```

### Hooks
```ts
// ✅ DO: Custom hooks for shared logic
export function useEscrowRemaining(orderId: string) {
  const b = useStore(s => s.orders[orderId]);
  return escrowRemaining(b);
}

// ❌ DON'T: useEffect with exhaustive-deps lint rule violations
useEffect(() => {
  doSomething(b); // b is a dependency but not in the array
}, []); // ❌ stale closure

// ✅ DO: Dependency array correct, or refactor to avoid
useEffect(() => {
  doSomething(b);
}, [b]); // ✅ explicit dependency
```

---

## Form Patterns (plain controlled state — no form library)

This project has no `react-hook-form`/Zod/any form library. Forms are plain `useState` + manual validation, matching the rest of the hand-rolled convention.

```ts
// ✅ DO: controlled state + inline validation before calling the store action
export function CreateSupplierPoForm() {
  const [supplier, setSupplier] = useState('');
  const [poNo, setPoNo] = useState('');
  const [lines, setLines] = useState<{ mpn: string; qty: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplier.trim()) return setError('Supplier required');
    if (!poNo.trim()) return setError('PO# required');
    useStore.getState().createSupplierPo({ supplier, poNo, lines });
  }
  return <form onSubmit={handleSubmit}>{/* form fields, use Select for supplier — see below */}</form>;
}

// ✅ DO: dropdown from the directory for any buyer/supplier name field — never free text
import { SUPPLIERS } from '@/data/directory';
<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
  {SUPPLIERS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
</select>

// EXCEPTION — client-pos/new & supplier-pos/new: no directory dropdown for the
// party name. It's a plain text input, prefilled by parse() like every other
// field on those forms (see Key Patterns in CLAUDE.md).
const [supplier, setSupplier] = useState('');
<Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Upload a PO to auto-fill, or type the supplier's name" />
```

---

## Data Table Patterns

There is no TanStack Table. Use the hand-rolled `DataTable` in `src/components/ui/primitives.tsx`.

```ts
// ✅ DO: hand-rolled DataTable + Col<T> definitions
import { DataTable, type Col } from '@/components/ui/primitives';

const cols: Col<Order>[] = [
  { key: 'orderNo', header: 'Order #', render: (o) => <span className="font-mono">{o.orderNo}</span> },
  { key: 'status', header: 'Status', render: (o) => <StatusPill status={o.status} /> },
];

export function OrdersList({ orders }: { orders: Order[] }) {
  return <DataTable columns={cols} rows={orders} empty="No orders yet." />;
}

// ❌ DON'T: map() with index as key
orders.map((order, idx) => <div key={idx}>...</div>) // bad: keys should be stable IDs (order.id)
```

---

## Modal & Sheet Patterns

Modals are hand-rolled (`Dialog` in `src/components/ui/primitives.tsx` — NOT Radix, no `DialogContent`/`onOpenChange`). The **parent** owns visibility by conditionally rendering the modal at all (a `modal: ModalKey | null` state + `{modal === "fund" && <FundEscrowModal onClose={close} />}`); the modal itself takes `onClose` and calls it after a successful save.

```ts
// ✅ DO: parent conditionally mounts, modal just takes onClose
type ModalKey = null | "fund" | "addLot" /* ... */;
const [modal, setModal] = useState<ModalKey>(null);
const close = () => setModal(null);
// ...
{modal === "fund" && <FundEscrowModal orderId={id} onClose={close} />}

export function FundEscrowModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [amount, setAmount] = useState(0);
  const save = () => { useStore.getState().sendEscrowEmail(orderId, "PAYMENT_INSTRUCTION_TO_FINANCE", draft); onClose(); };
  return (
    <Dialog open onClose={onClose} title="Fund escrow" footer={<Footer onClose={onClose} onSave={save} saveLabel="Send" />}>
      {/* fields */}
    </Dialog>
  );
}

// ❌ DON'T: modal owning its own open/visible state — the parent must control mount/unmount
export function FundEscrowModal({ orderId }: Props) {
  const [open, setOpen] = useState(false); // uncoordinated with the button that should open it
}
```

---

## Styling & Tailwind

```ts
// ✅ DO: Semantic classNames, use tailwind v4 utilities
export function OrderCard({ order }: Props) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold">{order.orderNo}</h2>
      <p className="text-sm text-muted-foreground">{order.status}</p>
    </div>
  );
}

// ✅ DO: Use cn() for conditional classes
import { cn } from '@/lib/utils';

<div className={cn(
  "p-4 rounded",
  isFunded ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"
)}>
  {status}
</div>

// ❌ DON'T: Hard-coded colors (use theme vars)
<div style={{ backgroundColor: '#f0f0f0' }}>

// ❌ DON'T: Inline styles (use Tailwind)
<div style={{ padding: '1rem' }}>
```

---

## Integration Patterns (Mock APIs)

The call log is its own store — `src/store/integration-log-store.ts` (`useIntegrationLog`) — separate from the main app store. Every adapter routes through `mockCall()` (`src/integrations/mock-client.ts`), which logs begin/end itself; **never log a call manually** from a component or store action.

```ts
// ✅ DO: route every adapter call through mockCall — it logs to useIntegrationLog itself
import { mockCall } from '@/integrations/mock-client';

export async function escrowAgentFetchInvoice(req: { orderRef: string; invoiceNo: string; /* ... */ }) {
  return mockCall(
    'ESCROW_AGENT', 'Escrow Agent', 'fetchInvoice', req,
    () => ({ invoice: { /* ... */ }, email: { /* ... */ } }),
    { latencyMs: [800, 2000], failRate: 0.05 },
  );
}

// ❌ DON'T: hand-roll latency/logging in a component or store action
await new Promise(r => setTimeout(r, 1000)); // bypasses the call log and the chaos toggle
set((s) => { s.someLog.push({ timestamp: new Date(), ... }); }); // there is no manual log array to push to
```

---

## DO List

✅ **DO** — guardrails to enforce:

1. **Store actions first** — before adding UI, make sure the store action works
2. **Selector-driven rendering** — compute derived state once (selector), not in components
3. **Type-driven development** — define types first, then implement
4. **Exhaustive gates** — every phase advance checks `gateReason()`
5. **Test with Integrations board open** — watch mock API calls in real-time
6. **Reset demo often** — keep a clean workflow repeatable
7. **Commit message discipline** — "feat/fix/refactor: short description"
8. **No auto-commits** — stage and commit manually (user preference)
9. **Keep localStorage simple** — avoid deeply nested updates
10. **Optimize for legibility** — variable names that explain themselves

---

## DON'T List

❌ **DON'T** — anti-patterns to avoid:

1. **Don't mutate without immer** — always use `set((s) => { ... })` with immer
2. **Don't use `any` for new code** — catch bugs with types
3. **Don't nest modals deeply** — max 2 layers (modal inside modal is OK, but 3+ is confusing)
4. **Don't fetch in components** — use store actions or React Query
5. **Don't repeat selectors** — if you wrote a selector once, reuse it
6. **Don't hardcode values** — use constants or enums
7. **Don't skip gate checks** — manually bypass guards = data corruption later
8. **Don't over-generalize** — one pattern wins; two similar things can stay similar without a generic wrapper
9. **Don't create "manager" classes** — use store actions instead
10. **Don't console.log in production** — use integration log + Integrations board

---

## Error Handling

```ts
// ✅ DO: Validate at system boundaries (store actions, not deep in components)
fundEscrow: (orderId, amount, banking) => set((s) => {
  if (amount <= 0) {
    toast.error("Amount must be > 0");
    return;
  }
  const b = s.orders[orderId];
  if (!b.escrow) {
    toast.error("No escrow on this order");
    return;
  }
  // proceed
})

// ❌ DON'T: Distribute validation across components
<FundModal onSubmit={(amount) => {
  if (amount <= 0) return; // in component, easy to miss
  store.fundEscrow(amount);
}} />
```

---

## File Organization

```
src/
├── app/                   # Route handlers + pages
├── components/            # Reusable React components
│   ├── ui/               # Shadcn/Radix primitives (don't edit, shadcn add adds here)
│   ├── layout/           # App shell (sidebar, header)
│   ├── order/            # Order-specific (order-workspace.tsx, modals.tsx)
│   └── error-boundary.tsx
├── store/                # Zustand (single store.ts + selectors.ts + integration-log.ts)
├── integrations/         # Mock adapters (escrow-hkin.ts, customs-icegate.ts, etc.)
├── lib/                  # Utils (utils.ts, fx.ts, etc.)
├── data/                 # Constants & fixtures (enums.ts, fixtures.ts)
├── types/                # Central types (index.ts only, no per-domain scattering)
└── constants/            # API endpoints, etc.
```

---

## Git & Commits

- **No auto-commits** — user stages/commits manually
- **Conventional Commits** (for future):
  ```
  feat: add escrow extension request modal
  fix: prevent double-release by re-deriving cap at commit
  refactor: move allocation logic to selectors
  ```
- **Atomic commits** — one logical change per commit (not 10 files in one commit)
- **Rebase, don't merge** — when pulling upstream changes (clean history)

---

## Testing (POC)

- **No unit tests** configured (manual is fine for POC)
- **Manual E2E via UI** — use "Reset demo" + Integrations board
- **Smoke tests:** Check that:
  1. Dashboard loads (no errors)
  2. Create Client PO works
  3. Create Supplier PO works
  4. Create Order from Supplier PO works
  5. Fund escrow works
  6. Release escrow works (after PASS lot)
  7. Integrations log is populated

---

## Performance Notes

- **Selectors are memoized** — no re-render if state didn't change
- **localStorage is <1MB** — no issue with seed data
- **DataTables virtualize** — even 10k rows render fine
- **Modals are lazy** — don't render until open

Avoid:
- **500-line files** — break into smaller modules
- **Deep nesting** — max 3-4 levels of component hierarchy
- **Frequent recompute selectors** — cache if used in loops

---

## Security (POC)

⚠️  **This POC has NO security:**
- No auth (mock user)
- No RBAC (all personas see all)
- No validation (forms accept anything)
- No encryption (localStorage plaintext)

For production:
- Add JWT auth + refresh tokens
- Implement RBAC in store guards
- Zod validation on all inputs
- HTTPS + secure cookies
- Content Security Policy headers

---

## Documentation

- **Code comments** — rare, "why" only
- **Type annotations** — the best documentation (explicit types explain intent)
- **Function naming** — `canReleaseEscrow()` is better than `checkCondition()`
- **README.md** — update if adding a major feature
- **This file (RULES.md)** — the source of truth for conventions

---

## Review Checklist

Before submitting a PR (if this becomes multi-person):

- [ ] No `any` without comment
- [ ] No mutations outside immer
- [ ] Gate checks in store actions
- [ ] Types in `src/types/index.ts`
- [ ] Selectors used for derived state
- [ ] No console.log left behind
- [ ] Prettier + ESLint pass
- [ ] Manual E2E: reset demo + smoke tests pass
- [ ] Integration calls logged + visible on board
