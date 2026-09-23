create table if not exists order_number_counters (
  key text primary key,
  next_value integer not null check (next_value >= 0)
);

insert into order_number_counters (key, next_value)
select
  'med',
  greatest(
    3100,
    coalesce(
      max(substring(order_number from 5)::integer) + 2,
      3100
    )
  )
from orders
where order_number ~ '^MED-[0-9]+$'
on conflict (key) do nothing;
