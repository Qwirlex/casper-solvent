import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { buildFeed } from "./feed.js";
import { config } from "../shared/config.js";
import { x402Gate } from "../shared/x402Gate.js";

// The data-agent sells a price feed for the vault asset. The /feed route is gated by
// x402, the fund agent must present a signed CEP-18 payment authorization to read it.
// The handshake runs locally too, the signature is real, only the on chain
// settlement needs a funded chain. See README for the funded path.
const PORT = Number(process.env.DATA_AGENT_PORT ?? 4001);

// A lightly moving quote so successive cycles differ. Deterministic drift, no RNG.
let tick = 0;
function nextQuote(): { last: number; prev: number } {
  tick += 1;
  const base = 0.02;
  const prev = base + Math.sin(tick / 3) * 0.001;
  const last = base + Math.sin((tick + 1) / 3) * 0.001;
  return { last: Number(last.toFixed(6)), prev: Number(prev.toFixed(6)) };
}

export interface DataAgentOptions {
  asset?: string;
  payTo?: string;
  price?: string;
}

export function startDataAgent(port: number = PORT, opts: DataAgentOptions = {}): Server {
  const app = express();
  const asset = opts.asset ?? config.payTokenHash;
  const payTo = opts.payTo ?? config.dataAgentAccount;
  const price = opts.price ?? config.x402Price;

  // Gate the feed when an asset and a recipient are configured. Without them the
  // route stays open so a bare checkout still runs.
  if (asset && payTo) {
    app.get(
      "/feed",
      x402Gate({ asset, payTo, amount: price, tokenName: config.tokenName, tokenVersion: config.tokenVersion, resource: "data-agent price feed" }),
      (_req, res) => res.json(buildFeed("CSPR", nextQuote(), Date.now())),
    );
  } else {
    app.get("/feed", (_req, res) => res.json(buildFeed("CSPR", nextQuote(), Date.now())));
  }
  app.get("/health", (_req, res) => res.json({ ok: true, agent: "data-agent" }));
  return app.listen(port, () => console.log(`data-agent listening on ${port}`));
}

// Auto start when run directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) startDataAgent();
