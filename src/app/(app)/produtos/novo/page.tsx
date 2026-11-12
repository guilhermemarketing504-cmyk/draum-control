import { PageHeader } from "@/components/ui";
import { NewProductForm } from "@/components/ProductForm";
export const metadata = { title: "Novo produto" };
export default function NovoProduto() {
  return (<><PageHeader eyebrow="Produtos" title="Novo produto" description="Defina os dados comerciais e gere as variantes de cor e tamanho. Custos e fornecedores são vinculados na próxima tela." /><NewProductForm /></>);
}
