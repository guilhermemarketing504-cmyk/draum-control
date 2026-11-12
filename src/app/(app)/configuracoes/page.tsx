import { requireAdminPage } from "@/lib/auth";
import { getSettings } from "@/server/core";
import { listUsers } from "@/server/users";
import { listZones } from "@/server/delivery";
import { q } from "@/lib/db";
import { PageHeader, Section, Tabs, Badge } from "@/components/ui";
import { ActionForm, ActionButton, Field, Disclosure } from "@/components/forms";
import { saveSettingsAction, createUserAction, updateUserAction, changePasswordAction } from "@/app/actions/settings";
import { saveZoneAction, deleteZoneAction } from "@/app/actions/delivery";
import { PAYMENT_METHODS } from "@/server/orders";
import { dateTimeBR } from "@/lib/format";

export const metadata = { title: "Configurações" };
const WD = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export default async function Config({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdminPage();
  const sp = await searchParams;
  const tab = sp.aba ?? "parametros";
  const [s, users, zones, log] = await Promise.all([getSettings(), listUsers(), listZones(),
    q<any>(`select a.*, u.name as user_name from draum.audit_log a left join draum.users u on u.id=a.user_id order by a.id desc limit 150`)]);
  return (
    <>
      <PageHeader eyebrow="Administração" title="Configurações" />
      <Tabs current={tab} tabs={[{ key: "parametros", label: "Parâmetros comerciais e financeiros", href: "/configuracoes" }, { key: "usuarios", label: "Usuários e acesso", href: "/configuracoes?aba=usuarios" }, { key: "entregas", label: "Bairros de entrega", href: "/configuracoes?aba=entregas" }, { key: "auditoria", label: "Histórico de alterações", href: "/configuracoes?aba=auditoria" }]} />
      {tab === "parametros" && (
        <ActionForm action={saveSettingsAction} submitLabel="Salvar configurações" className="space-y-6">
          <Section title="Margem e caixa"><div className="card-pad grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Margem de contribuição mínima (%)"><input className="input" name="min_margin_pct" type="number" step="0.1" defaultValue={s.min_margin_pct} /></Field>
            <Field label="Reserva de contingência (%)" hint="Sobre recebimentos não comprometidos."><input className="input" name="contingency_pct" type="number" step="0.1" defaultValue={s.contingency_pct} /></Field>
            <Field label="Reserva de segurança fixa (R$)"><input className="input" name="safety_reserve_fixed" type="number" step="0.01" defaultValue={s.safety_reserve_fixed} /></Field>
            <Field label="Tributos estimados (% da receita)" hint="Ex.: alíquota efetiva do Simples Nacional."><input className="input" name="tax_pct" type="number" step="0.01" defaultValue={s.tax_pct} /></Field>
            <Field label="Embalagem por pedido (R$)"><input className="input" name="packaging_cost" type="number" step="0.01" defaultValue={s.packaging_cost} /></Field>
            <Field label="Custo estimado por entrega local (R$)"><input className="input" name="delivery_cost_estimate" type="number" step="0.01" defaultValue={s.delivery_cost_estimate} /></Field>
          </div></Section>
          <Section title="Taxas por forma de pagamento (%)"><div className="card-pad grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {Object.keys(s.payment_fee_pct).map((k) => <Field key={k} label={PAYMENT_METHODS[k] ?? k}><input className="input" name={`fee_${k}`} type="number" step="0.01" min="0" defaultValue={s.payment_fee_pct[k]} /></Field>)}
          </div></Section>
          <Section title="Pré-venda e entregas"><div className="card-pad grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Field label="Folga mínima após chegada (dias)"><input className="input" name="presale_buffer_days" type="number" min="0" defaultValue={s.presale_buffer_days} /></Field>
            <Field label="Validade da verificação de disponibilidade (dias)"><input className="input" name="availability_valid_days" type="number" min="1" defaultValue={s.availability_valid_days} /></Field>
            <Field label="Capacidade padrão da rota"><input className="input" name="route_capacity_default" type="number" min="1" defaultValue={s.route_capacity_default} /></Field>
            <Field label="Corte — dia"><select className="input" name="cutoff_weekday" defaultValue={s.delivery_cutoff.weekday}>{WD.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></Field>
            <Field label="Corte — hora"><input className="input" name="cutoff_hour" type="number" min="0" max="23" defaultValue={s.delivery_cutoff.hour} /></Field>
          </div></Section>
          <Section title="Metas comerciais (não são dados realizados)"><div className="card-pad grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Membros VIP"><input className="input" name="g_vip" type="number" defaultValue={s.goals.vip_members} /></Field>
            <Field label="Pedidos pagos"><input className="input" name="g_orders" type="number" defaultValue={s.goals.paid_orders} /></Field>
            <Field label="Prazo da meta de pedidos"><input className="input" name="g_deadline" type="date" defaultValue={s.goals.paid_orders_deadline} /></Field>
            <Field label="Ticket médio-alvo (R$)"><input className="input" name="g_ticket" type="number" step="0.01" defaultValue={s.goals.avg_ticket} /></Field>
            <Field label="Faturamento bruto-alvo (R$)"><input className="input" name="g_revenue" type="number" step="0.01" defaultValue={s.goals.gross_revenue} /></Field>
            <Field label="Margem de contribuição-alvo (%)"><input className="input" name="g_margin" type="number" step="0.1" defaultValue={s.goals.contribution_margin_pct} /></Field>
            <Field label="Entregas no prazo (%)"><input className="input" name="g_ontime" type="number" step="0.1" defaultValue={s.goals.on_time_delivery_pct} /></Field>
          </div></Section>
        </ActionForm>
      )}
      {tab === "usuarios" && (
        <div className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
          <Section title="Usuários">
            <table className="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Último acesso</th><th>Status</th><th></th></tr></thead>
              <tbody>{users.map((u) => (
                <tr key={u.id}><td>{u.name}{u.id === me.userId && <span className="chip-neutral ml-2">você</span>}</td><td>{u.email}</td><td>{u.role === "admin" ? "Administrador" : "Operacional"}</td><td className="text-[12px]">{dateTimeBR(u.last_login_at)}</td>
                  <td>{u.active ? <Badge value="ativo" /> : <span className="chip-neutral">inativo</span>}</td>
                  <td className="text-right">{u.id !== me.userId && <div className="flex gap-2 justify-end flex-wrap">
                    <ActionButton action={updateUserAction} fields={{ id: u.id, role: u.role === "admin" ? "operador" : "admin" }} label={u.role === "admin" ? "Tornar operacional" : "Tornar admin"} className="btn-ghost btn-sm" />
                    <ActionButton action={updateUserAction} fields={{ id: u.id, active: String(!u.active) }} label={u.active ? "Desativar" : "Reativar"} className="btn-ghost btn-sm" />
                    <Disclosure label="Nova senha"><ActionForm action={updateUserAction} submitLabel="Definir" submitClass="btn-secondary btn-sm" inline className="flex gap-2"><input type="hidden" name="id" value={u.id} /><input className="input h-7 w-40" name="password" type="password" minLength={10} placeholder="mín. 10 caracteres" /></ActionForm></Disclosure>
                  </div>}</td></tr>))}
              </tbody></table>
            <div className="card-pad border-t border-line text-[12.5px] text-espresso">
              <b>Administrador:</b> tudo, incluindo financeiro, conciliação de pagamentos, reembolsos, pagamento a fornecedores, ajustes de estoque, promoções e configurações. <b>Operacional:</b> produtos, pedidos, pagamentos informados, pré-vendas, compras (sem pagar), estoque (sem ajuste), clientes, entregas e marketing.
            </div>
          </Section>
          <div className="space-y-6">
            <Section title="Novo usuário"><div className="card-pad">
              <ActionForm action={createUserAction} submitLabel="Criar" reset className="space-y-3">
                <Field label="Nome"><input className="input" name="name" required /></Field>
                <Field label="E-mail"><input className="input" name="email" type="email" required /></Field>
                <Field label="Senha inicial (mín. 10)"><input className="input" name="password" type="password" minLength={10} required /></Field>
                <Field label="Perfil"><select className="input" name="role"><option value="operador">Operacional</option><option value="admin">Administrador</option></select></Field>
              </ActionForm>
            </div></Section>
            <Section title="Minha senha"><div className="card-pad">
              <ActionForm action={changePasswordAction} submitLabel="Alterar" reset className="space-y-3">
                <Field label="Senha atual"><input className="input" name="current" type="password" required /></Field>
                <Field label="Nova senha"><input className="input" name="next" type="password" minLength={10} required /></Field>
              </ActionForm>
            </div></Section>
          </div>
        </div>
      )}
      {tab === "entregas" && (
        <div className="grid xl:grid-cols-[1fr_380px] gap-6 items-start">
          <Section title="Bairros configurados">
            {zones.length === 0 ? <p className="card-pad text-muted text-[13px]">Nenhum bairro configurado. Os pedidos só entram no Delivery Day quando o bairro está marcado como elegível.</p> : (
              <table className="table"><thead><tr><th>Bairro</th><th>Elegível</th><th>Observações / exceções</th><th></th></tr></thead>
                <tbody>{zones.map((z) => <tr key={z.id}><td>{z.neighborhood}</td><td>{z.eligible ? <Badge value="ativo" label="sim" /> : <span className="chip-neutral">não</span>}</td><td>{z.notes}</td><td className="text-right"><ActionButton action={deleteZoneAction} fields={{ id: z.id }} label="Remover" className="btn-ghost btn-sm" /></td></tr>)}</tbody></table>
            )}
          </Section>
          <Section title="Adicionar / atualizar bairro"><div className="card-pad">
            <ActionForm action={saveZoneAction} submitLabel="Salvar" reset className="space-y-3">
              <Field label="Bairro (igual ao cadastro do cliente)"><input className="input" name="neighborhood" required /></Field>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="eligible" defaultChecked /> Elegível para entrega gratuita</label>
              <Field label="Observações"><input className="input" name="notes" /></Field>
            </ActionForm>
          </div></Section>
        </div>
      )}
      {tab === "auditoria" && (
        <Section title="Últimas 150 alterações">
          <table className="table text-[12.5px]"><thead><tr><th>Quando</th><th>Usuário</th><th>Entidade</th><th>Ação</th><th>Detalhes</th></tr></thead>
            <tbody>{log.map((l) => <tr key={l.id}><td className="whitespace-nowrap">{dateTimeBR(l.created_at)}</td><td>{l.user_name ?? "sistema"}</td><td>{l.entity} {l.entity_id}</td><td>{l.action}</td><td className="font-mono text-[11px] text-muted max-w-md truncate">{l.data ? JSON.stringify(l.data).slice(0, 160) : ""}</td></tr>)}</tbody></table>
        </Section>
      )}
    </>
  );
}
