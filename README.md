# DRAUM CONTROL

**The Business Behind the Movement.** Central de gestão comercial da DRAUM: produtos e variantes, estoque, pedidos, pré-vendas, compras a fornecedores, financeiro de caixa e margem, DRAUM Delivery Day, CRM do DRAUM PRIVATE ACCESS, marketing, embaixadoras e relatórios, tudo num único banco de dados.

---

## Situação desta entrega

**Implementado e verificado**

* 12 módulos funcionais, com persistência em PostgreSQL, autenticação e dois perfis (administrador e operacional).
* `npm test`: 20 testes de integração contra PostgreSQL real, incluindo os 14 cenários obrigatórios: venda com e sem estoque, disputa simultânea pela última unidade, pedido misto, pré-venda paga, compra ao fornecedor, recebimento parcial, cancelamento com reembolso, troca e devolução, desconto sem margem, entrega de terça, caixa comprometido, persistência e permissões.
* `npm run test:e2e`: fluxo completo no Chrome, contra o build de produção. Vai do primeiro acesso a produto com variantes, estoque, lead VIP, pedido misto, pagamento informado e depois conciliado, compra, recebimento, embalagem, rota de terça concluída, exportação CSV e bloqueios do perfil operacional.
* Backup e restauração testados: o banco restaurado bate com o original.

**Pendente: depende de credenciais ou contratos externos**

| Item | Situação |
|---|---|
| API oficial do WhatsApp Business | Não integrada. Hoje o sistema abre a conversa (wa.me) e gera mensagens para copiar e enviar. Não acessa participantes de grupos. |
| Gateway de pagamento / extrato bancário | Sem integração automática. A conciliação é feita manualmente pelo administrador, conferindo o extrato. |
| PDF nativo | Os relatórios saem em CSV. Para PDF, use a tela do relatório e *Imprimir → Salvar como PDF*. |
| Dados reais da DRAUM | Nenhum custo, estoque, fornecedor ou cliente foi inventado. Cadastre-os ou importe por CSV. Taxas, tributos, embalagem e custo de entrega começam zerados, e o sistema mostra um alerta até serem configurados. |

---

## 1. Executar localmente

Requisitos: Node.js 20+ e um PostgreSQL 14+ (local ou Supabase).

```bash
npm install
cp .env.example .env.local      # preencha DATABASE_URL e SESSION_SECRET
npm run db:migrate              # cria o schema "draum" e a configuração inicial
npm run dev                     # http://localhost:3000
```

No primeiro acesso, o sistema abre **/setup** para criar o administrador principal. Essa tela só funciona enquanto não houver nenhum usuário.

Gere o `SESSION_SECRET` com `openssl rand -base64 48`.

## 2. Banco no Supabase

1. Crie um projeto em supabase.com, na região **South America (São Paulo)**.
2. Abra *Project Settings → Database → Connection string* e copie a string **Session pooler** (porta 5432) ou **Direct connection**. Evite o modo *Transaction* (porta 6543).
3. No seu computador, com `DATABASE_URL` apontando para o Supabase e `DATABASE_SSL=true`, rode `npm run db:migrate`.
4. As tabelas ficam no schema `draum`, que não é exposto pela API pública do Supabase, e com RLS ativo. Não é preciso configurar políticas nem usar as chaves `anon` ou `service_role`.

## 3. Publicar na Vercel

1. Envie o projeto para um repositório no GitHub e importe-o na Vercel (framework: Next.js).
2. Em *Settings → Environment Variables*, cadastre:
   * `DATABASE_URL`: a string do Supabase
   * `DATABASE_SSL`: `true`
   * `SESSION_SECRET`: segredo longo e aleatório
   * `DATABASE_POOL_MAX`: `3` (opcional, recomendado em serverless)
3. Faça o deploy e acesse `/setup` para criar o administrador.
4. Monitoramento: `GET /api/health` responde `{"ok":true}` quando o banco está acessível.

Alternativa sem Vercel: qualquer servidor Node com `npm run build && npm start`.

## 4. Backup e recuperação

* **Supabase:** os backups diários automáticos já vêm incluídos no projeto. No plano Pro existe também recuperação para um ponto no tempo.
* **Backup manual:** `npm run db:backup` gera `backups/draum-AAAAMMDD-HHMM.sql.gz`, com o schema `draum` e o controle de migrações. Recomendo rodar antes de cada lançamento e guardar uma cópia fora do computador.
* **Restaurar:** `gunzip -c backups/arquivo.sql.gz | psql "$DATABASE_URL"`
* **Recuperar acesso** (se perder a senha do administrador): `npm run db:create-admin -- "Nome" email@dominio.com "nova-senha-forte"`

