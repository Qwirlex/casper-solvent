import dotenv from "dotenv";

// Load secrets from .env.testnet by default, which is gitignored. Override with ENV_FILE.
dotenv.config({ path: process.env.ENV_FILE ?? ".env.testnet" });

// Config is permissive so the loop runs locally with no testnet env. Live mode,
// CASPER_LIVE=1, expects node, vault hash, and the agent key to be set. The brain
// uses Gemini through application default credentials, no api key field needed.
export const config = {
  live: process.env.CASPER_LIVE === "1",
  node: process.env.CASPER_NODE ?? "",
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
};
