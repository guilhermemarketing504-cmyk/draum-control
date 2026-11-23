// Agendador interno do robô da MFT pelo servidor (opcional, MFT_AUTO_SYNC=true). O disparo manual fica em Loja online → Sincronizar agora.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startMftScheduler } = await import("./instrumentation-node");
    startMftScheduler();
  }
}
