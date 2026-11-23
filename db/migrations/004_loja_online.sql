-- DRAUM — Loja online + catálogo sob encomenda da distribuidora (MFT)
set search_path = draum, public;

-- Produtos: origem, endereço público e vínculo com o catálogo da distribuidora
alter table products add column if not exists slug text;
alter table products add column if not exists source text not null default 'proprio' check (source in ('proprio','mft'));
alter table products add column if not exists external_id text;
alter table products add column if not exists external_url text;
alter table products add column if not exists store_visible boolean not null default true;
alter table products add column if not exists synced_at timestamptz;
create unique index if not exists products_slug_uq on products(slug) where slug is not null;
create unique index if not exists products_external_uq on products(source, external_id) where external_id is not null;

-- Slug automático (nome sem acentos + id) para produtos cadastrados no CONTROL
create or replace function draum.slugify(t text) returns text language sql immutable as $$
  select lower(regexp_replace(regexp_replace(translate(coalesce(t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'),
    '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
$$;
create or replace function draum.products_slug() returns trigger language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then new.slug := draum.slugify(new.name) || '-' || new.id; end if;
  return new;
end $$;
drop trigger if exists products_slug_trg on products;
create trigger products_slug_trg before insert or update on products for each row execute function draum.products_slug();
update products set slug = draum.slugify(name) || '-' || id where slug is null;

-- Variantes: cor em hexadecimal, referência e estoque na distribuidora
alter table product_variants add column if not exists color_hex text;
alter table product_variants add column if not exists external_sku text;
alter table product_variants add column if not exists supplier_stock int check (supplier_stock >= 0);
create unique index if not exists product_variants_external_uq on product_variants(external_sku) where external_sku is not null;

-- Fotos: links externos (distribuidora) ou arquivos enviados pelo CONTROL
create table if not exists product_images (
  id          bigserial primary key,
  product_id  bigint not null references products(id) on delete cascade,
  color       text,                    -- foto específica de uma cor (null = todas)
  url         text,                    -- imagem externa
  data        bytea,                   -- imagem enviada (JPEG/PNG/WebP comprimida)
  mime        text,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  check (url is not null or data is not null)
);
create index if not exists product_images_product_idx on product_images(product_id, position);

-- Histórico das sincronizações com a distribuidora
create table if not exists supplier_sync_runs (
  id           bigserial primary key,
  supplier_id  bigint references suppliers(id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'rodando' check (status in ('rodando','ok','erro')),
  logged_in    boolean not null default false,
  products_seen int not null default 0,
  products_created int not null default 0,
  products_updated int not null default 0,
  products_paused  int not null default 0,
  without_cost int not null default 0,
  message      text
);

-- Pedidos vindos da loja
alter table orders add column if not exists channel text not null default 'control' check (channel in ('control','loja'));

-- Fornecedor MFT
insert into suppliers(name, city, default_lead_days, notes)
select 'MFT (revenda)', null, 2, 'Distribuidora. Catálogo sincronizado automaticamente pelo robô da loja; pedidos até sexta 12h chegam na terça.'
where not exists (select 1 from suppliers where name = 'MFT (revenda)');

-- Corte do DRAUM Delivery Day: sexta-feira, 12h
update settings set value = '{"weekday":5,"hour":12}', updated_at = now() where key = 'delivery_cutoff';

-- Configuração da loja
insert into settings(key, value) values
  ('store', jsonb_build_object(
     'whatsapp', '',                 -- WhatsApp da DRAUM que recebe os pedidos (DDD + número)
     'margin_pct', 50,               -- margem sobre o preço de venda: preço = custo ÷ (1 − margem)
     'price_ending', 0.90,           -- arredonda para cima terminando em ,90 (0 = sem arredondamento)
     'mft_lead_days', 2,
     'mft_enabled', true,
     'mft_supplier_id', (select id from suppliers where name = 'MFT (revenda)' limit 1)
  ))
on conflict (key) do nothing;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'draum' loop
    execute format('alter table draum.%I enable row level security', t.tablename);
  end loop;
end $$;
