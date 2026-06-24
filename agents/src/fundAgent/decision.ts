import type { RiskScore, Decision } from "../shared/types.js";

// Bounded mapping from risk to allocation. The growth weight falls as risk rises.
export function decideAllocation(risk: RiskScore): Decision {
  const growth = Math.max(0, Math.min(100, 100 - risk.score));
  const conservative = 100 - growth;
  const decisionRef = `risk-${risk.score}-growth-${growth}`;
  return {
    allocation: { conservative, growth },
    decisionRef,
    reason: `risk ${risk.score}, ${risk.rationale}`,
  };
}
