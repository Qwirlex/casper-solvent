import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { buildRisk } from "./risk.js";
import type { Feed } from "../shared/types.js";
import { config } from "../shared/config.js";
import { x402Gate } from "../shared/x402Gate.js";

// The risk-agent sells a risk score derived from a feed. The /risk route is gated by
// x402, the same handshake as the data-agent.
const PORT = Number(process.env.RISK_AGENT_PORT ?? 4002);

export interface RiskAgentOptions {
  asset?: string;
  payTo?: string;
  price?: string;
}

export function startRiskAgent(port: number = PORT, opts: RiskAgentOptions = {}): Server {
  const app = express();
  const asset = opts.asset ?? config.payTokenHash;
  const payTo = opts.payTo ?? config.riskAgentAccount;
  const price = opts.price ?? config.x402Price;

  const handler = (req: express.Request, res: express.Response) => {
    const changePct24h = Number(req.query.changePct24h ?? 0);
    const price = Number(req.query.price ?? 0);
    const feed: Feed = { asset: "CSPR", price, changePct24h, ts: Date.now() };
    res.json(buildRisk(feed));
  };

  if (asset && payTo) {
    app.get(
      "/risk",
      x402Gate({ asset, payTo, amount: price, tokenName: config.tokenName, tokenVersion: config.tokenVersion, resource: "risk-agent score" }),
      handler,
    );
  } else {
    app.get("/risk", handler);
  }
  app.get("/health", (_req, res) => res.json({ ok: true, agent: "risk-agent" }));
  return app.listen(port, () => console.log(`risk-agent listening on ${port}`));
}

// Auto start when run directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) startRiskAgent();
