-- Black Friday: grupo VIP com 20% de 24 a 30/11; público geral com 10% de 27 a 30/11.
set search_path = draum, public;
update promotions set pct = 20, ends_at = '2026-11-30 23:59-03' where name = 'Black Friday — acesso antecipado VIP';
update promotions set pct = 10 where name = 'Black Friday DRAUM';
