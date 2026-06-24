import { describe, it, expect, vi } from "vitest";
import { payAndGet } from "../src/fundAgent/x402Client.js";

describe("payAndGet", () => {
  it("returns the json body after a successful paid fetch", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ asset: "CSPR", price: 0.02, changePct24h: 1, ts: 1 }),
    })) as unknown as typeof fetch;
    const body = await payAndGet("http://x/feed", fakeFetch);
    expect(body.price).toBe(0.02);
  });

  it("throws when the paid fetch fails", async () => {
    const fakeFetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(payAndGet("http://x/feed", fakeFetch)).rejects.toThrow();
  });
});