## 5. Primeiros passos de uso

1. **Configurações → Parâmetros:** alíquota de tributos, taxas de Pix e cartão, embalagem e custo por entrega. As metas de lançamento já vêm com os números do briefing.
2. **Configurações → Bairros de entrega:** cadastre os bairros de Belém atendidos pelo Delivery Day.
3. **Fornecedores:** cadastre os fornecedores com quem trabalha ou está cotando.
4. **Produtos:** cadastre cada modelo e gere as variantes (cor × tamanho). O SKU segue o padrão `DRA-MAC-001-PTO-M`. Depois, em cada produto, vincule os fornecedores com custo, frete e prazo, e marque **Confirmei hoje** quando o fornecedor confirmar a disponibilidade. Sem essa confirmação, a pré-venda é bloqueada.
5. **Estoque:** registre o inventário inicial das peças que você já tem, com custo, usando *Editar → Ajustar físico* (só administrador; fica auditado).
6. **Clientes e Grupo VIP:** cadastre os leads com consentimento, ou importe um CSV autorizado.
7. **Marketing → Promoções:** confira as datas das promoções iniciais (10% VIP, 12% para duas peças, 20% na Black Friday) e **escolha os produtos da Black Friday**, que começam sem seleção.

### Rotina de um pedido

Novo pedido → registrar o pagamento informado (comprovante) → **administrador concilia** com o extrato → para pré-venda: *Pré-vendas → Lista de compras* → criar a compra → enviar ao fornecedor → pagar → receber e conferir → no pedido: *Conferido e embalado* → *Entregas*: rota de terça → iniciar rota → baixa com comprovante → concluir com o custo real.

## 6. Importação CSV

* **Produtos** (*Produtos → Importar CSV*): uma linha por variante, com a opção *Apenas validar* antes de gravar. O modelo pode ser baixado na própria tela.
* **Contatos** (*Clientes → Importar CSV*): exige confirmar que os contatos autorizaram o cadastro. WhatsApp que já existe não é duplicado.

Arquivos com separador `;` ou `,` são aceitos. Os CSVs exportados usam `;` e abrem direto no Excel em português.

## 7. Testes

```bash
# integração: recria o banco de teste a partir das migrações
TEST_DATABASE_URL=postgresql://usuario@localhost:5432/draum_test npm test

# ponta a ponta: servidor rodando em um banco VAZIO + Google Chrome instalado
npm run build && DATABASE_URL=… SESSION_SECRET=… npx next start -p 3100
BASE=http://localhost:3100 CHROME=/caminho/do/chrome npm run test:e2e
```

## 8. Identidade visual

Os tokens vêm dos arquivos oficiais (Prancha visual, Rota 01 — O Vão): Preto Mineral `#252624`, Grafite `#3B3B38`, Espresso `#584F49`, Stone `#A89C8B`, Sand `#D8CFC2` e Off-white `#F3F0E8`. Tipografia: Archivo Expanded nos títulos, Inter no texto e IBM Plex Mono nos rótulos técnicos, todas hospedadas no próprio app. O logotipo e o símbolo foram vetorizados do arquivo oficial e estão em `public/brand/`. Tudo fica centralizado em `tailwind.config.ts` e `src/app/globals.css`.

Os gráficos seguem a paleta neutra da marca. Como ela não tem cor de destaque, séries diferentes se distinguem por tom (Preto Mineral × Stone) **e** por traço (linha contínua × tracejada), sempre com legenda e valores no tooltip.

## 9. Documentação técnica

* `docs/REGRAS_FINANCEIRAS.md`: fórmulas de caixa, comprometido, contingência, margem e a regra de financiamento das compras.
* `docs/ARQUITETURA.md`: stack, modelo de dados, garantias de consistência, perfis, segurança e LGPD.

### Limitações conhecidas

* O bloqueio por tentativas de login fica na memória do servidor. Na Vercel, ele vale por instância e funciona como proteção básica. Para algo mais rígido, use um limitador externo (por exemplo, Upstash).
* O fuso horário é America/Belem, fixado no banco (migração 003) e na conexão.
* O sistema registra o custo real das rotas e das compras, mas ainda não emite nota fiscal.
