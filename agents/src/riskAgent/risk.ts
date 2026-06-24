import type { Feed, RiskScore } from "../shared/types.js";

export function buildRisk(feed: Feed): RiskScore {
  const vol = Math.min(Math.abs(feed.changePct24h), 25);
  const score = Math.round((vol / 25) * 100);
  const rationale = `24h move ${feed.changePct24h.toFixed(2)} percent maps to risk ${score}`;
  return { score, rationale };
}
