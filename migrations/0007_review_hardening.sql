-- migrate:no-transaction
alter table order_access_tokens
  add column if not exists token_ciphertext text;

-- Fail closed, with a recognizable constraint name, before attempting the
-- unique index. Operators must inspect and resolve historical duplicates
-- manually; this migration never deletes or combines order history.
create temporary table migration_0007_order_line_duplicate_guard (
  order_id text,
  slug text,
  option_id text,
  constraint migration_0007_duplicate_order_variants_must_be_resolved
    check (order_id is null)
);

insert into migration_0007_order_line_duplicate_guard (order_id, slug, option_id)
select order_id, slug, option_id
from order_lines
group by order_id, slug, option_id
having count(*) > 1
limit 1;

drop table migration_0007_order_line_duplicate_guard;

-- A failed concurrent build can leave an invalid index behind. Dropping it
-- first makes the non-transactional migration retry-safe. A write racing the
-- preflight can still make CREATE fail closed; the next run repeats both steps.
drop index concurrently if exists order_lines_order_variant_uidx;
create unique index concurrently order_lines_order_variant_uidx
  on order_lines (order_id, slug, option_id);

alter table orders
  drop column if exists guest_access_token_hash;
