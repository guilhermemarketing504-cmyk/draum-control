import { PageHeader, Section, Alert } from "@/components/ui";
import { ActionForm, Field } from "@/components/forms";
import { importCustomersAction } from "@/app/actions/crm";
export const metadata = { title: "Importar contatos" };
const SAMPLE = "nome;whatsapp;instagram;email;cidade;bairro;preferencias;tamanhos;origem;data_vip;consentimento_whatsapp;consentimento_email";
export default function Importar() {
  return (
    <>
      <PageHeader eyebrow="Clientes" title="Importar contatos (CSV)" />
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Arquivo"><div className="card-pad">
          <Alert tone="info">Importe apenas contatos que autorizaram o cadastro pela DRAUM. Contatos sem a coluna de consentimento entram sem permissão de mensagens.</Alert>
          <ActionForm action={importCustomersAction} submitLabel="Importar" className="mt-4">
            <Field label="Arquivo CSV"><input className="input pt-1.5" type="file" name="file" accept=".csv,text/csv" required /></Field>
            <label className="flex items-start gap-2 mt-4 text-[13px]"><input type="checkbox" name="authorized" className="mt-1" /> Confirmo que os contatos deste arquivo autorizaram o cadastro e o contato pela DRAUM.</label>
          </ActionForm>
        </div></Section>
        <Section title="Colunas aceitas"><div className="card-pad text-[13px] space-y-3">
          <pre className="font-mono text-[11.5px] bg-offwhite p-3 overflow-x-auto">{SAMPLE}</pre>
          <p><b>origem</b>: instagram, indicacao, whatsapp, embaixadora, evento, site ou outro. <b>data_vip</b> no formato AAAA-MM-DD. Consentimentos: sim/não.</p>
          <p>WhatsApp já cadastrado é ignorado (sem duplicar).</p>
          <a className="link" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE + "\n")}`} download="modelo-contatos-draum.csv">Baixar modelo</a>
        </div></Section>
      </div>
    </>
  );
}
