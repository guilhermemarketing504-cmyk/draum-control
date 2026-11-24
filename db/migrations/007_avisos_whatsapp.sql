-- Avisos de WhatsApp enviados à mão pelo CONTROL (botão com a mensagem pronta): registra quem já recebeu.
set search_path = draum, public;
create table if not exists whatsapp_notices (
  id          bigserial primary key,
  kind        text not null check (kind in ('pedido_confirmado','pedido_pendente','boas_vindas_vip')),
  ref_id      bigint not null,
  user_id     bigint references users(id),
  sent_at     timestamptz not null default now(),
  unique (kind, ref_id)
);
alter table whatsapp_notices enable row level security;
