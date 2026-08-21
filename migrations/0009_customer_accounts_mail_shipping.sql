alter table orders
  add column if not exists address_validation_provider text
    check (address_validation_provider in ('apicheck', 'google')),
  add column if not exists address_validation_status text not null
    default 'unvalidated'
    check (
      address_validation_status in (
        'unvalidated',
        'valid',
        'needs_confirmation',
        'invalid',
        'unavailable'
      )
    ),
  add column if not exists address_validation_fingerprint text,
  add column if not exists address_validated_at timestamptz;

alter table contact_messages
  add column if not exists idempotency_key text unique,
  add column if not exists idempotency_payload_hash text;

alter table contact_messages
  add constraint contact_messages_idempotency_key_format_check
    check (
      idempotency_key is null
      or idempotency_key ~ '^[A-Za-z0-9:_-]{16,200}$'
    ),
  add constraint contact_messages_idempotency_payload_hash_check
    check (
      idempotency_payload_hash is null
      or length(idempotency_payload_hash) = 64
    ),
  add constraint contact_messages_idempotency_pair_check
    check (
      (idempotency_key is null and idempotency_payload_hash is null)
      or
      (idempotency_key is not null and idempotency_payload_hash is not null)
    );

create table if not exists order_claim_tokens (
  id text primary key,
  user_id text not null references "user" ("id") on delete cascade,
  normalized_email_hash text not null check (length(normalized_email_hash) = 64),
  token_hash text unique not null check (length(token_hash) = 64),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > issued_at),
  check (consumed_at is null or consumed_at >= issued_at)
);

create index if not exists order_claim_tokens_user_expires_idx
  on order_claim_tokens (user_id, expires_at);
create index if not exists order_claim_tokens_expires_idx
  on order_claim_tokens (expires_at);

create table if not exists order_fulfillment_lines (
  id text primary key,
  order_id text not null references orders (id) on delete cascade,
  source_order_line_id text references order_lines (id) on delete set null,
  slug text not null,
  option_id text not null,
  name text not null,
  option_label text not null,
  qty integer not null check (qty between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, slug, option_id)
);

insert into order_fulfillment_lines (
  id,
  order_id,
  source_order_line_id,
  slug,
  option_id,
  name,
  option_label,
  qty,
  created_at,
  updated_at
)
select
  'fulfillment-' || id,
  order_id,
  id,
  slug,
  option_id,
  name,
  option_label,
  qty,
  now(),
  now()
from order_lines
on conflict (order_id, slug, option_id) do nothing;

create index if not exists order_fulfillment_lines_order_idx
  on order_fulfillment_lines (order_id);

create table if not exists order_shipments (
  id text primary key,
  order_id text not null references orders (id) on delete cascade,
  provider text not null default 'myparcel' check (provider = 'myparcel'),
  reference_identifier text unique not null,
  create_idempotency_key text unique not null,
  payload_hash text not null check (length(payload_hash) = 64),
  creation_status text not null default 'pending'
    check (creation_status in ('pending', 'created', 'ambiguous', 'failed')),
  creation_claim_token text,
  creation_claim_expires_at timestamptz,
  provider_shipment_id text unique,
  carrier_id integer,
  barcode text unique,
  tracking_url text,
  provider_status_code integer,
  tracking_status text not null default 'concept'
    check (
      tracking_status in (
        'concept',
        'registered',
        'handed_over',
        'in_transit',
        'delivered',
        'exception',
        'returned',
        'unknown'
      )
    ),
  label_status text not null default 'not_requested'
    check (label_status in ('not_requested', 'requested', 'ready', 'failed')),
  label_requested_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (creation_claim_token is null and creation_claim_expires_at is null)
    or
    (creation_claim_token is not null and creation_claim_expires_at is not null)
  )
);

create index if not exists order_shipments_order_idx
  on order_shipments (order_id, created_at desc);
create index if not exists order_shipments_tracking_idx
  on order_shipments (tracking_status, last_synced_at);

create table if not exists order_events (
  id text primary key,
  order_id text not null references orders (id) on delete cascade,
  event_type text not null
    check (
      event_type in (
        'order_created',
        'products_changed',
        'address_changed',
        'status_changed',
        'shipment_created',
        'shipment_tracking_changed'
      )
    ),
  dedupe_key text unique not null,
  actor_type text not null default 'system'
    check (actor_type in ('system', 'admin', 'customer')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_created_idx
  on order_events (order_id, created_at desc);

create table if not exists transactional_mail_outbox (
  id text primary key,
  dedupe_key text unique not null,
  kind text not null check (length(kind) between 1 and 80),
  recipient text not null,
  reply_to text,
  subject text not null,
  text_body text not null,
  html_body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text check (last_error is null or length(last_error) <= 500),
  provider_message_id text,
  contact_message_id text references contact_messages (id) on delete cascade,
  order_id text references orders (id) on delete cascade,
  order_event_id text references order_events (id) on delete cascade,
  user_id text references "user" ("id") on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and next_attempt_at is not null)
    or status in ('sending', 'sent', 'failed')
  )
);

create index if not exists transactional_mail_outbox_delivery_idx
  on transactional_mail_outbox (status, next_attempt_at, created_at);
create index if not exists transactional_mail_outbox_order_idx
  on transactional_mail_outbox (order_id, created_at);
create index if not exists transactional_mail_outbox_contact_idx
  on transactional_mail_outbox (contact_message_id, created_at);
