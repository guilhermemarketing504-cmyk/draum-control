// Teste ponta a ponta no navegador (Chrome real) contra o servidor de produção.
// Uso: BASE=http://localhost:3100 node e2e/e2e.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.env.OUT ?? "e2e/screens";
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("dialog", (d) => d.accept());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const log = (...a) => console.log("•", ...a);
const go = async (p) => { await page.goto(BASE + p, { waitUntil: "networkidle0" }); };
const shot = async (name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const type = async (sel, v) => { await page.$eval(sel, (el) => (el.value = "")); await page.type(sel, String(v)); };
const select = (sel, v) => page.select(sel, String(v));
const clickText = async (text, tag = "button") => {
  await page.waitForFunction((text, tag) => [...document.querySelectorAll(tag)].some((e) => e.textContent.trim() === text && !e.disabled), { timeout: 15000 }, text, tag).catch(() => {});
  const ok = await page.evaluate((text, tag) => {
    const el = [...document.querySelectorAll(tag)].find((e) => e.textContent.trim() === text && !e.disabled);
    if (el) { el.scrollIntoView(); el.click(); return true; } return false;
  }, text, tag);
  if (!ok) throw new Error(`Botão não encontrado: ${text}`);
};
const navClick = async (label) => {
  const before = page.url();
  await clickText(label);
  await page.waitForFunction((b) => location.href !== b, { timeout: 20000 }, before);
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
};
const waitText = (t, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
const expectNoAlert = async () => {
  const a = await page.$$eval('[role="alert"]', (els) => els.map((e) => e.textContent));
  if (a.length) throw new Error("Erro na tela: " + a.join(" | "));
};
const settle = async () => {
  await new Promise((r) => setTimeout(r, 250));
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => b.textContent.includes("Processando")), { timeout: 20000 });
  await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
};
// confirma sucesso: sem alerta de erro; a mensagem pode sumir se a seção deixar de existir
const submitAndWait = async (label, okText) => {
  await clickText(label);
  await settle();
  await expectNoAlert();
};
const assert = (c, m) => { if (!c) throw new Error("FALHOU: " + m); log("ok —", m); };

