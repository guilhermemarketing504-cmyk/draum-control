-- Configurações iniciais. Somente parâmetros informados no briefing da DRAUM.
-- Taxas de pagamento, alíquota de tributos e custos de embalagem/entrega começam
-- em ZERO de propósito: o sistema exibe um alerta de "configuração pendente"
-- até que valores reais sejam informados em Configurações.
set search_path = draum, public;

insert into settings (key, value) values
  ('min_margin_pct',          '30'),     -- margem de contribuição mínima (%)
  ('contingency_pct',         '10'),     -- reserva de contingência sobre recebimentos livres (%)
  ('safety_reserve_fixed',    '0'),      -- reserva de segurança fixa (R$)
  ('tax_pct',                 '0'),      -- tributos estimados sobre a receita (%) — CONFIGURAR
  ('payment_fee_pct',         '{"pix":0,"cartao_credito":0,"cartao_debito":0,"link_pagamento":0,"dinheiro":0,"transferencia":0}'),
  ('packaging_cost',          '0'),      -- custo de embalagem por pedido (R$) — CONFIGURAR
  ('delivery_cost_estimate',  '0'),      -- custo estimado por entrega local (R$) — CONFIGURAR
  ('presale_buffer_days',     '2'),      -- folga entre chegada do fornecedor e prazo prometido
  ('availability_valid_days', '7'),      -- validade da verificação de disponibilidade do fornecedor
  ('route_capacity_default',  '20'),
  ('delivery_cutoff',         '{"weekday":4,"hour":18}'),  -- quinta-feira, 18h
  ('goals', '{"vip_members":150,"paid_orders":30,"paid_orders_deadline":"2026-11-30","avg_ticket":150,"gross_revenue":4500,"contribution_margin_pct":30,"on_time_delivery_pct":100}')
on conflict (key) do nothing;

-- Campanhas iniciais citadas no briefing (sem orçamento: preencher no sistema)
insert into campaigns (name, channel, objective, starts_on, ends_on, status) values
  ('DRAUM PRIVATE ACCESS', 'WhatsApp', 'Captação de clientes VIP durante o pré-lançamento', current_date, '2026-11-26', 'ativa'),
  ('DRAUM BLACK FRIDAY 2026', 'WhatsApp + Instagram', 'Lançamento: acesso VIP antecipado em 26/11 e abertura oficial em 27/11', '2026-11-26', '2026-11-30', 'planejada'),
  ('DRAUM DELIVERY DAY', 'Instagram + WhatsApp', 'Divulgar as entregas gratuitas de terça-feira em Belém', current_date, null, 'ativa')
on conflict (name) do nothing;

-- Política promocional inicial (percentuais do briefing). Datas e produtos são editáveis.
-- A promoção de Black Friday começa sem produtos selecionados: escolha-os antes de ativar.
insert into promotions (name, kind, pct, starts_at, ends_at, min_items, all_products, requires_vip, campaign_id, active)
select 'Pré-lançamento VIP', 'vip', 10, now(), '2026-11-26 00:00-03', 1, true, true,
       (select id from campaigns where name = 'DRAUM PRIVATE ACCESS'), true
where not exists (select 1 from promotions where kind = 'vip');

insert into promotions (name, kind, pct, starts_at, ends_at, min_items, all_products, requires_vip, active)
select 'Pedido com duas peças', 'duas_pecas', 12, now(), '2026-12-31 23:59-03', 2, true, false, true
where not exists (select 1 from promotions where kind = 'duas_pecas');

insert into promotions (name, kind, pct, starts_at, ends_at, min_items, all_products, requires_vip, campaign_id, active)
select 'Black Friday — acesso VIP antecipado', 'black_friday', 20, '2026-11-26 00:00-03', '2026-11-27 00:00-03', 1, false, true,
       (select id from campaigns where name = 'DRAUM BLACK FRIDAY 2026'), true
where not exists (select 1 from promotions where name = 'Black Friday — acesso VIP antecipado');

insert into promotions (name, kind, pct, starts_at, ends_at, min_items, all_products, requires_vip, campaign_id, active)
select 'Black Friday — produtos selecionados', 'black_friday', 20, '2026-11-27 00:00-03', '2026-11-30 23:59-03', 1, false, false,
       (select id from campaigns where name = 'DRAUM BLACK FRIDAY 2026'), true
where not exists (select 1 from promotions where name = 'Black Friday — produtos selecionados');
