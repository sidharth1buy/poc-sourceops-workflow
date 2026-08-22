-- ============================================================================
--  sourceops — WHL testing domain schema (PostgreSQL 18)
--
--  Consolidated DDL for the twelve relational tables that hold lots, their
--  per-test trackers, their WHL reports, the lab's own fee, and the
--  notification trail. Equivalent to migrations/002_testing_domain.sql with
--  003_notification_attachments_nullable.sql folded in; this file is for
--  reading and sharing, the migrations directory is what actually runs.
--
--  Where it sits in the system
--  ---------------------------
--  The application's write path is a single JSONB snapshot row (app_state).
--  These tables are a READ MODEL projected out of that snapshot inside the
--  same request that saves it, and served to the UI by a Python/FastAPI read
--  API. Nothing writes to them directly yet.
--
--      store action -> app_state (JSONB) -> projectTesting() -> these tables
--                                                                    |
--                                              GET /api/py/... <-----+
--
--  Consequences visible in the DDL:
--    * `lots.order_id` is plain indexed text, not a foreign key. Orders live
--      in the snapshot; inventing a half-populated `orders` table to point at
--      would be worse than an honest loose reference.
--    * Timestamps that came from the domain are `text` (ISO-8601 strings
--      carried verbatim from the snapshot, so the projection round-trips
--      byte-identically). Only the bookkeeping columns on `lots` are
--      `timestamptz`.
--    * Every child table carries an explicit `position` column, because JSON
--      arrays are ordered and SQL rows are not.
-- ============================================================================


-- ---------------------------------------------------------------- lots
-- One physical batch of one MPN submitted for testing. Root of the domain:
-- every other table in this file cascades from it.

