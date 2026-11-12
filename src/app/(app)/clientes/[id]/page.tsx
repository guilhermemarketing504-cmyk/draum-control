import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer, messageTemplates } from "@/server/crm";
import { listCampaigns, listAmbassadors } from "@/server/marketing";
import { FUNNEL, stageLabel } from "@/server/funnel";
import { ORDER_STATUS } from "@/server/orders";
import { requireSession } from "@/lib/auth";
import { PageHeader, Section, Badge, Empty, Alert } from "@/components/ui";
import { ActionForm, ActionButton, Field } from "@/components/forms";
import { CustomerForm } from "@/components/CustomerForm";
import { CopyMessage } from "@/components/CopyMessage";
import { setStageAction, logContactAction, deleteCustomerAction } from "@/app/actions/crm";
import { brl, dateBR, dateTimeBR } from "@/lib/format";

export default async function Cliente({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const [d, campaigns, ambassadors, user] = await Promise.all([getCustomer(id), listCampaigns(), listAmbassadors(), requireSession()]);
  if (!d) notFound();
  const c = d.customer;
  return (
    <>
      <PageHeader eyebrow="Clientes" title={c.name} description={`${stageLabel(c.funnel_stage)} · ${d.orders.length} pedido(s) · ${brl(d.spent)} comprados`}
        actions={<Link className="btn-primary" href={`/pedidos/novo?cliente=${c.id}`}>Novo pedido</Link>} />
      <div className="grid xl:grid-cols-[1fr_420px] gap-6 items-start">
        <div className="space-y-6">
          <Section title="Pedidos">
            {d.orders.length === 0 ? <Empty title="Ainda sem pedidos" /> : (
              <table className="table"><thead><tr><th>Pedido</th><th>Data</th><th className="text-right">Total</th><th>Status</th></tr></thead>
                <tbody>{d.orders.map((o: any) => <tr key={o.id}><td><Link className="hover:underline" href={`/pedidos/${o.id}`}>{o.number}</Link></td><td>{dateBR(o.created_at)}</td><td className="text-right num">{brl(o.total)}</td><td><Badge value={o.status} label={ORDER_STATUS[o.status]} /></td></tr>)}</tbody></table>
            )}
          </Section>
          <Section title="Mensagens prontas para WhatsApp">
            <div className="card-pad">
              {!c.consent_whatsapp && <div className="mb-3"><Alert>Esta pessoa não registrou consentimento para mensagens. O botão de envio fica desativado; registre a autorização no cadastro primeiro.</Alert></div>}
              <div className="grid md:grid-cols-2 gap-3">{messageTemplates(c.name).map((t) => <CopyMessage key={t.key} label={t.label} text={t.text} phone={c.whatsapp} canSend={c.consent_whatsapp} />)}</div>
            </div>
          </Section>
          <Section title="Histórico de contatos">
            <div className="card-pad border-b border-line">
              <ActionForm action={logContactAction} submitLabel="Registrar contato" reset className="grid sm:grid-cols-[160px_1fr] gap-3">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Canal"><select className="input" name="channel"><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="email">E-mail</option><option value="telefone">Telefone</option><option value="presencial">Presencial</option></select></Field>
                <Field label="Resumo"><input className="input" name="note" placeholder="Enviada oferta de pré-venda do macaquinho preto" /></Field>
              </ActionForm>
            </div>
            {d.contacts.length === 0 ? <Empty title="Nenhum contato registrado" /> : (
              <ul className="divide-y divide-line">{d.contacts.map((x: any) => <li key={x.id} className="px-5 py-3 text-[13px]"><span className="label mr-3">{x.channel}</span>{x.note}<div className="text-[11.5px] text-muted mt-0.5">{dateTimeBR(x.created_at)} · {x.user_name}</div></li>)}</ul>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Etapa no funil">
            <div className="card-pad">
              <ActionForm action={setStageAction} submitLabel="Atualizar etapa" className="flex gap-2 items-end">
                <input type="hidden" name="id" value={c.id} />
                <select className="input" name="stage" defaultValue={c.funnel_stage}>{FUNNEL.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
              </ActionForm>
              <p className="text-[12px] text-muted mt-3">Pedido iniciado, compra, pós-venda e recompra avançam automaticamente pelos pedidos.</p>
              <ol className="mt-4 space-y-1 text-[12px]">{d.events.map((e: any) => <li key={e.id} className="flex justify-between"><span>{stageLabel(e.stage)}</span><span className="text-muted">{dateTimeBR(e.created_at)}</span></li>)}</ol>
            </div>
          </Section>
          <Section title="Cadastro"><div className="card-pad"><CustomerForm c={c} campaigns={campaigns} ambassadors={ambassadors} /></div></Section>
          {user.role === "admin" && (
            <Section title="Dados pessoais (LGPD)">
              <div className="card-pad text-[12.5px] text-espresso space-y-3">
                <p>Atende a pedidos de exclusão. Clientes com pedidos são anonimizados (nome, contatos e endereço removidos) para preservar a contabilidade.</p>
                <ActionButton action={deleteCustomerAction} fields={{ id: c.id }} label="Excluir / anonimizar dados" className="btn-danger btn-sm" confirm="Esta ação remove os dados pessoais e não pode ser desfeita. Continuar?" />
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
