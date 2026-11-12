import { PageHeader } from "@/components/ui";
import { OrderBuilder } from "@/components/OrderBuilder";
import { sellableVariants } from "@/server/products";
import { listCustomers } from "@/server/crm";
import { listPromotions } from "@/server/pricing";
import { listCampaigns, listAmbassadors } from "@/server/marketing";
import { getSettings, todayISO } from "@/server/core";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Novo pedido" };

export default async function NovoPedido({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const [user, variants, customers, promos, campaigns, ambassadors, s] = await Promise.all([
    requireSession(), sellableVariants(), listCustomers(), listPromotions(), listCampaigns(), listAmbassadors(), getSettings(),
  ]);
  const now = new Date();
  const active = promos.filter((p) => p.active && new Date(p.ends_at) > now);
  return (
    <>
      <PageHeader eyebrow="Pedidos" title="Novo pedido" description="Preços, descontos, estoque, prazos de pré-venda e margem são validados no servidor antes de gravar." />
      <OrderBuilder customers={customers.filter((c) => !c.name.startsWith("Cliente anonimizado")).map((c) => ({ id: c.id, name: c.name, whatsapp: c.whatsapp, instagram: c.instagram, vip_joined_at: c.vip_joined_at, address: c.address, neighborhood: c.neighborhood }))}
        variants={variants} promotions={active.map((p) => ({ id: p.id, name: p.name, pct: p.pct, requires_vip: p.requires_vip, min_items: p.min_items }))}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} ambassadors={ambassadors.filter((a) => a.status === "ativa").map((a) => ({ id: a.id, name: a.name }))}
        today={todayISO()} bufferDays={s.presale_buffer_days} validDays={s.availability_valid_days} isAdmin={user.role === "admin"}
        initialCustomer={sp.cliente ? Number(sp.cliente) : undefined} />
    </>
  );
}
