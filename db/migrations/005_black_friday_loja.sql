-- Black Friday DRAUM na loja online
-- Acesso antecipado do grupo VIP (DRAUM PRIVATE ACCESS): 24 a 26/11, 20% em todas as peças.
-- Público geral: 27 a 30/11, 20% em todas as peças.
set search_path = draum, public;

update promotions set name = 'Black Friday — acesso antecipado VIP', pct = 20, all_products = true, requires_vip = true,
  starts_at = '2026-11-24 00:00-03', ends_at = '2026-11-27 00:00-03', active = true
 where name = 'Black Friday — acesso VIP antecipado';

update promotions set name = 'Black Friday DRAUM', pct = 20, all_products = true, requires_vip = false,
  starts_at = '2026-11-27 00:00-03', ends_at = '2026-11-30 23:59-03', active = true
 where name = 'Black Friday — produtos selecionados';

-- Código do link de acesso antecipado enviado no grupo VIP
update settings set value = value || jsonb_build_object('vip_code', 'vip-' || substr(md5(random()::text), 1, 8))
 where key = 'store' and not (value ? 'vip_code');
