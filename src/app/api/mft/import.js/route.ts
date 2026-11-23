// Script de leitura do catálogo da MFT que roda no navegador do revendedor (aberto pelo favorito "DRAUM · Atualizar MFT").
// Ele roda dentro do site da MFT, já logado, lê peças, cores, tamanhos, estoque, fotos e o preço de revenda,
// e envia tudo para o CONTROL. Nada é enviado para outro lugar.
export const dynamic = "force-static";

const SCRIPT = String.raw`(() => {
  if (window.__draumRunning) return;
  const cfg = window.__DRAUM || {};
  if (!/mftmoodrevenda\.com\.br$/.test(location.hostname)) { alert("Abra o site da MFT (mftmoodrevenda.com.br) e clique no favorito de novo."); return; }
  if (!cfg.endpoint || !cfg.token) { alert("Favorito desatualizado. Pegue o favorito de novo em DRAUM CONTROL → Loja online."); return; }
  window.__draumRunning = true;
  const CATS = ["conjunto-calca","conjunto-short","calca","short","macaquito","macacao","blusa","top","acessorios"];
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;background:#252624;color:#F3F0E8;font:13px/1.5 system-ui,sans-serif;padding:16px 18px;border-radius:4px;box-shadow:0 8px 30px rgba(0,0,0,.35)";
  box.innerHTML = '<div style="font:10px/1 monospace;letter-spacing:.14em;color:#A89C8B;margin-bottom:8px">DRAUM · ATUALIZAR MFT</div><div id="dr-msg">Começando…</div><div style="height:3px;background:#3B3B38;margin-top:10px"><div id="dr-bar" style="height:3px;width:0;background:#D8CFC2"></div></div>';
  document.body.appendChild(box);
  const msg = (t) => (box.querySelector("#dr-msg").textContent = t);
  const bar = (p) => (box.querySelector("#dr-bar").style.width = Math.round(p * 100) + "%");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function getDoc(path) {
    for (let i = 1; ; i++) {
      const r = await fetch(path, { credentials: "include", cache: "no-store" });
      if ((r.status === 429 || r.status >= 500) && i < 5) { await sleep(5000 * i); continue; }
      if (!r.ok) throw new Error("MFT respondeu " + r.status + " em " + path);
      const ct = r.headers.get("content-type") || "";
      const html = new TextDecoder(/utf-?8/i.test(ct) ? "utf-8" : "windows-1252").decode(await r.arrayBuffer());
      return { html, doc: new DOMParser().parseFromString(html, "text/html") };
    }
  }
  const money = (s) => { if (!s) return null; const m = s.replace(/\s/g, "").match(/R\$([\d.]+,\d{2})/); return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null; };
  (async () => {
    const listed = new Map(); const errors = []; let logged = false;
    for (let ci = 0; ci < CATS.length; ci++) {
      for (let page = 1; page <= 10; page++) {
        msg("Lendo vitrines: " + CATS[ci] + "…"); bar((ci / CATS.length) * 0.1);
        const { doc } = await getDoc("/" + CATS[ci] + "/?page=" + page);
        const its = [...doc.querySelectorAll(".item[data-id]")];
        for (const it of its) {
          const a = it.querySelector("a.foto_wrapper") || it.querySelector("a[href]");
          const slug = (a && a.getAttribute("href") || "").replace(/^\/+|\/+$/g, "");
          if (!slug || slug.startsWith("login") || slug.includes("?") || listed.has(slug)) continue;
          const de = money(it.querySelector(".valor_de .vlr") && it.querySelector(".valor_de .vlr").textContent);
          const fin = money(it.querySelector(".valor_final") && it.querySelector(".valor_final").textContent) || money(it.querySelector(".valor") && it.querySelector(".valor").textContent);
          const cost = de || fin;
          if (cost) logged = true;
          const h3 = it.querySelector("h3.produto");
          listed.set(slug, { slug, name: (h3 && (h3.getAttribute("title") || h3.textContent) || "").trim(), category: CATS[ci], cost });
        }
        if (its.length < 100) break;
        await sleep(300);
      }
    }
    const all = [...listed.values()];
    if (!logged && !confirm("Você não parece estar logado na MFT: os custos não serão atualizados (só fotos, cores e estoque). Continuar mesmo assim?")) { box.remove(); window.__draumRunning = false; return; }
    const items = [];
    for (let i = 0; i < all.length; i++) {
      const l = all[i];
      msg("Lendo peças: " + (i + 1) + " de " + all.length); bar(0.1 + (i / all.length) * 0.85);
      try {
        const { html, doc } = await getDoc("/" + l.slug + "/");
        const idm = html.match(/var produto_id\s*=\s*'(\d+)'/);
        if (!idm) throw new Error("sem identificador");
        const byColor = {}; const images = [];
        doc.querySelectorAll("a.fancybox[data-fancybox-group]").forEach((a) => {
          const href = a.getAttribute("href") || a.getAttribute("data-standard");
          if (!href || !/^https:\/\//.test(href) || images.includes(href)) return;
          const cor = (a.getAttribute("data-fancybox-group") || "").split("-")[2] || "";
          images.push(href); (byColor[cor] = byColor[cor] || []).push(href);
        });
        const colors = [];
        doc.querySelectorAll(".cor.mt").forEach((sw) => {
          const block = sw.parentElement; const prim = sw.querySelector(".cor_primaria");
          const id = prim && prim.getAttribute("data-cor"); if (!id) return;
          const name = ((prim.getAttribute("data-cornome")) || (block.querySelector(".variacao_cor_nome") || {}).textContent || "Única").trim();
          const hexm = (prim.getAttribute("style") || "").match(/#([0-9a-f]{3,8})/i);
          const sizes = [...block.querySelectorAll(".vars .it")].map((it) => {
            const inp = it.querySelector("input");
            return { size: (((it.querySelector(".t") || {}).textContent || it.getAttribute("title") || "U").split(" - ")[0]).trim(), stock: parseInt(inp && inp.getAttribute("max") || "0", 10) || 0, sku: inp && inp.getAttribute("data-sku") || "" };
          }).filter((z) => z.sku);
          if (sizes.length) colors.push({ id, name, hex: hexm ? hexm[0] : null, sizes, images: byColor[id] || [] });
        });
        const info = doc.querySelector("section.info_wrapper");
        let description = null;
        if (info) {
          info.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
          info.querySelectorAll("p,li,h1,h2,h3,h4,div").forEach((e) => e.append("\n"));
          description = info.textContent.split("\n").map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").replace(/^Sobre o produto\s*/i, "").trim() || null;
        }
        items.push({ slug: l.slug, name: l.name, category: l.category, cost: l.cost, externalId: idm[1], description, images, colors });
      } catch (e) { errors.push(l.slug + ": " + e.message); }
      await sleep(250);
    }
    msg("Enviando para o DRAUM CONTROL…"); bar(0.97);
    const r = await fetch(cfg.endpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ token: cfg.token, items, total: all.length, errors }) });
    const out = await r.json().catch(() => ({}));
    bar(1);
    if (!r.ok || !out.ok) { msg("Erro: " + (out.error || ("HTTP " + r.status))); box.style.background = "#8B3A2F"; }
    else msg("Pronto! " + out.seen + " peças atualizadas (" + out.created + " novas, " + out.paused + " pausadas)" + (out.costs ? ", custos atualizados." : ".") + " Pode fechar esta aba.");
    window.__draumRunning = false;
  })().catch((e) => { msg("Erro: " + e.message); box.style.background = "#8B3A2F"; window.__draumRunning = false; });
})();`;

export function GET() {
  return new Response(SCRIPT, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" },
  });
}
