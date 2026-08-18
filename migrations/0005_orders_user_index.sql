-- migrate:no-transaction
drop index concurrently if exists orders_user_id_idx;
create index concurrently orders_user_id_idx on orders (user_id);
