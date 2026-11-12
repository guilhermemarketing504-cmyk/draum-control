"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewOrderAction, createOrderAction } from "@/app/actions/orders";
import { Field } from "./forms";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

type Variant = { id: number; sku: string; color: string; size: string; product_id: number; name: string; sale_price: number; promo_price: number | null; modality: string; available: number;
  suppliers: { supplier_id: number; name: string; unit_cost: number; inbound_freight: number; lead_days: number; checked_at: string | null; is_primary: boolean }[] };
type Line = { key: string; variantId: number; qty: number; mode: "pronta" | "pre"; supplierId?: number; customerPromisedDate?: string; termsAccepted?: boolean };

export function OrderBuilder({ customers, variants, promotions, campaigns, ambassadors, today, bufferDays, validDays, isAdmin, initialCustomer }: {
  customers: any[]; variants: Variant[]; promotions: any[]; campaigns: any[]; ambassadors: any[]; today: string; bufferDays: number; validDays: number; isAdmin: boolean; initialCustomer?: number;
}) {
  const router = useRouter();
  const [idem] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()));
  const [customerId, setCustomerId] = useState<number | "">(initialCustomer ?? "");
  const [custSearch, setCustSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [promotionId, setPromotionId] = useState("");
  const [coupon, setCoupon] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [fulfillment, setFulfillment] = useState("entrega_local");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [shipping, setShipping] = useState("0");
  const [notes, setNotes] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [ambassadorId, setAmbassadorId] = useState("");
  const [attribution, setAttribution] = useState("");
  const [override, setOverride] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const customer = customers.find((c) => c.id === customerId);
  useEffect(() => { if (customer) { setAddress(customer.address ?? ""); setNeighborhood(customer.neighborhood ?? ""); } }, [customerId]); // eslint-disable-line
  const vById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  const filteredCustomers = customers.filter((c) => !custSearch || `${c.name} ${c.whatsapp ?? ""} ${c.instagram ?? ""}`.toLowerCase().includes(custSearch.toLowerCase())).slice(0, 50);

  const input = () => ({
    customerId: Number(customerId), items: lines.map(({ key, ...l }) => l), promotionId: promotionId ? Number(promotionId) : null, couponCode: coupon || null,
    paymentMethod, fulfillment, address, neighborhood, shippingCharged: Number(shipping || 0), notes, idempotencyKey: idem,
    campaignId: campaignId ? Number(campaignId) : null, ambassadorId: ambassadorId ? Number(ambassadorId) : null, attribution: attribution || null,
    marginOverrideReason: override || null,
  });

  // Pré-visualização no servidor (mesmas regras do registro)
  useEffect(() => {
    if (!customerId || !lines.length) { setPreview(null); setError(null); return; }
    const t = setTimeout(async () => {
      const r = await previewOrderAction(input());
      if (r.ok) { setPreview(r.data); setError(null); } else { setPreview(null); setError(r.error); }
    }, 300);
    return () => clearTimeout(t);
  }, [JSON.stringify(input())]); // eslint-disable-line

  const addLine = () => {
    const v = vById.get(Number(pick)); if (!v) return;
    const mode: "pronta" | "pre" = v.modality === "pre" || (v.available < 1 && v.modality !== "pronta") ? "pre" : "pronta";
    const sup = v.suppliers[0];
    setLines([...lines, { key: `${v.id}-${Date.now()}`, variantId: v.id, qty: 1, mode, supplierId: sup?.supplier_id,
      customerPromisedDate: sup ? addDays(today, sup.lead_days + bufferDays) : undefined, termsAccepted: false }]);
    setPick("");
  };
  const upd = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => start(async () => {
    const r = await createOrderAction(input());
    if (r.ok) router.push(`/pedidos/${r.data.id}`); else setError(r.error ?? "Erro");
  });

  const m = preview?.margin;
  return (
    <div className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
      <div className="space-y-6">
        <section className="card card-pad">
          <div className="label mb-3">1 · Cliente</div>
          <div className="grid sm:grid-cols-[1fr_1.4fr] gap-3">
            <input className="input" placeholder="Buscar cliente" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Selecione…</option>
              {(customer && !filteredCustomers.includes(customer) ? [customer, ...filteredCustomers] : filteredCustomers).map((c) => <option key={c.id} value={c.id}>{c.name}{c.vip_joined_at ? " · VIP" : ""}</option>)}
            </select>
          </div>
          {customers.length === 0 && <p className="text-[12.5px] text-muted mt-2">Cadastre o cliente em <a className="link" href="/clientes">Clientes</a> antes de criar o pedido.</p>}
        </section>

        <section className="card card-pad">
          <div className="label mb-3">2 · Itens</div>
          <div className="flex gap-2">
            <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Adicionar produto (SKU)…</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.color} {v.size} · {v.sku} · disp. {v.available}{v.modality !== "pronta" ? " · aceita pré-venda" : ""}</option>)}
            </select>
            <button type="button" className="btn-secondary" onClick={addLine} disabled={!pick}>Adicionar</button>
          </div>
          {lines.length > 0 && (
            <div className="mt-4 divide-y divide-line border-t border-line">
              {lines.map((l) => {
                const v = vById.get(l.variantId)!;
                const sup = v.suppliers.find((s) => s.supplier_id === l.supplierId);
                const minDate = sup ? addDays(today, sup.lead_days + bufferDays) : undefined;
                const checkedAge = sup?.checked_at ? (Date.now() - new Date(sup.checked_at).getTime()) / 86400000 : null;
                return (
                  <div key={l.key} className="py-4 space-y-3">
                    <div className="flex flex-wrap gap-3 items-end">
                      <div className="flex-1 min-w-[200px]"><div className="font-medium">{v.name}</div><div className="font-mono text-[11.5px] text-muted">{v.sku} · {v.color} · {v.size} · {brl(v.promo_price ?? v.sale_price)}</div></div>
                      <Field label="Modalidade">
                        <select className="input w-40" value={l.mode} onChange={(e) => upd(l.key, { mode: e.target.value as any })}>
                          {v.modality !== "pre" && <option value="pronta">Pronta-entrega (disp. {v.available})</option>}
                          {v.modality !== "pronta" && <option value="pre">Pré-venda</option>}
                        </select>
                      </Field>
                      <Field label="Qtd"><input className="input w-20" type="number" min={1} max={l.mode === "pronta" ? v.available : 50} value={l.qty} onChange={(e) => upd(l.key, { qty: Math.max(1, Number(e.target.value)) })} /></Field>
                      <button type="button" className="btn-ghost btn-sm mb-1" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remover</button>
                    </div>
                    {l.mode === "pronta" && l.qty > v.available && <p className="text-[12px] text-crit">Estoque disponível: {v.available}. Use pré-venda para o restante.</p>}
                    {l.mode === "pre" && (
                      <div className="bg-offwhite border border-line rounded p-3 grid sm:grid-cols-2 gap-3">
                        <Field label="Fornecedor">
                          <select className="input" value={l.supplierId ?? ""} onChange={(e) => { const s = v.suppliers.find((x) => x.supplier_id === Number(e.target.value)); upd(l.key, { supplierId: Number(e.target.value), customerPromisedDate: s ? addDays(today, s.lead_days + bufferDays) : undefined, termsAccepted: false }); }}>
                            {v.suppliers.length === 0 && <option value="">Nenhum fornecedor vinculado</option>}
                            {v.suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.name} · {s.lead_days} dias · {brl(s.unit_cost)}</option>)}
                          </select>
                        </Field>
                        <Field label="Prazo prometido ao cliente" hint={minDate ? `Mínimo seguro: ${minDate.split("-").reverse().join("/")}` : undefined}>
                          <input className="input" type="date" min={minDate} value={l.customerPromisedDate ?? ""} onChange={(e) => upd(l.key, { customerPromisedDate: e.target.value, termsAccepted: false })} />
                        </Field>
                        <div className="sm:col-span-2 text-[12px]">
                          {!sup ? <span className="text-crit">Vincule um fornecedor ao produto para vender em pré-venda.</span>
                            : checkedAge == null ? <span className="text-crit">Disponibilidade não verificada com {sup.name}. Confirme na página do produto antes de vender.</span>
                            : checkedAge > validDays ? <span className="text-crit">Verificação de disponibilidade vencida ({Math.floor(checkedAge)} dias). Confirme novamente com o fornecedor.</span>
                            : <span className="text-ok">Disponibilidade verificada há {Math.floor(checkedAge)} dia(s).</span>}
                        </div>
                        <label className="sm:col-span-2 flex items-start gap-2 text-[12.5px]">
                          <input type="checkbox" className="mt-1" checked={!!l.termsAccepted} onChange={(e) => upd(l.key, { termsAccepted: e.target.checked })} />
                          <span>A cliente foi informada e aceitou: peça adquirida do fornecedor após o pagamento, prazo do fornecedor de {sup?.lead_days ?? "?"} dias e entrega até {l.customerPromisedDate?.split("-").reverse().join("/") ?? "—"}.</span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card card-pad grid sm:grid-cols-2 gap-3">
          <div className="label sm:col-span-2">3 · Condições, entrega e atribuição</div>
          <Field label="Promoção (não cumulativa)">
            <select className="input" value={promotionId} onChange={(e) => setPromotionId(e.target.value)}>
              <option value="">Sem promoção (vale o preço promocional do produto, se houver)</option>
              {promotions.map((p) => <option key={p.id} value={p.id}>{p.name} · {Number(p.pct)}%{p.requires_vip ? " · VIP" : ""}{p.min_items > 1 ? ` · mín. ${p.min_items} peças` : ""}</option>)}
            </select>
          </Field>
          <Field label="Cupom (promoção ou embaixadora)"><input className="input uppercase" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} /></Field>
          <Field label="Forma de pagamento">
            <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="pix">Pix</option><option value="cartao_credito">Cartão de crédito</option><option value="cartao_debito">Cartão de débito</option><option value="link_pagamento">Link de pagamento</option><option value="transferencia">Transferência</option><option value="dinheiro">Dinheiro</option>
            </select>
          </Field>
          <Field label="Entrega">
            <select className="input" value={fulfillment} onChange={(e) => setFulfillment(e.target.value)}>
              <option value="entrega_local">DRAUM Delivery Day (Belém)</option><option value="retirada">Retirada</option><option value="envio">Envio (transportadora)</option>
            </select>
          </Field>
          {fulfillment !== "retirada" && <>
            <Field label="Endereço"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <Field label="Bairro"><input className="input" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} /></Field>
          </>}
          <Field label="Frete cobrado (R$)" hint="Zero no Delivery Day. O custo real da rota é apurado mesmo assim."><input className="input" type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} /></Field>
          <Field label="Campanha (registro explícito)"><select className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Embaixadora (sem cupom)"><select className="input" value={ambassadorId} onChange={(e) => setAmbassadorId(e.target.value)}><option value="">—</option>{ambassadors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          {(ambassadorId || campaignId) && <Field label="Como a origem foi rastreada"><select className="input" value={attribution} onChange={(e) => setAttribution(e.target.value)}><option value="">Selecione…</option><option value="link">Link rastreado</option><option value="registro_explicito">Registro explícito (cliente informou)</option></select></Field>}
          <Field label="Observações" className="sm:col-span-2"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </section>
      </div>

      <aside className="card card-pad xl:sticky xl:top-8 space-y-4">
        <div className="label">Resumo</div>
        {!m ? <p className="text-muted text-[13px]">Selecione cliente e itens para calcular valores e margem.</p> : (
          <dl className="space-y-1.5 text-[13px] num">
            <Row k="Subtotal" v={brl(m.gross)} />
            <Row k="Descontos" v={`− ${brl(m.discount)}`} />
            <Row k="Frete cobrado" v={brl(Number(shipping || 0))} />
            <div className="vao my-3" />
            <Row k="Total" v={<span className="font-display text-[20px]">{brl(m.netRevenue + Number(shipping || 0))}</span>} />
            <div className="pt-3 label">Margem de contribuição estimada</div>
            <Row k="Custo das peças" v={brl(m.cogs)} muted />
            <Row k="Taxa de pagamento" v={brl(m.fee)} muted />
            <Row k="Tributos estimados" v={brl(m.tax)} muted />
            <Row k="Embalagem" v={brl(m.packaging)} muted />
            <Row k="Entrega (custo − frete)" v={brl(m.delivery)} muted />
            <Row k="Margem" v={<span className={m.marginPct < preview.minMarginPct ? "text-crit font-medium" : "font-medium"}>{brl(m.margin)} · {m.marginPct.toLocaleString("pt-BR")}%</span>} />
          </dl>
        )}
        {preview?.warnings?.map((w: string) => <p key={w} className="text-[12px] text-warn">{w}</p>)}
        {preview?.marginBelow && (
          <div className="border-l-2 border-crit bg-crit/5 p-3 text-[12.5px] text-crit space-y-2">
            <p>O desconto leva a margem abaixo de {preview.minMarginPct}%.</p>
            {isAdmin ? <textarea className="input" rows={2} placeholder="Justificativa da aprovação administrativa" value={override} onChange={(e) => setOverride(e.target.value)} />
              : <p>Somente um administrador pode aprovar esta exceção.</p>}
          </div>
        )}
        {error && <p role="alert" className="text-[12.5px] text-crit border-l-2 border-crit pl-3 py-1 bg-crit/5">{error}</p>}
        <button className="btn-primary w-full" disabled={pending || !customerId || !lines.length || !!error} onClick={submit}>{pending ? "Registrando…" : "Registrar pedido"}</button>
        <p className="text-[11.5px] text-muted">Itens de pronta-entrega ficam reservados ao registrar. O pagamento só conta como recebido após a conciliação.</p>
      </aside>
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: React.ReactNode; muted?: boolean }) {
  return <div className={`flex justify-between gap-4 ${muted ? "text-muted text-[12.5px]" : ""}`}><dt>{k}</dt><dd>{v}</dd></div>;
}