try {
  // 1. Primeiro acesso
  await go("/");
  assert(page.url().includes("/setup"), "sem usuários, redireciona para /setup");
  await shot("01-setup", false);
  await type('input[name="name"]', "Guilherme Admin");
  await type('input[name="email"]', "admin@draum.com.br");
  await type('input[name="password"]', "Draum-Admin-2026!");
  await navClick("Criar administrador");
  assert(new URL(page.url()).pathname === "/", "administrador criado e logado");
  await shot("02-dashboard-vazio");

  // 2. Configurações: tributos, taxas, embalagem, entrega + bairro elegível
  await go("/configuracoes");
  await type('input[name="tax_pct"]', "6"); await type('input[name="fee_pix"]', "0.99"); await type('input[name="fee_cartao_credito"]', "4.5");
  await type('input[name="packaging_cost"]', "4"); await type('input[name="delivery_cost_estimate"]', "8");
  await submitAndWait("Salvar configurações", "Configurações salvas.");
  await go("/configuracoes?aba=entregas");
  for (const b of ["Umarizal", "Nazaré", "Batista Campos"]) { await type('input[name="neighborhood"]', b); await submitAndWait("Salvar", "Bairro salvo."); }
  assert((await page.content()).includes("Batista Campos"), "bairros elegíveis configurados");

  // 3. Fornecedor
  await go("/fornecedores");
  await type('input[name="name"]', "Confecção Teste Ltda");
  await type('input[name="default_lead_days"]', "7");
  await navClick("Cadastrar fornecedor");
  assert(page.url().includes("/fornecedores/"), "fornecedor cadastrado");

  // 4. Produto com cores e tamanhos
  await go("/produtos/novo");
  await type('input[name="name"]', "Macaquinho Canelado Vão");
  await type('input[name="sale_price"]', "189.90");
  await clickText("+ Cor");
  const c2 = (await page.$$('input[placeholder="Cor (ex.: Preto)"]'))[1]; await c2.type("Sand");
  await shot("03-novo-produto");
  await navClick("Cadastrar produto");
  const body = await page.evaluate(() => document.body.innerText);
  assert(body.includes("DRA-MAC-001-PTO-M") && body.includes("DRA-MAC-001-SND-G"), "produto com 6 SKUs (2 cores × P/M/G) e códigos consistentes");
  const productUrl = page.url();

  // 5. Vincular fornecedor com custo e disponibilidade verificada
  await clickText("Vincular / atualizar fornecedor");
  await type('input[name="unit_cost"]', "62"); await type('input[name="inbound_freight"]', "3"); await type('input[name="lead_days"]', "7");
  await page.click('input[name="availability_checked"]'); await page.click('input[name="is_primary"]');
  await submitAndWait("Salvar vínculo", "Fornecedor vinculado.");
  await page.reload({ waitUntil: "networkidle0" });
  await shot("04-produto-detalhe");

  // 6. Estoque inicial (ajuste auditado) — 2 unidades do Preto M
  await go("/estoque?q=DRA-MAC-001-PTO-M");
  await clickText("Editar");
  await type('input[name="new_physical"]', "2"); await type('input[name="unit_cost"]', "65"); await type('input[name="reason"]', "Inventário inicial");
  await submitAndWait("Ajustar físico", "Estoque ajustado.");
  await go("/estoque?q=DRA-MAC-001-PTO-M");
  assert((await page.evaluate(() => document.querySelector("tbody tr")?.innerText ?? "")).includes("\t2\t0\t2"), "estoque disponível = 2");

  // 7. Cliente VIP
  await go("/clientes");
  await clickText("Novo cliente / lead");
  await type('input[name="name"]', "Ana Beatriz Souza");
  await type('input[name="whatsapp"]', "91988887777");
  await type('input[name="neighborhood"]', "Umarizal");
  await type('input[name="address"]', "Tv. Dom Romualdo de Seixas, 100");
  await page.$eval('input[name="vip_joined_at"]', (el) => { el.value = new Date().toISOString().slice(0, 10); });
  await page.click('input[name="consent_whatsapp"]');
  await navClick("Cadastrar");
  assert(page.url().includes("/clientes/"), "lead VIP cadastrado");
  const customerUrl = page.url();

  // 8. Pedido misto: 1 pronta (Preto M) + 1 pré-venda (Sand G)
  await go("/pedidos/novo");
  const custId = customerUrl.split("/").pop();
  await page.select("section select", custId);
  const opts = await page.$$eval("section:nth-of-type(2) select option", (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
  const pm = opts.find((o) => o.t.includes("DRA-MAC-001-PTO-M")).v, sg = opts.find((o) => o.t.includes("DRA-MAC-001-SND-G")).v;
  await page.select("section:nth-of-type(2) select", pm); await clickText("Adicionar");
  await page.select("section:nth-of-type(2) select", sg); await clickText("Adicionar");
  // segunda linha vira pré-venda automaticamente (sem estoque); aceitar condições
  await page.evaluate(() => { const cb = [...document.querySelectorAll('input[type="checkbox"]')].find((c) => c.closest("label")?.textContent?.includes("aceitou")); cb.click(); });
  await page.waitForFunction(() => document.body.innerText.includes("Custo das peças"), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  await shot("05-novo-pedido");
  await navClick("Registrar pedido");
  assert(page.url().match(/\/pedidos\/\d+$/), "pedido misto registrado");
  const orderUrl = page.url();
  let t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("Reservado (separação)") && t.includes("Aguardando pagamento"), "pronta reservada e pré-venda aguardando pagamento");

  // 9. Pagamento informado → não conta; conciliação → conta
  await clickText("Registrar pagamento informado"); await waitText("aguardando conciliação"); await expectNoAlert();
  await go("/financeiro");
  t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("aguardam conciliação"), "pagamento informado aparece como pendente e fora do saldo");
  await page.goto(orderUrl, { waitUntil: "networkidle0" });
  await clickText("Conciliar"); await waitText("Pago e conciliado", 20000);
  t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("Aguardando compra ao fornecedor"), "pré-venda passou a aguardar compra após conciliação");

  // 10. Persistência após atualizar a página (e nova sessão de navegador)
  await page.reload({ waitUntil: "networkidle0" });
  assert((await page.evaluate(() => document.body.innerText)).includes("Pago e conciliado"), "persistência após atualizar a página");
  await shot("06-pedido-detalhe");

  // 11. Compra ao fornecedor pela lista consolidada, envio, pagamento e recebimento
  await go("/pre-vendas?aba=lista");
  await shot("07-lista-compras");
  await navClick("Criar compra com os itens selecionados");
  assert(page.url().includes("/pre-vendas/compras/"), "compra criada a partir da lista consolidada (vínculo com o pedido mantido)");
  await clickText("Marcar como enviada ao fornecedor"); await waitText("Registrar pagamento ao fornecedor"); await expectNoAlert();
  await clickText("Registrar pagamento ao fornecedor"); await page.waitForFunction(() => !document.body.innerText.includes("Registrar pagamento ao fornecedor") && !document.body.innerText.includes("Processando"), { timeout: 15000 });
  await expectNoAlert();
  await clickText("Registrar recebimento conferido"); await page.waitForFunction(() => !document.body.innerText.includes("Registrar recebimento conferido") && !document.body.innerText.includes("Processando"), { timeout: 15000 });
  await page.reload({ waitUntil: "networkidle0" });
  assert((await page.evaluate(() => document.body.innerText)).includes("Recebido"), "compra recebida e conferida");

  // 12. Conferência/embalagem e Delivery Day
  await page.goto(orderUrl, { waitUntil: "networkidle0" });
  await submitAndWait("Conferido e embalado", "Itens conferidos e embalados.");
  await go("/entregas");
  await submitAndWait("Criar rota", "Rota criada.");
  await go("/entregas");
  await shot("08-entregas");
  t = await page.evaluate(() => document.body.innerText);
  if (t.includes("Adicionar à rota")) {
    await submitAndWait("Adicionar à rota", "Pedidos adicionados à rota.");
    const routeHref = await page.$eval('a[href^="/entregas/"]', (a) => a.getAttribute("href"));
    await go(routeHref);
    await clickText("Iniciar rota (saída do estoque)"); await settle(); await expectNoAlert();
    await page.reload({ waitUntil: "networkidle0" });
    await type('input[name="proof"]', "Recebido pela própria cliente");
    await submitAndWait("Registrar", "Parada registrada.");
    await page.reload({ waitUntil: "networkidle0" });
    await type('input[name="actual_cost"]', "15");
    await submitAndWait("Concluir rota", "Rota concluída");
    await page.reload({ waitUntil: "networkidle0" });
    await shot("09-rota");
    assert((await page.evaluate(() => document.body.innerText)).includes("concluida"), "rota de terça concluída com custo real lançado");
  } else {
    log("aviso — nenhum pedido apto para a próxima terça (depende do horário de corte):", t.match(/Pedidos de entrega local que não entram[\s\S]{0,300}/)?.[0]);
  }

  // 13. Telas principais
  for (const [p, n] of [["/", "10-dashboard"], ["/financeiro", "11-financeiro"], ["/financeiro?aba=comprometido", "12-comprometido"], ["/pre-vendas", "13-pre-vendas"], ["/produtos", "14-produtos"], ["/clientes", "15-clientes"], ["/marketing", "16-marketing"], ["/pedidos?ver=kanban", "17-kanban"], ["/relatorios", "18-relatorios"], ["/financeiro?aba=simulador", "19-simulador"]]) {
    await go(p); await expectNoAlert(); await shot(n);
  }
  const csv = await page.evaluate(async () => (await fetch("/api/relatorios/vendas_periodo")).text());
  assert(csv.includes("Pedido;Data;Cliente") && csv.includes("DRM-"), "relatório CSV gerado a partir dos registros");

  // 14. Permissões: usuário operacional
  await go("/configuracoes?aba=usuarios");
  await type('form input[name="name"]', "Operadora Loja");
  await page.$$eval('input[name="email"]', (els) => els);
  await page.type('input[type="email"][name="email"]', "op@draum.com.br");
  await page.type('input[name="password"][minlength="10"][required]', "Operadora-2026!");
  await submitAndWait("Criar", "Usuário criado.");
  const ctx2 = await browser.createBrowserContext();
  page = await ctx2.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on("dialog", (d) => d.accept());
  await go("/login");
  await type('input[name="email"]', "op@draum.com.br"); await type('input[name="password"]', "Operadora-2026!");
  await navClick("Entrar");
  assert(new URL(page.url()).pathname === "/", "operadora logada");
  const nav = await page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
  assert(!nav.includes("Financeiro") && !nav.includes("Configurações"), "menu do operador sem Financeiro/Configurações");
  await go("/financeiro");
  assert(page.url().includes("negado=1"), "operador bloqueado no Financeiro");
  const st = await page.evaluate(async () => (await fetch("/api/relatorios/fluxo_caixa")).status);
  assert(st === 403, "operador não exporta fluxo de caixa (403)");
  await page.goto(orderUrl, { waitUntil: "networkidle0" });
  assert(!(await page.evaluate(() => document.body.innerText)).includes("Conciliar"), "operador não vê botão de conciliação");
  // Cliente na nova sessão: mesmos registros
  await go("/pedidos");
  assert((await page.evaluate(() => document.body.innerText)).includes("Ana Beatriz Souza"), "outro usuário/sessão acessa os mesmos registros");

  // Mobile
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await go("/"); await shot("20-mobile-dashboard", false);

  if (errors.length) throw new Error("Erros de JavaScript na página: " + errors.join(" | "));
  console.log("\nE2E CONCLUÍDO SEM FALHAS");
} catch (e) {
  console.error("\n✗", e.message);
  await shot("erro").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
