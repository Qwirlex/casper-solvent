import { describe, it, expect } from "vitest";
import { decideAllocation } from "../src/fundAgent/decision.js";

describe("decideAllocation", () => {
  it("tilts conservative when risk is high", () => {
    const d = decideAllocation({ score: 90, rationale: "x" });
    expect(d.allocation.conservative).toBeGreaterThanOrEqual(80);
    expect(d.allocation.conservative + d.allocation.growth).toBe(100);
  });
  it("tilts growth when risk is low", () => {
    const d = decideAllocation({ score: 10, rationale: "x" });
    expect(d.allocation.growth).toBeGreaterThanOrEqual(60);
    expect(d.allocation.conservative + d.allocation.growth).toBe(100);
  });
  it("always returns a non empty decisionRef", () => {
    const d = decideAllocation({ score: 50, rationale: "x" });
    expect(d.decisionRef.length).toBeGreaterThan(0);
  });
});
