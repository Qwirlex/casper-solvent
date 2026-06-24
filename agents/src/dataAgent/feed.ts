import type { Feed } from "../shared/types.js";

export function buildFeed(asset: string, quote: { last: number; prev: number }, ts: number): Feed {
  const changePct24h = quote.prev === 0 ? 0 : ((quote.last - quote.prev) / quote.prev) * 100;
  return { asset, price: quote.last, changePct24h, ts };
}
