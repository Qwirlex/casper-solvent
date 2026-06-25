import dotenv from "dotenv";

// Load secrets from .env.testnet by default, which is gitignored. Override with ENV_FILE.
dotenv.config({ path: process.env.ENV_FILE ?? ".env.testnet" });

// Config is permissive so the loop runs locally with no testnet env. Live mode,
// CASPER_LIVE=1, expects node, vault hash, and the agent key to be set. The brain
// uses Gemini through application default credentials, no api key field needed.
export const config = {
  live: process.env.CASPER_LIVE === "1",
  node: process.env.CASPER_NODE ?? "",
  // Public read node for state queries, no auth, no CORS issue server side.
  readNode: process.env.CASPER_READ_NODE ?? "https://node.testnet.casper.network/rpc",
  chain: process.env.CASPER_CHAIN ?? "casper-test",
  csprCloudKey: process.env.CSPR_CLOUD_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  gcpProject: process.env.GOOGLE_CLOUD_PROJECT ?? "project-2e209fc7-df34-4bcc-925",
  payTokenHash: process.env.PAY_TOKEN_HASH ?? "",
  vaultHash: process.env.VAULT_HASH ?? "",
  agentSecretKey: process.env.AGENT_SECRET_KEY ?? "./keys/agent/secret_key.pem",
  dataAgentUrl: process.env.DATA_AGENT_URL ?? "http://localhost:4001",
  riskAgentUrl: process.env.RISK_AGENT_URL ?? "http://localhost:4002",
  dataAgentAccount: process.env.DATA_AGENT_ACCOUNT ?? "",
  riskAgentAccount: process.env.RISK_AGENT_ACCOUNT ?? "",
  // Treasury account, holds CSPR and sUSD for the swap. Defaults to the agent account.
  treasuryAccount:
    process.env.TREASURY_ACCOUNT ??
    "c9c6b8f622cbeee77fca9e6e5d3f739f30e4116a1f5c41f6ccf2e0ddedb84383",
  // Swap rate, sUSD per 1 CSPR, and the sell fee in basis points.
  buyRate: Number(process.env.BUY_RATE ?? 10),
  sellFeeBps: Number(process.env.SELL_FEE_BPS ?? 1000), // 10 percent
  // x402 fee per service call, atomic units of the pay token at 9 decimals, 1 sUSD.
  x402Price: process.env.X402_PRICE ?? "1000000000",
  // EIP-712 token domain identity, must agree across the client and the server.
  tokenName: process.env.X402_TOKEN_NAME ?? "Solvent USD",
  tokenVersion: process.env.X402_TOKEN_VERSION ?? "1",
};
