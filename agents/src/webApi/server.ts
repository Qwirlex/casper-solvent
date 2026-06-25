import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "../shared/config.js";
import { VaultReader } from "../shared/vaultReader.js";

// Depositor registry, a small file the agent reads to know whom to accrue yield to.
// The dApp posts an address after a deposit. No enumeration on chain needed.
const DEPOSITORS_FILE = process.env.DEPOSITORS_FILE ?? "./depositors.json";
function readDepositors(): string[] {
  try {
    if (!existsSync(DEPOSITORS_FILE)) return [];
    const a = JSON.parse(readFileSync(DEPOSITORS_FILE, "utf8"));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function addDepositor(account: string): void {
  const list = readDepositors();
  if (!list.includes(account)) {
    list.push(account);
    writeFileSync(DEPOSITORS_FILE, JSON.stringify(list, null, 2));
  }
}

// Public read API for the dApp. The browser cannot read Casper state directly, the
// public node sends no CORS headers and the authenticated node needs a secret key. So
// this small server reads vault state server side over the public node and exposes it
// with CORS. Put it behind the site at /api with a Caddy reverse_proxy. It is read
// only, it holds no keys, it never signs or submits anything.
const PORT = Number(process.env.WEB_API_PORT ?? 4090);

export function startWebApi(port: number = PORT): Server {
  const app = express();
  const reader = new VaultReader({ node: config.readNode, packageHash: config.vaultHash });

  // Permissive CORS, this endpoint is public read only except the depositor register.
  app.use((_req, res, next) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("cache-control", "no-store");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "web-api" }));

  // Register a depositor so the agent accrues yield to them. Harmless if spammed, the
  // agent only accrues to addresses that actually hold a principal.
  app.post("/api/depositor", (req, res) => {
    const account = String(req.body?.account ?? "").trim();
    if (!/^0[12][0-9a-fA-F]{64,66}$/.test(account) && !account.startsWith("account-hash-")) {
      return res.status(400).json({ error: "bad account" });
    }
    addDepositor(account);
    res.json({ ok: true });
  });
  app.get("/api/depositors", (_req, res) => res.json(readDepositors()));

  app.get("/api/vault", async (_req, res) => {
    try {
      res.json(await reader.summary());
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/shares/:account", async (req, res) => {
    try {
      const pos = await reader.position(req.params.account);
      res.json({ account: req.params.account, deposited: pos.deposited, earned: pos.earned, value: pos.value });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Status of a transaction, used by the dApp to gate the deposit on the approval
  // confirming. CSPR.cloud indexes by hash, deploy or version 1. Returns executed and
  // success once it has run, error carries a revert reason.
  app.get("/api/tx/:hash", async (req, res) => {
    const hash = req.params.hash.replace(/[^0-9a-fA-F]/g, "");
    if (!config.csprCloudKey) return res.json({ executed: false, note: "no api key" });
    for (const path of [`deploys/${hash}`, `transactions/${hash}`]) {
      try {
        const r = await fetch(`https://api.testnet.cspr.cloud/${path}`, {
          headers: { authorization: config.csprCloudKey },
        });
        if (!r.ok) continue;
        const body: any = await r.json();
        const d = body.data ?? body;
        if (d && d.error_message !== undefined) {
          return res.json({ executed: true, success: !d.error_message, error: d.error_message ?? null });
        }
      } catch {
        // try next path
      }
    }
    return res.json({ executed: false });
  });

  return app.listen(port, () => console.log(`web-api listening on ${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startWebApi();
