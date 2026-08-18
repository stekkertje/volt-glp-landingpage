update orders
set user_id = null
where user_id is not null
  and not exists (
    select 1
    from "user"
    where "user"."id" = orders.user_id
  );

alter table orders
  add constraint orders_user_id_fkey
  foreign key (user_id)
  references "user" ("id")
  on delete set null
  not valid;
