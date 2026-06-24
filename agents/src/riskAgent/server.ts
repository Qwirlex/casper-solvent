import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { buildRisk } from "./risk.js";
import type { Feed } from "../shared/types.js";

// The risk-agent sells a risk score derived from a feed. On a funded testnet this
// endpoint is gated by x402, the same pattern as the data-agent.
const PORT = Number(process.env.RISK_AGENT_PORT ?? 4002);

export function startRiskAgent(port: number = PORT): Server {
  const app = express();
  app.get("/risk", (req, res) => {
    const changePct24h = Number(req.query.changePct24h ?? 0);
    const price = Number(req.query.price ?? 0);
    const feed: Feed = { asset: "CSPR", price, changePct24h, ts: Date.now() };
    res.json(buildRisk(feed));
  });
  app.get("/health", (_req, res) => res.json({ ok: true, agent: "risk-agent" }));
  return app.listen(port, () => console.log(`risk-agent listening on ${port}`));
}

// Auto start when run directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) startRiskAgent();
