insert into discount_codes (code, percent, active)
values ('AFSLANK10', 10, true)
on conflict (code) do nothing;
