import { describe, it, expect } from "vitest";
import { buildRisk } from "../src/riskAgent/risk.js";

describe("buildRisk", () => {
  it("scores high risk when 24h move is large", () => {
    const r = buildRisk({ asset: "CSPR", price: 0.02, changePct24h: 20, ts: 1 });
    expect(r.score).toBeGreaterThanOrEqual(70);
  });
  it("scores low risk when 24h move is small", () => {
    const r = buildRisk({ asset: "CSPR", price: 0.02, changePct24h: 1, ts: 1 });
    expect(r.score).toBeLessThanOrEqual(30);
  });
});
