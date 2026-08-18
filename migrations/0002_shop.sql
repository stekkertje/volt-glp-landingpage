create table if not exists customers (
  id text primary key,
  email text unique not null,
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  order_number text unique not null,
  idempotency_key text unique,
  customer_id text references customers (id),
  user_id text,
  email text not null,
  name text not null,
  phone text,
  street text not null,
  house_number text not null,
  postcode text not null,
  city text not null,
  country text not null check (country in ('NL', 'BE')),
  status text not null check (
    status in ('pending', 'paid', 'packed', 'shipped', 'cancelled')
  ),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  stack_discount_cents integer not null check (stack_discount_cents >= 0),
  code_discount_cents integer not null check (code_discount_cents >= 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  discount_code text,
  note text,
  guest_access_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_lines (
  id text primary key,
  order_id text not null references orders (id) on delete cascade,
  slug text not null,
  option_id text not null,
  name text not null,
  option_label text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  qty integer not null check (qty between 1 and 10),
  line_total_cents integer not null check (line_total_cents >= 0)
);

create table if not exists contact_messages (
  id text primary key,
  name text not null,
  email text not null,
  message text not null,
  handled boolean not null default false,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create table if not exists discount_codes (
  code text primary key,
  percent integer not null check (percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into discount_codes (code, percent, active)
values ('VOLT10', 10, true)
on conflict (code) do nothing;

create index if not exists orders_customer_id_idx on orders (customer_id);
create index if not exists orders_email_idx on orders (email);
create index if not exists orders_created_at_idx on orders (created_at);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_idempotency_key_idx on orders (idempotency_key);
create index if not exists order_lines_order_id_idx on order_lines (order_id);
create index if not exists contact_messages_created_at_idx on contact_messages (created_at);
create index if not exists contact_messages_handled_idx on contact_messages (handled);
