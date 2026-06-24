import { describe, it, expect } from "vitest";
import { buildFeed } from "../src/dataAgent/feed.js";

describe("buildFeed", () => {
  it("returns a feed for the asset with a numeric price", () => {
    const feed = buildFeed("CSPR", { last: 0.02, prev: 0.019 }, 1000);
    expect(feed.asset).toBe("CSPR");
    expect(feed.price).toBe(0.02);
    expect(feed.changePct24h).toBeCloseTo(5.263, 2);
    expect(feed.ts).toBe(1000);
  });

  it("reports zero change when prev equals last", () => {
    const feed = buildFeed("CSPR", { last: 0.02, prev: 0.02 }, 5);
    expect(feed.changePct24h).toBe(0);
  });
});
