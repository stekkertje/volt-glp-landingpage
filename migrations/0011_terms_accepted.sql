alter table orders
  add column if not exists terms_accepted_at timestamptz;
