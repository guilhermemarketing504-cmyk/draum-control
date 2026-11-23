// Agendador interno do robô da MFT (somente no runtime Node.js). Ver src/instrumentation.ts.
export function startMftScheduler() {
  // Desligado por padrão: a MFT não entrega o catálogo para servidores fora do Brasil. Ligue com MFT_AUTO_SYNC=true.
  if (process.env.NODE_ENV !== "production" || process.env.MFT_AUTO_SYNC !== "true") return;
  const g = globalThis as unknown as { __mftTimer?: boolean };
  if (g.__mftTimer) return;
  g.__mftTimer = true;
  const every = Number(process.env.MFT_SYNC_HOURS ?? 3) * 3600_000;
  const run = async () => {
    try {
      const { syncMft } = await import("./server/mft");
      const { getSettings } = await import("./server/core");
      if (!(await getSettings()).store.mft_enabled) return;
      const r = await syncMft(null);
      console.log(`[mft] sincronização: ${r.seen} peças, ${r.created} novas, ${r.paused} pausadas, ${r.errors.length} erros`);
    } catch (e) {
      console.error("[mft] falha na sincronização automática:", (e as Error).message);
    }
  };
  setTimeout(run, 90_000);
  setInterval(run, every);
}
