# DRAUM CONTROL — Regras e fórmulas financeiras

> Regra central: **Faturamento ≠ Recebimento ≠ Margem ≠ Lucro ≠ Caixa disponível.**

Toda a lógica abaixo está implementada no servidor (`src/server/finance.ts`, `orders.ts`, `presales.ts`, `delivery.ts`, `pricing.ts`) e coberta pelos testes de `tests/business.test.ts`.

## 1. Conceitos

| Conceito | Definição no sistema |
|---|---|
| **Faturamento bruto** | Σ (quantidade × preço de venda) dos pedidos não cancelados, antes de descontos. |
| **Descontos concedidos** | Σ descontos por item (promoção do pedido **ou** preço promocional do produto — nunca os dois). |
| **Receita após descontos** | Faturamento bruto − descontos. Frete cobrado do cliente não entra. |
| **Pagamento informado** | Comprovante/aviso registrado por qualquer usuário. **Não** é dinheiro no caixa. |
| **Recebimento** | Pagamento **conciliado** por um administrador após conferir o extrato. Só aqui entra no caixa. |
| **CMV** | Σ quantidade × custo unitário dos itens **entregues** no período. Pronta-entrega usa o custo médio ponderado do estoque; pré-venda usa o custo confirmado do fornecedor + frete de aquisição. |
| **Margem de contribuição** | Receita após descontos − CMV − taxa de pagamento − tributos estimados − embalagem − (custo de entrega − frete cobrado). |
| **Resultado operacional estimado** | Margem de contribuição − despesas operacionais (operacional, marketing, embalagens avulsas, outras). Não é lucro contábil. |

## 2. Caixa

```
Saldo de caixa (base conciliada) = Σ entradas conciliadas − Σ todas as saídas registradas
Caixa comprometido               = Σ obrigações abertas
Reserva de contingência          = contingência% × max(0, Σ pedidos em aberto (recebido conciliado − taxas − obrigações abertas ou já pagas do pedido))
Caixa livre estimado             = Saldo − Comprometido − Contingência − Reserva de segurança fixa
```

* Entradas só contam depois de conciliadas; saídas contam assim que registradas (critério conservador).
* A contingência (padrão 10%, configurável) incide **somente sobre a parte não comprometida** de cada pedido em aberto — não há dupla contagem.
* Pedidos finalizados ou cancelados saem da base da contingência.

### Obrigações (caixa comprometido)

| Tipo | Quando nasce | Quando é liquidada |
|---|---|---|
| Mercadoria (pré-venda) | Conciliação total do pedido: custo + frete de aquisição de cada item de pré-venda | Pagamento da compra ao fornecedor que contém o item |
| Tributos estimados | Conciliação total do pedido: tributo% × receita após descontos | Lançamento de recolhimento de tributo (liquida as mais antigas até o valor pago) |
| Entrega local | Conciliação de pedido Delivery Day: custo estimado por entrega | Conclusão da rota com custo real (lançado no caixa e rateado) |
| Reembolso | Cancelamento de pedido pago ou devolução com reembolso | Registro do pagamento do reembolso |
| Conta a pagar | Lançamento manual, ou compra de pré-venda cancelada ainda não paga | Pagamento da conta / da compra |

Cancelamento de pedido cancela as obrigações de mercadoria/tributo/entrega ainda abertas — exceto quando a peça já foi pedida ao fornecedor: a dívida continua (vira conta a pagar da compra) e a peça, ao chegar, entra como estoque livre.

## 3. Regra de financiamento das compras (pré-venda)

1. Só itens de pedidos **pagos e conciliados** podem entrar numa compra.
2. No pagamento ao fornecedor, o sistema soma as obrigações dos itens vinculados (dinheiro já recebido **daqueles** clientes).
3. A diferença (reposição de estoque, frete além do previsto, custo confirmado maior) só pode sair do **caixa livre**. Se o caixa livre não cobrir, o pagamento é bloqueado.
4. Saídas manuais também não podem exceder o caixa livre.

Assim, o recebimento de um cliente nunca financia o pedido de outro.

## 4. Promoções e margem

* Uma promoção por pedido (não cumulativa), validada no servidor: vigência, produtos elegíveis, mínimo de peças, exclusividade VIP e cupom.
* Se o desconto deixar a margem de contribuição estimada abaixo do mínimo (padrão 30%), o pedido é **bloqueado**; somente um administrador pode aprovar a exceção, com justificativa registrada no pedido e na auditoria.

### Simulador de preço

```
Custos fixos por peça  = custo + frete de aquisição + embalagem + entrega
Preço líquido mínimo   = custos fixos ÷ (1 − (taxa% + tributos% + margem desejada%))
Preço de tabela        = preço líquido mínimo ÷ (1 − desconto%)
```

## 5. Parâmetros (Configurações)

Começam zerados de propósito e o sistema exibe alerta até serem preenchidos: **alíquota de tributos, taxas por forma de pagamento, custo de embalagem e custo estimado por entrega**. Enquanto zerados, margem e comprometido ficam otimistas.
