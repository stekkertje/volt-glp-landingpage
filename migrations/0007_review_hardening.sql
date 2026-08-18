-- migrate:no-transaction
alter table order_access_tokens
  add column if not exists token_ciphertext text;

-- A failed concurrent unique build leaves an invalid index behind. Dropping it
-- first makes this non-transactional migration safe to retry without touching
-- or silently combining historical order lines.
drop index concurrently if exists order_lines_order_variant_uidx;
create unique index concurrently order_lines_order_variant_uidx
  on order_lines (order_id, slug, option_id);

alter table orders
  drop column if exists guest_access_token_hash;
