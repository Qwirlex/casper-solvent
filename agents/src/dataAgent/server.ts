import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { buildFeed } from "./feed.js";

// The data-agent sells a price feed for the vault asset. On a funded testnet this
// endpoint is gated by x402 so the fund agent must pay a CEP-18 micro fee per call.
// x402 gating is the funded stage upgrade, the loop runs locally without a funded
// chain. See README for the funded path.
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

export function startDataAgent(port: number = PORT): Server {
  const app = express();
  app.get("/feed", (_req, res) => res.json(buildFeed("CSPR", nextQuote(), Date.now())));
  app.get("/health", (_req, res) => res.json({ ok: true, agent: "data-agent" }));
  return app.listen(port, () => console.log(`data-agent listening on ${port}`));
}

// Auto start when run directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) startDataAgent();
