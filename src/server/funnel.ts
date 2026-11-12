import type { Db } from "@/lib/db";

export const FUNNEL = [
  { key: "novo_lead", label: "Novo lead" },
  { key: "entrou_vip", label: "Entrou no VIP" },
  { key: "interesse", label: "Demonstrou interesse" },
  { key: "recebeu_oferta", label: "Recebeu oferta" },
  { key: "pedido_iniciado", label: "Pedido iniciado" },
  { key: "compra_realizada", label: "Compra realizada" },
  { key: "pos_venda", label: "Pós-venda" },
  { key: "recompra", label: "Recompra" },
] as const;
export type FunnelStage = (typeof FUNNEL)[number]["key"];
export const stageIndex = (s: string) => FUNNEL.findIndex((f) => f.key === s);
export const stageLabel = (s: string) => FUNNEL.find((f) => f.key === s)?.label ?? s;

/** Avança o cliente no funil (nunca retrocede automaticamente) e registra o evento. */
export async function advanceFunnel(db: Db, customerId: number, stage: FunnelStage) {
  const r = await db.query(`select funnel_stage from draum.customers where id = $1 for update`, [customerId]);
  const cur = r.rows[0]?.funnel_stage;
  if (cur == null || stageIndex(stage) <= stageIndex(cur)) return;
  await db.query(`update draum.customers set funnel_stage = $2 where id = $1`, [customerId, stage]);
  await db.query(`insert into draum.funnel_events(customer_id, stage) values ($1,$2)`, [customerId, stage]);
}
