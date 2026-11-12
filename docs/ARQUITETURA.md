# DRAUM CONTROL — Arquitetura

## Stack e justificativas

| Camada | Escolha | Por quê |
|---|---|---|
| App | **Next.js 15 (App Router) + TypeScript** | Páginas renderizadas no servidor e Server Actions: toda regra de negócio roda no servidor; o navegador nunca fala com o banco. |
| UI | **Tailwind CSS** + componentes próprios, **Recharts**, ícones lineares Lucide | Tokens da identidade DRAUM centralizados em `tailwind.config.ts` e `globals.css`. |
| Banco | **PostgreSQL** (Supabase recomendado) | Transações, constraints e locks reais para estoque e dinheiro. |
| Acesso a dados | `pg` + SQL explícito em uma camada de serviços tipada (`src/server/*`), validação com **zod** | Controle total de `SELECT … FOR UPDATE`, updates condicionais atômicos e transações — essencial para "duas vendas não reservam a mesma unidade". Um ORM esconderia exatamente o que precisa ficar visível. |
| Autenticação | Própria: senha com **bcrypt (12)**, sessão JWT assinada em cookie **httpOnly** (12h), revalidada no banco a cada requisição | Funciona com qualquer Postgres; nenhuma chave do Supabase vai para o frontend. Desativar um usuário corta o acesso na hora. |
| Testes | **Vitest** (integração contra Postgres real) + **Puppeteer** (E2E em Chrome) | — |

**Ajuste em relação à sugestão do briefing:** o Supabase é usado como Postgres gerenciado (backups, painel, SSL), não pelo SDK/Auth no navegador. As tabelas ficam no schema `draum` (fora do schema `public` exposto pela API REST do Supabase) e com **RLS habilitado sem políticas**: mesmo que a chave anônima vaze, ela não lê nada.

## Estrutura

```
db/migrations/        SQL versionado (schema, configuração inicial, fuso)
scripts/              migrate.ts · create-admin.ts · backup.sh
src/server/           regras de negócio (sem dependência de React)
  core.ts             erros, contexto/perfil, datas em America/Belem, configurações, auditoria
  inventory.ts        reserva atômica, liberação, baixa, entrada com custo médio, ajustes
  products.ts         produtos, variantes/SKU, fornecedores por produto, importação CSV
  pricing.ts          margem de contribuição, promoções, simulador
  orders.ts           pedidos, pagamentos/conciliação, embalagem, retirada/envio, cancelamento, reembolso, troca/devolução
  presales.ts         pré-vendas, risco de atraso, lista de compras, compras a fornecedor, recebimento parcial
  finance.ts          posição de caixa, obrigações, lançamentos, indicadores
  delivery.ts         Delivery Day: corte de quinta 18h, elegibilidade, rotas, comprovantes, custo real
  crm.ts / funnel.ts  clientes, funil, consentimentos, contatos, mensagens WhatsApp, CSV, LGPD
  marketing.ts        campanhas, promoções, embaixadoras (envios baixam estoque)
  dashboard.ts        indicadores e séries a partir dos registros
  reports.ts          13 relatórios CSV
src/app/              páginas (app)/…, server actions (actions/), API de relatórios e health
tests/                integração (14 cenários obrigatórios + extras)
e2e/                  teste ponta a ponta no navegador
```

## Modelo de dados (principais relações)

```
products 1─N product_variants (SKU único) 1─1 inventory
products N─N suppliers  (product_suppliers: custo, frete, prazo, disponibilidade verificada em)
customers 1─N orders 1─N order_items (mode pronta|pre, status próprio por item)
orders 1─N payments (informado → conciliado) · 1─N refunds · order_items 1─N returns
order_items(pre) 1─1 purchase_order_items N─1 purchase_orders N─1 suppliers
orders 1─N obligations (caixa comprometido) · cash_entries (caixa efetivo)
delivery_routes 1─N delivery_stops 1─N delivery_stop_items → order_items
campaigns / ambassadors ← orders (atribuição: cupom | link | registro explícito)
stock_movements, funnel_events, contact_log, audit_log: históricos auditáveis
```

## Garantias de consistência

* **Estoque:** `CHECK (qty_reserved <= qty_physical)` e quantidades ≥ 0 no banco; reserva via `UPDATE … WHERE físico − reservado >= qtd` (atômico). Testado com 5 vendas simultâneas da última peça: exatamente 1 sucesso.
* **Pedido:** `CHECK total = subtotal − desconto + frete`; item com `CHECK total = qtd × preço − desconto`; pré-venda exige fornecedor e condições aceitas (constraint).
* **Duplicidade:** chave de idempotência por formulário de pedido; identificador de transação de pagamento não se repete.
* **Transações:** cada operação de negócio roda em uma única transação; erro = nada gravado.
* **Auditoria:** toda alteração relevante grava usuário, entidade, ação e dados em `audit_log` (visível em Configurações → Histórico).

## Perfis

| Ação | Admin | Operacional |
|---|:-:|:-:|
| Produtos, clientes, pedidos, pré-vendas, compras (criar/enviar/receber), entregas, marketing | ✓ | ✓ |
| Informar pagamento (comprovante) | ✓ | ✓ |
| Conciliar pagamento, pagar fornecedor, pagar reembolso, cancelar pedido pago | ✓ | — |
| Ajuste de estoque, promoções, financeiro, configurações, usuários, fluxo de caixa | ✓ | — |
| Aprovar exceção de margem | ✓ | — |

## Segurança e LGPD

* Senhas com bcrypt; bloqueio temporário após 5 tentativas por e-mail; cookie httpOnly/SameSite; cabeçalhos anti-clickjacking.
* Segredos apenas em variáveis de ambiente do servidor (`DATABASE_URL`, `SESSION_SECRET`).
* Consentimento de WhatsApp/e-mail registrado com data e origem; envio só com consentimento; importação CSV exige confirmação de autorização.
* Exclusão a pedido do titular: remove os dados pessoais (ou anonimiza, se houver pedidos, preservando a contabilidade).
* O sistema não acessa participantes de grupos do WhatsApp; integração com a API oficial fica como pendente.