create table if not exists lots (
  id                      text primary key,
  order_id                text not null,        -- loose reference into the snapshot
  order_line_mpn          text not null,
  lot_code                text not null,
  date_code               text not null default '',
  qty                     integer not null default 0,
  sample_qty              integer not null default 0,
  -- the VERDICT: PENDING | PASS | FAIL | MAYBE. Drives escrow release.
  test_status             text not null default 'PENDING',
  lab                     text,
  work_order_no           text,
  report_no               text,                 -- denormalised "current report" for list views
  tat_days                integer,
  tested_at               text,
  client_po_no            text,
  -- the recorded LIFECYCLE position (a different axis from test_status). The
  -- DISPLAYED stage is max(recorded, derived-from-tests-and-reports) and is
  -- computed in the app, not here — storing only what was recorded keeps one
  -- source of truth.
  stage                   text,
  last_update_request_at  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists lots_order      on lots (order_id);
create index if not exists lots_work_order on lots (work_order_no);
create unique index if not exists lots_order_lot_code on lots (order_id, lot_code);

comment on table  lots             is 'One physical batch of one MPN submitted for testing.';
comment on column lots.test_status is 'The verdict. Drives escrow release/refund — do not repurpose.';
comment on column lots.stage       is 'RECORDED lifecycle stage; the displayed one is floored by tests/reports in the app.';


-- ---------------------------------------------------------------- per-test tracker
-- The required tests for a lot, inherited from the MPN's requirement list.

create table if not exists lot_tests (
  id              text primary key,
  lot_id          text not null references lots (id) on delete cascade,
  requirement_id  text,                              -- the MpnTestSpec entry it was inherited from
  name            text not null,
  standard        text,
  source          text not null default 'AUTO_PO',   -- AUTO_PO | MANUAL
  status          text not null default 'PENDING',   -- PENDING | IN_PROGRESS | PASSED | FAILED | NOT_CONDUCTED | FAR
  accept_qty      integer,
  reject_qty      integer,
  updated_at      text,
  -- preserves the order the tests were inherited in, so the tracker table
  -- doesn't reshuffle between reads
  position        integer not null default 0
);

create index if not exists lot_tests_lot on lot_tests (lot_id, position);


-- History, not just state: every status change (automated or manual) appends a row.
create table if not exists lot_test_history (
  id              text primary key,
  lot_test_id     text not null references lot_tests (id) on delete cascade,
  at              text not null,
  by_actor        text not null,   -- operator, or the automation ("WHL inbox (auto)")
  action          text not null,   -- AUTOFILL | ADD | DELETE | STATUS | REPORT | RECONCILE | EMAIL
  target          text,            -- test name / report no / lot code the row is about
  before_value    text,
  after_value     text,
  note            text,
  source_email_id text,            -- inbound mail that triggered an automated change
  position        integer not null default 0
);

create index if not exists lot_test_history_test on lot_test_history (lot_test_id, position);


-- ---------------------------------------------------------------- reports (all revisions)
-- WHL revises reports (352146.1, 352146.2 …). Every version is kept; exactly
-- one is current.

create table if not exists whl_reports (
  id                   text primary key,
  lot_id               text not null references lots (id) on delete cascade,
  report_no            text not null,        -- includes the revision, e.g. "352146.2"
  revision             integer not null,
  report_date          text not null,
  work_order_no        text not null,
  file_name            text not null,
  received_at          text not null,
  is_current           boolean not null default false,
  revision_note        text,
  part_number          text not null,
  manufacturer         text not null default '—',
  lot_qty              integer not null default 0,
  client               text not null default '',
  client_po            text not null default '',
  conclusion           text not null,        -- ACCEPTABLE | NOT_ACCEPTABLE | SUSPECT_COUNTERFEIT
  any_far              boolean not null default false,
  approved_by          text not null default '',
  approver_title       text not null default '',
  standards            text[] not null default '{}',
  risk_class           text,
  msl                  text,
  package_type         text,
  confidentiality_note text,
  parse_flags          text[] not null default '{}'   -- fields the parser could not read
);

create index if not exists whl_reports_lot on whl_reports (lot_id, revision desc);

-- "All report versions are kept; exactly one is current" is a domain
-- invariant, so it is a database constraint rather than a convention the app
-- is trusted to remember.
create unique index if not exists whl_reports_one_current
  on whl_reports (lot_id) where is_current;

create unique index if not exists whl_reports_lot_revision on whl_reports (lot_id, revision);


create table if not exists whl_report_processes (
  id          bigserial primary key,
  report_id   text not null references whl_reports (id) on delete cascade,
  name        text not null,
  result      text not null,   -- ACCEPTABLE | NOT_ACCEPTABLE | FAR | NOT_CONDUCTED
  accept_qty  integer,
  reject_qty  integer,
  note        text,
  position    integer not null default 0
);

create index if not exists whl_report_processes_report on whl_report_processes (report_id, position);


-- NDA requirement: every view/download of a report is logged.
create table if not exists whl_report_access_log (
  id         bigserial primary key,
  report_id  text not null references whl_reports (id) on delete cascade,
  at         text not null,
  by_actor   text not null,
  action     text not null,   -- VIEW | DOWNLOAD
  position   integer not null default 0
);

create index if not exists whl_report_access_report on whl_report_access_log (report_id, position);


-- ---------------------------------------------------------------- lifecycle history
-- Kept as a list rather than a single "current stage" so the UI can show WHEN
-- each step happened and WHAT moved it — an operator, or an inbound mail.

create table if not exists lot_stage_events (
  id              text primary key,
  lot_id          text not null references lots (id) on delete cascade,
  stage           text not null,   -- TEST_BOOKED | WHL_PAYMENT | SUPPLIER_DISPATCHING |
                                   -- COMPONENTS_RECEIVED | TESTING_IN_PROGRESS |
                                   -- TESTING_COMPLETED | REPORT_SHARED
  at              text not null,
  by_actor        text not null,   -- operator, "WHL inbox (auto)", "Supplier (relayed)"
  note            text,
  source_email_id text,            -- the mail that moved it, when one did
  manual          boolean not null default false,
  position        integer not null default 0
);

create index if not exists lot_stage_events_lot on lot_stage_events (lot_id, position);


-- ---------------------------------------------------------------- supplier → lab leg
-- At most one dispatch per lot, hence lot_id as the primary key.

create table if not exists lot_dispatch (
  lot_id            text primary key references lots (id) on delete cascade,
  courier           text,
  awb               text,
  dispatched_on     text,
  expected_arrival  text,
  note              text,
  recorded_by       text not null,
  recorded_at       text not null
);


-- ---------------------------------------------------------------- the lab's own fee
-- A third track, separate from both the lifecycle stage and the test verdict:
-- WHL bills for the testing itself.

create table if not exists lab_payments (
  lot_id               text primary key references lots (id) on delete cascade,
  -- NOT_REQUESTED | REQUESTED | INVOICE_RECEIVED | SENT_TO_FINANCE | PAID
  status               text not null default 'NOT_REQUESTED',
  requested_at         text,
  sent_to_finance_at   text,
  sent_to_finance_by   text,
  paid_at              text,
  paid_ref             text,
  note                 text
);


create table if not exists lab_invoices (
  id                text primary key,
  lot_id            text not null unique references lots (id) on delete cascade,
  invoice_no        text not null,
  amount            numeric(14,2) not null,
  tax_amount        numeric(14,2),
  currency          text not null default 'USD',
  file_name         text not null,
  received_at       text not null,
  due_date          text,
  note              text,
  -- ADVANCE gates the bench (the lab holds the lot until the fee clears);
  -- CREDIT does not. Read off the invoice mail, never chosen in the app.
  terms             text not null default 'CREDIT',
  credit_days       integer,
  rate_per_process  numeric(14,2),
  process_count     integer
);


create table if not exists lab_invoice_access_log (
  id          bigserial primary key,
  invoice_id  text not null references lab_invoices (id) on delete cascade,
  at          text not null,
  by_actor    text not null,
  action      text not null,
  position    integer not null default 0
);

create index if not exists lab_invoice_access_invoice on lab_invoice_access_log (invoice_id, position);


-- ---------------------------------------------------------------- who was told
-- Buyer and supplier mails stay masked from each other; this is the record of
-- what went to whom once a lot's result was in.

create table if not exists lot_notifications (
  id          text primary key,
  lot_id      text not null references lots (id) on delete cascade,
  party       text not null,   -- SUPPLIER | BUYER | ESCROW | WHL | FINANCE
  to_address  text not null,
  subject     text not null,
  body        text not null,
  -- nullable on purpose: NULL = the notification carried no attachments field,
  -- '{}' = it had an explicitly empty one. Collapsing the two broke
  -- byte-identical reproduction of the snapshot, which is the property that
  -- proves the projection changed nothing on screen.
  attachments text[],
  report_no   text,
  at          text not null,
  by_actor    text not null,
  status      text not null default 'SENT',   -- SENT | FAILED
  note        text,
  position    integer not null default 0
);

create index if not exists lot_notifications_lot on lot_notifications (lot_id, position);

comment on column lot_notifications.attachments is
  'NULL = the notification carried no attachments field; {} = explicitly empty.';
