import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const config = {
  node: req("CASPER_NODE"),
  chain: process.env.CASPER_CHAIN ?? "casper-test",
  csprCloudKey: req("CSPR_CLOUD_API_KEY"),
  anthropicKey: req("ANTHROPIC_API_KEY"),
  payTokenHash: req("PAY_TOKEN_HASH"),
  vaultHash: req("VAULT_HASH"),
  agentSecretKey: req("AGENT_SECRET_KEY"),
  dataAgentUrl: process.env.DATA_AGENT_URL ?? "http://localhost:4001",
  riskAgentUrl: process.env.RISK_AGENT_URL ?? "http://localhost:4002",
};
