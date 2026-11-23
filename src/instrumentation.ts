// Agendador interno do robô da MFT: roda a cada 3 horas no servidor de produção (1 réplica no Railway).
// Desligue com MFT_AUTO_SYNC=false. O disparo manual fica em Loja online → Sincronizar agora.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMftScheduler } = await import("./instrumentation-node");
    startMftScheduler();
  }
}
