import { PageHeader, Section } from "@/components/ui";
import { ActionForm, Field } from "@/components/forms";
import { importProductsAction } from "@/app/actions/products";
export const metadata = { title: "Importar produtos" };
const SAMPLE = "nome;categoria;descricao;preco_venda;preco_promocional;modalidade;cor;codigo_cor;tamanho;imagem_url;codigo_produto";
export default function Importar() {
  return (
    <>
      <PageHeader eyebrow="Produtos" title="Importar produtos (CSV)" description="Uma linha por variante (cor + tamanho). Linhas com o mesmo nome viram um único produto." />
      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Arquivo">
          <div className="card-pad">
            <ActionForm action={importProductsAction} submitLabel="Importar">
              <Field label="Arquivo CSV (separador ; ou ,)"><input className="input pt-1.5" type="file" name="file" accept=".csv,text/csv" required /></Field>
              <label className="flex items-center gap-2 mt-4 text-[13px]"><input type="checkbox" name="dry" defaultChecked /> Apenas validar (não grava nada)</label>
            </ActionForm>
          </div>
        </Section>
        <Section title="Modelo de colunas">
          <div className="card-pad text-[13px] space-y-3">
            <pre className="font-mono text-[11.5px] bg-offwhite p-3 overflow-x-auto">{SAMPLE}</pre>
            <p><b>categoria</b>: macaquinhos, macacoes, tops, leggings, shorts, conjuntos, camisetas, casaquinhos ou outras.</p>
            <p><b>modalidade</b>: pronta, pre ou ambas. <b>preco_venda</b> aceita vírgula decimal.</p>
            <p>Estoques e custos não são importados aqui: custos entram no vínculo com fornecedor e o estoque físico entra por recebimento de compra ou ajuste auditado.</p>
            <a className="link" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE + "\n")}`} download="modelo-produtos-draum.csv">Baixar modelo vazio</a>
          </div>
        </Section>
      </div>
    </>
  );
}
