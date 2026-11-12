-- DRAUM CONTROL — esquema principal
-- Tudo vive no schema "draum" (não exposto pela API REST pública do Supabase)
-- e com RLS habilitado sem políticas: só o servidor da aplicação, conectado
-- com a role do banco, acessa os dados.

create schema if not exists draum;
set search_path = draum, public;

-- ───────────────────────── Usuários e auditoria ─────────────────────────
create table users (
  id            bigserial primary key,
  name          text not null,
  email         text not null unique,
  password_hash text not null,
  role          text not null check (role in ('admin','operador')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table audit_log (
  id         bigserial primary key,
  user_id    bigint references users(id),
  entity     text not null,
  entity_id  text,
  action     text not null,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log(entity, entity_id);
create index audit_log_created_idx on audit_log(created_at desc);

-- ───────────────────────── Configurações ─────────────────────────
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by bigint references users(id)
);

create table delivery_zones (
  id            bigserial primary key,
  neighborhood  text not null unique,
  eligible      boolean not null default true,
  notes         text
);

-- ───────────────────────── Fornecedores ─────────────────────────
create table suppliers (
  id              bigserial primary key,
  name            text not null,
  contact_name    text,
  whatsapp        text,
  email           text,
  city            text,
  default_lead_days int check (default_lead_days >= 0),
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ───────────────────────── Produtos e variantes ─────────────────────────
create table products (
  id            bigserial primary key,
  code          text not null unique,          -- ex.: DRA-MAC-001
  name          text not null,
  category      text not null check (category in
                  ('macaquinhos','macacoes','tops','leggings','shorts','conjuntos','camisetas','casaquinhos','outras')),
  description   text,
  image_url     text,
  sale_price    numeric(12,2) not null check (sale_price >= 0),
  promo_price   numeric(12,2) check (promo_price >= 0),
  modality      text not null default 'ambas' check (modality in ('pronta','pre','ambas')),
  status        text not null default 'ativo' check (status in ('rascunho','ativo','pausado','descontinuado')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table product_variants (
  id          bigserial primary key,
  product_id  bigint not null references products(id) on delete cascade,
  sku         text not null unique,            -- ex.: DRA-MAC-001-PTO-M
  color       text not null,
  color_code  text not null,
  size        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (product_id, color_code, size)
);
create index product_variants_product_idx on product_variants(product_id);

-- Vínculo produto x fornecedor (custos e prazos diferentes por fornecedor)
create table product_suppliers (
  id                  bigserial primary key,
  product_id          bigint not null references products(id) on delete cascade,
  supplier_id         bigint not null references suppliers(id),
  unit_cost           numeric(12,2) not null check (unit_cost >= 0),
  inbound_freight     numeric(12,2) not null default 0 check (inbound_freight >= 0), -- frete de aquisição por peça
  lead_days           int not null check (lead_days >= 0),
  availability_checked_at timestamptz,          -- quando a disponibilidade foi verificada com o fornecedor
  is_primary          boolean not null default false,
  notes               text,
  unique (product_id, supplier_id)
);

-- ───────────────────────── Estoque ─────────────────────────
create table inventory (
  variant_id      bigint primary key references product_variants(id) on delete cascade,
  qty_physical    int not null default 0 check (qty_physical >= 0),
  qty_reserved    int not null default 0 check (qty_reserved >= 0),
  qty_in_transit  int not null default 0 check (qty_in_transit >= 0),
  min_qty         int not null default 0 check (min_qty >= 0),
  avg_cost        numeric(12,4) not null default 0 check (avg_cost >= 0),
  location        text,
  last_movement_at timestamptz,
  -- Proteção final contra venda duplicada: nunca reservar mais do que existe.
  constraint inventory_reserved_le_physical check (qty_reserved <= qty_physical)
);

create table stock_movements (
  id             bigserial primary key,
  variant_id     bigint not null references product_variants(id),
  type           text not null check (type in
                   ('entrada','reserva','liberacao','baixa','ajuste','devolucao','transito')),
  qty            int not null,                  -- sinal: + aumenta, - diminui o campo afetado
  field          text not null check (field in ('physical','reserved','in_transit')),
  unit_cost      numeric(12,4),
  order_item_id  bigint,
  purchase_order_item_id bigint,
  note           text,
  user_id        bigint references users(id),
  created_at     timestamptz not null default now()
);
create index stock_movements_variant_idx on stock_movements(variant_id, created_at desc);

-- ───────────────────────── Clientes / CRM ─────────────────────────
create table customers (
  id               bigserial primary key,
  name             text not null,
  whatsapp         text,
  instagram        text,
  email            text,
  city             text default 'Belém',
  neighborhood     text,
  address          text,
  product_prefs    text,
  sizes            text,
  lead_source      text check (lead_source in
                     ('instagram','indicacao','whatsapp','embaixadora','evento','site','outro')),
  vip_joined_at    date,
  funnel_stage     text not null default 'novo_lead' check (funnel_stage in
                     ('novo_lead','entrou_vip','interesse','recebeu_oferta','pedido_iniciado',
                      'compra_realizada','pos_venda','recompra')),
  consent_whatsapp boolean not null default false,
  consent_email    boolean not null default false,
  consent_at       timestamptz,
  consent_source   text,
  last_contact_at  timestamptz,
  notes            text,
  campaign_id      bigint,          -- campanha que gerou o lead (FK adicionada abaixo)
  ambassador_id    bigint,          -- embaixadora que indicou (FK adicionada abaixo)
  created_at       timestamptz not null default now()
);
create unique index customers_whatsapp_uq on customers(whatsapp) where whatsapp is not null and whatsapp <> '';
create index customers_stage_idx on customers(funnel_stage);

create table contact_log (
  id          bigserial primary key,
  customer_id bigint not null references customers(id) on delete cascade,
  channel     text not null check (channel in ('whatsapp','instagram','email','presencial','telefone')),
  note        text,
  user_id     bigint references users(id),
  created_at  timestamptz not null default now()
);

create table funnel_events (
  id          bigserial primary key,
  customer_id bigint not null references customers(id) on delete cascade,
  stage       text not null,
  created_at  timestamptz not null default now()
);
create index funnel_events_customer_idx on funnel_events(customer_id);

-- ───────────────────────── Marketing ─────────────────────────
create table campaigns (
  id          bigserial primary key,
  name        text not null unique,
  channel     text,
  objective   text,
  starts_on   date,
  ends_on     date,
  budget      numeric(12,2) not null default 0 check (budget >= 0),
  spent       numeric(12,2) not null default 0 check (spent >= 0),
  status      text not null default 'planejada' check (status in ('planejada','ativa','encerrada')),
  notes       text,
  created_at  timestamptz not null default now()
);

create table ambassadors (
  id             bigserial primary key,
  name           text not null,
  instagram      text,
  status         text not null default 'prospeccao' check (status in ('prospeccao','ativa','pausada','encerrada')),
  referral_code  text unique,
  content_agreed text,
  notes          text,
  created_at     timestamptz not null default now()
);

create table ambassador_shipments (
  id            bigserial primary key,
  ambassador_id bigint not null references ambassadors(id) on delete cascade,
  variant_id    bigint references product_variants(id),
  description   text,
  qty           int not null default 1 check (qty > 0),
  unit_cost     numeric(12,2) not null default 0,
  sent_on       date,
  content_delivered boolean not null default false
);

create table promotions (
  id           bigserial primary key,
  name         text not null,
  kind         text not null check (kind in ('vip','duas_pecas','black_friday','cupom','outra')),
  pct          numeric(5,2) not null check (pct > 0 and pct < 100),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  min_items    int not null default 1 check (min_items >= 1),
  all_products boolean not null default true,
  requires_vip boolean not null default false,
  coupon_code  text unique,
  campaign_id  bigint references campaigns(id),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table promotion_products (
  promotion_id bigint not null references promotions(id) on delete cascade,
  product_id   bigint not null references products(id) on delete cascade,
  primary key (promotion_id, product_id)
);

-- ───────────────────────── Pedidos ─────────────────────────
create sequence order_number_seq start 1001;

create table orders (
  id                 bigserial primary key,
  number             text not null unique default ('DRM-' || nextval('draum.order_number_seq')),
  customer_id        bigint not null references customers(id),
  idempotency_key    text unique,             -- proteção contra envio duplicado do formulário
  status             text not null default 'aguardando_pagamento' check (status in
                       ('aguardando_pagamento','pago','em_andamento','entregue_parcial','entregue','finalizado','cancelado')),
  financial_status   text not null default 'aguardando' check (financial_status in
                       ('aguardando','informado','pago','parcialmente_reembolsado','reembolsado')),
  subtotal           numeric(12,2) not null check (subtotal >= 0),
  discount_total     numeric(12,2) not null default 0 check (discount_total >= 0),
  shipping_charged   numeric(12,2) not null default 0 check (shipping_charged >= 0),
  total              numeric(12,2) not null check (total >= 0),
  payment_method     text check (payment_method in ('pix','cartao_credito','cartao_debito','link_pagamento','dinheiro','transferencia')),
  promotion_id       bigint references promotions(id),
  margin_override_by bigint references users(id),   -- aprovação administrativa de exceção de margem
  margin_override_reason text,
  campaign_id        bigint references campaigns(id),
  ambassador_id      bigint references ambassadors(id),
  attribution        text check (attribution in ('cupom','link','registro_explicito')),
  coupon_code        text,
  fulfillment        text not null default 'entrega_local' check (fulfillment in ('entrega_local','retirada','envio')),
  address            text,
  neighborhood       text,
  promised_date      date,                     -- prazo prometido ao cliente (pedido inteiro)
  notes              text,
  created_by         bigint references users(id),
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,              -- quando o pagamento foi CONCILIADO
  cancelled_at       timestamptz,
  cancel_reason      text,
  check (total = subtotal - discount_total + shipping_charged)
);
create index orders_customer_idx on orders(customer_id);
create index orders_created_idx on orders(created_at desc);
create index orders_status_idx on orders(status);

create table order_items (
  id                   bigserial primary key,
  order_id             bigint not null references orders(id) on delete cascade,
  variant_id           bigint not null references product_variants(id),
  mode                 text not null check (mode in ('pronta','pre')),
  qty                  int not null check (qty > 0),
  unit_price           numeric(12,2) not null check (unit_price >= 0),
  discount             numeric(12,2) not null default 0 check (discount >= 0),
  total                numeric(12,2) not null check (total >= 0),
  unit_cost            numeric(12,2) not null default 0 check (unit_cost >= 0), -- custo estimado/confirmado
  supplier_id          bigint references suppliers(id),
  supplier_lead_days   int,
  supplier_checked_at  timestamptz,
  expected_ready_date  date,                    -- previsão de chegada/disponibilidade
  customer_promised_date date,                  -- prazo prometido ao cliente para este item
  terms_accepted       text,                    -- condições de fornecimento aceitas pelo cliente
  terms_accepted_at    timestamptz,
  status               text not null default 'aguardando_pagamento' check (status in
                         ('aguardando_pagamento','reservado','aguardando_compra','comprado','recebido',
                          'embalado','pronto','em_rota','entregue','cancelado','devolvido','trocado')),
  delivered_at         timestamptz,
  created_at           timestamptz not null default now(),
  check (total = round(qty * unit_price - discount, 2)),
  check (mode = 'pronta' or (supplier_id is not null and terms_accepted is not null))
);
create index order_items_order_idx on order_items(order_id);
create index order_items_status_idx on order_items(status);

create table payments (
  id             bigserial primary key,
  order_id       bigint not null references orders(id),
  amount         numeric(12,2) not null check (amount > 0),
  method         text not null,
  fee_amount     numeric(12,2) not null default 0 check (fee_amount >= 0),
  external_ref   text,                  -- id da transação / comprovante
  status         text not null default 'informado' check (status in ('informado','conciliado','rejeitado')),
  informed_at    timestamptz not null default now(),
  informed_by    bigint references users(id),
  reconciled_at  timestamptz,
  reconciled_by  bigint references users(id),
  check (status <> 'conciliado' or reconciled_at is not null)
);
create index payments_order_idx on payments(order_id);

-- ───────────────────────── Compras a fornecedor ─────────────────────────
create sequence po_number_seq start 101;
create table purchase_orders (
  id             bigserial primary key,
  number         text not null unique default ('OC-' || nextval('draum.po_number_seq')),
  supplier_id    bigint not null references suppliers(id),
  status         text not null default 'rascunho' check (status in
                   ('rascunho','enviado','pago','em_transito','recebido_parcial','recebido','cancelado')),
  goods_total    numeric(12,2) not null default 0 check (goods_total >= 0),
  shipping_cost  numeric(12,2) not null default 0 check (shipping_cost >= 0),
  ordered_at     timestamptz,
  paid_at        timestamptz,
  expected_at    date,
  tracking_code  text,
  notes          text,
  created_by     bigint references users(id),
  created_at     timestamptz not null default now()
);

create table purchase_order_items (
  id             bigserial primary key,
  purchase_order_id bigint not null references purchase_orders(id) on delete cascade,
  variant_id     bigint not null references product_variants(id),
  order_item_id  bigint references order_items(id),  -- vínculo com a pré-venda (null = reposição de estoque)
  qty            int not null check (qty > 0),
  qty_received   int not null default 0 check (qty_received >= 0),
  unit_cost      numeric(12,2) not null check (unit_cost >= 0),
  received_at    timestamptz,
  check (qty_received <= qty)
);
create index poi_po_idx on purchase_order_items(purchase_order_id);
-- Cada item de pré-venda só pode estar em uma compra ativa
create unique index poi_order_item_uq on purchase_order_items(order_item_id) where order_item_id is not null;

-- ───────────────────────── Financeiro ─────────────────────────
-- Lançamentos de caixa EFETIVOS (entradas e saídas que de fato ocorreram)
create table cash_entries (
  id            bigserial primary key,
  direction     text not null check (direction in ('entrada','saida')),
  category      text not null check (category in
                  ('venda','aporte','outra_receita',
                   'compra_mercadoria','frete_compra','frete_entrega','embalagem','taxa_financeira',
                   'tributo','despesa_operacional','marketing','reembolso','reinvestimento_estoque','outra_despesa')),
  amount        numeric(12,2) not null check (amount > 0),
  occurred_on   date not null default current_date,
  description   text,
  reconciled    boolean not null default false,  -- conferido no extrato bancário
  order_id      bigint references orders(id),
  payment_id    bigint references payments(id),
  purchase_order_id bigint references purchase_orders(id),
  delivery_route_id bigint,
  refund_id     bigint,
  created_by    bigint references users(id),
  created_at    timestamptz not null default now()
);
create index cash_entries_date_idx on cash_entries(occurred_on);

-- Obrigações (caixa comprometido): o que já é devido por pedidos pagos e ainda não saiu do caixa.
create table obligations (
  id            bigserial primary key,
  kind          text not null check (kind in ('mercadoria','tributo','entrega','reembolso','conta_pagar')),
  amount        numeric(12,2) not null check (amount >= 0),
  status        text not null default 'aberta' check (status in ('aberta','liquidada','cancelada')),
  order_id      bigint references orders(id),
  order_item_id bigint references order_items(id),
  purchase_order_id bigint references purchase_orders(id),
  due_on        date,
  description   text,
  settled_at    timestamptz,
  settled_by_entry bigint references cash_entries(id),
  created_at    timestamptz not null default now()
);
create index obligations_open_idx on obligations(status) where status = 'aberta';
create index obligations_order_idx on obligations(order_id);

create table refunds (
  id          bigserial primary key,
  order_id    bigint not null references orders(id),
  amount      numeric(12,2) not null check (amount > 0),
  reason      text not null,
  status      text not null default 'aprovado' check (status in ('aprovado','pago','cancelado')),
  created_by  bigint references users(id),
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

create table returns (
  id             bigserial primary key,
  order_item_id  bigint not null references order_items(id),
  kind           text not null check (kind in ('troca','devolucao')),
  qty            int not null check (qty > 0),
  reason         text not null,
  restock        boolean not null default true,   -- peça volta ao estoque vendável?
  new_variant_id bigint references product_variants(id),  -- para trocas
  refund_id      bigint references refunds(id),
  status         text not null default 'concluida' check (status in ('concluida','cancelada')),
  created_by     bigint references users(id),
  created_at     timestamptz not null default now()
);

-- ───────────────────────── Entregas (DRAUM DELIVERY DAY) ─────────────────────────
create table delivery_routes (
  id           bigserial primary key,
  route_date   date not null,
  driver       text,
  capacity     int not null default 20 check (capacity > 0),
  status       text not null default 'planejada' check (status in ('planejada','em_rota','concluida','cancelada')),
  actual_cost  numeric(12,2) check (actual_cost >= 0),
  notes        text,
  created_at   timestamptz not null default now()
);

create table delivery_stops (
  id           bigserial primary key,
  route_id     bigint not null references delivery_routes(id) on delete cascade,
  order_id     bigint not null references orders(id),
  seq          int not null default 0,
  window_label text,                      -- janela de entrega, ex.: 09h–12h
  recipient    text,
  phone        text,
  status       text not null default 'planejada' check (status in ('planejada','em_rota','entregue','falhou','cancelada')),
  proof        text,                      -- comprovante (nome de quem recebeu / link de foto)
  occurrence   text,                      -- ocorrências
  delivered_at timestamptz,
  allocated_cost numeric(12,2)
);
create index delivery_stops_route_idx on delivery_stops(route_id);
create unique index delivery_stops_active_uq on delivery_stops(order_id, route_id);

create table delivery_stop_items (
  stop_id       bigint not null references delivery_stops(id) on delete cascade,
  order_item_id bigint not null references order_items(id),
  primary key (stop_id, order_item_id)
);

alter table customers add constraint customers_campaign_fk foreign key (campaign_id) references campaigns(id);
alter table customers add constraint customers_ambassador_fk foreign key (ambassador_id) references ambassadors(id);
alter table cash_entries add constraint cash_entries_route_fk foreign key (delivery_route_id) references delivery_routes(id);
alter table cash_entries add constraint cash_entries_refund_fk foreign key (refund_id) references refunds(id);

-- ───────────────────────── RLS: negar acesso direto via API pública ─────────────────────────
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'draum' loop
    execute format('alter table draum.%I enable row level security', t.tablename);
  end loop;
end $$;
