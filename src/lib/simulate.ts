const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
class SimError extends Error {}

/** Simulador: preço de venda necessário para atingir a margem desejada após desconto */
export function simulatePrice(i: {
  pieceCost: number; inboundFreight: number; packaging: number; feePct: number; taxPct: number;
  deliveryCost: number; discountPct: number; targetMarginPct: number; currentPrice?: number;
}) {
  const fixed = i.pieceCost + i.inboundFreight + i.packaging + i.deliveryCost;
  const variablePct = (i.feePct + i.taxPct + i.targetMarginPct) / 100;
  if (variablePct >= 1) throw new SimError("Taxas + tributos + margem desejada somam 100% ou mais: não existe preço viável.");
  const netNeeded = fixed / (1 - variablePct);                       // preço efetivo após desconto
  const listPrice = i.discountPct >= 100 ? Infinity : netNeeded / (1 - i.discountPct / 100);
  const evalAt = (price: number) => {
    const net = price * (1 - i.discountPct / 100);
    const m = net - fixed - net * (i.feePct + i.taxPct) / 100;
    return { net: round2(net), margin: round2(m), marginPct: net > 0 ? round2((m / net) * 100) : 0 };
  };
  return {
    fixedCosts: round2(fixed),
    minNetPrice: round2(netNeeded),
    suggestedListPrice: round2(listPrice),
    atCurrent: i.currentPrice ? evalAt(i.currentPrice) : null,
    maxDiscountAtCurrentPct: i.currentPrice
      ? Math.max(0, round2((1 - fixed / (1 - (i.feePct + i.taxPct + i.targetMarginPct) / 100) / i.currentPrice) * 100))
      : null,
  };
}

