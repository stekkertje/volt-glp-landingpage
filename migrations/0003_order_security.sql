alter table orders
  add column if not exists idempotency_payload_hash text,
  add column if not exists idempotency_viewer_hash text;

create table if not exists order_access_tokens (
  id text primary key,
  order_id text not null references orders (id) on delete cascade,
  token_hash text unique not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > issued_at)
);

insert into order_access_tokens (
  id,
  order_id,
  token_hash,
  issued_at,
  expires_at,
  revoked_at
)
select
  'legacy-' || id,
  id,
  guest_access_token_hash,
  created_at,
  created_at + interval '72 hours',
  null
from orders
where guest_access_token_hash is not null
on conflict (id) do nothing;

update orders
set guest_access_token_hash = null
where guest_access_token_hash is not null;

create index if not exists order_access_tokens_order_id_idx
  on order_access_tokens (order_id);
create index if not exists order_access_tokens_expires_at_idx
  on order_access_tokens (expires_at);

create table if not exists rate_limit_buckets (
  scope text not null,
  key_hash text not null,
  window_key bigint not null,
  request_count integer not null check (request_count >= 1),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_key)
);

create index if not exists rate_limit_buckets_expires_at_idx
  on rate_limit_buckets (expires_at);
