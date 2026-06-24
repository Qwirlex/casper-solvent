# Solvent design spec

Date 2026-06-24. Target Casper Agentic Buildathon 2026 Qualification Round, deadline 2026-06-30. Author working solo, no marketing or media reach.

## One line

Solvent is an autonomous fund agent on Casper that runs an on chain DeFi vault and pays its own way. To make each allocation decision it autonomously buys a price feed and a risk score from other agents over x402, then executes a rebalance on chain. It earns a performance fee as x402 income. The name carries two meanings, the agent keeps the vault solvent and it stays solvent itself by earning more than it spends.

## Why this wins

Casper is the first WebAssembly native chain with live x402 payments and it positions itself as the trust layer for the agent economy. The jury is Casper leadership and Web3 investors. The project that best shows a working agent economy on chain scores highest on Innovation and on Use of Agentic Systems. Solvent is the clearest demonstration of an agent as a real economic actor that earns and spends value autonomously, which is exactly the Casper thesis and something that only makes sense on a chain with native x402.

Mapping to the eight final judging criteria:
- Technical Execution. Two Rust contracts and three Node services with tests.
- Innovation and Originality. An agent that funds its own operation through machine to machine payments.
- Use of AI and Agentic Systems. A Claude driven agent that perceives, decides, and acts, and hires other agents.
- Real World Applicability in DeFi and RWA. An autonomous managed vault, the asset can be an RWA backed token.
- User Experience and Design. A dashboard that shows the live economic loop with explorer links.
- Working Smart Contracts on Casper Testnet. A vault and a CEP-18 token deployed and called on casper-test.
- Long Term Launch Plans. A light launch, open source repo, one social account, a roadmap.
- Potential for Long Term Impact. A pattern other builders can reuse, autonomous self funding services on Casper.

## Constraints

- Six day build window, qualification deadline 2026-06-30.
- Testnet only, no real money. Casper gas comes from the free faucet, 1000 CSPR. The only real spend is a few dollars of Claude API for the agent brain.
- No marketing and no media. The plan does not rely on community votes on CSPR.fans. It wins through the builder merit path that needs a working testnet prototype with a transaction producing on chain component, then through the professional jury.
- Solo builder.
- Stack split. Rust and Odra for contracts, which is new for the author. Node and TypeScript for the agents and frontend, which reuses prior experience building a paid callable agent.

## Architecture

Five units, each with one clear job and a defined interface.

### Unit 1, vault contract

Odra Rust contract deployed on casper-test. Holds deposits of the pay-token, tracks each depositor share, lets the fund agent set the target allocation and rebalance, and skims a performance fee.

Entry points:
- deposit, a depositor moves pay-token in and receives shares.
- withdraw, a depositor burns shares and receives pay-token back.
- set_allocation, agent only, records the target split the agent decided.
- rebalance, agent only, moves the internal book to the target and records the decision reference.
- harvest_fee, agent only, moves the performance fee to the agent account.
- views, balance_of, total_assets, current_allocation, last_decision.

Access control. Only the registered agent account can call set_allocation, rebalance, and harvest_fee. The depositor functions are open.

Allocation semantics. The vault holds a single pay-token and records a target split across a fixed set of named strategy buckets, for example conservative and growth, each with a weight that sums to one hundred. set_allocation and rebalance change that on chain split and store the decision reference. This makes the rebalance a real on chain state change without needing live multi asset liquidity on testnet. Actual asset swaps across protocols are deferred to the final round.

This is on chain transaction type one.

### Unit 2, pay-token contract

A CEP-18 test token on casper-test. One token serves two roles to keep the build small, it is the asset deposited into the vault and the currency the agent pays with over x402. The author mints a supply to the demo accounts. This token is the settlement asset for x402, since Casper x402 settles in a CEP-18 token through a transfer_with_authorization deploy.

### Unit 3, service agents

Two small Node services built with Express and the @make-software/casper-x402 package, each an x402 resource server.
- data-agent, returns a price or RWA reference feed for the vault asset.
- risk-agent, returns a risk score for the current allocation or market state.

Each request returns HTTP 402 with payment requirements first. The caller signs an EIP-712 authorization and retries. The facilitator verifies the signature and submits a CEP-18 transfer_with_authorization on casper-test, then the service returns the data. Every paid call is a real on chain settlement.

This is on chain transaction type two, the x402 economy.

### Unit 4, fund agent

A Node service driven by Claude, the hero unit. One decision cycle:
1. Read vault state and market state through the Casper MCP testnet endpoint.
2. Buy a fresh feed from data-agent over x402.
3. Buy a risk score from risk-agent over x402.
4. Ask Claude for a target allocation given the feed, the risk score, and the vault state, with a bounded action set.
5. Sign and submit set_allocation and rebalance to the vault using a Casper signer.
6. Periodically call harvest_fee, which is the agent income side of the loop.
7. Log the full loop, money in, money out, decision, and transaction hashes.

The agent is autonomous within bounds. It can only choose among a fixed allocation set, it cannot move funds out to arbitrary addresses, and every action lands on chain where it can be audited. The principle is that the agent acts on its own but stays inside guardrails the contract enforces.

### Unit 5, dashboard

A minimal web page that reads the chain and the agent log and shows the live loop, the agent balance, x402 payments out, fees in, the current allocation, and the latest decisions, each with a link to the transaction on the testnet explorer at cspr.live. This covers the user experience criterion and carries the demo video.

## Data flow and on chain proof

User deposits pay-token into the vault. The fund agent wakes on a timer or a button, reads state through MCP, pays data-agent and risk-agent over x402 which each settle a CEP-18 transfer on chain, asks Claude for a target, then signs and submits a rebalance to the vault on chain. The dashboard reflects each step. There are two distinct on chain transaction types on casper-test, the vault rebalance and the x402 CEP-18 transfers, which exceeds the single transaction producing component the rules require.

## Tech stack and exact tooling

- Contracts. Odra Rust. Build with cargo odra build -b casper. Deploy with casper-client put-transaction session against chain-name casper-test. Reference odra.dev/docs/backends/casper, developer.casper.network/odra-tutorials, and odra.dev/llms.txt for AI assisted generation.
- x402. The @make-software/casper-x402 TypeScript package with the Express facilitator, server, and client demos from github.com/make-software/casper-x402, configured for testnet through its .env.testnet. Signing through casper-eip-712.
- Chain reads. Casper MCP testnet at https://mcp.testnet.cspr.cloud/mcp with a CSPR_CLOUD_API_KEY.
- Signing. The CSPR.click AI Agent Skill or a direct Casper SDK signer for the agent account.
- Agent brain. Claude latest through the Anthropic API.
- Frontend. A small Node or static web app.
- Faucet. The Casper testnet faucet for the 1000 CSPR gas budget.

## Scope for the qualification round, YAGNI

In scope:
- One vault contract, one CEP-18 token, both on casper-test.
- Two service agents behind x402.
- One fund agent that completes the full earn, hire, decide, act loop at least once live.
- A minimal dashboard with explorer links.
- A README, a demo video, and a public repo.

Deferred to the final round if Solvent advances:
- A real RWA backed asset and oracle for the vault.
- A larger swarm of specialized agents that hire one another.
- A subscriber market where many depositors pay the agent over x402.
- A mainnet path.

## Error handling and principles

- The agent never invents a transfer. If the feed or risk call fails it skips the cycle and logs the reason rather than guessing.
- If a deploy fails the agent surfaces the node error verbatim and does not retry blindly.
- The contract enforces the guardrails, the agent account cannot withdraw depositor funds, only rebalance within the book and take a capped fee.
- Bounded autonomy, the agent chooses among a fixed allocation set, not arbitrary actions.

## Testing strategy

- Contract tests in the Odra test harness, deposit, withdraw, share math, access control on the agent only functions, and the fee cap.
- Unit tests for the fund agent decision builder, given a feed and a risk score it produces a valid bounded allocation.
- Unit tests for the x402 client, it pays and retries correctly against a stub server.
- One scripted end to end run on casper-test that performs a deposit, a full agent cycle with two x402 payments, and a rebalance, then prints the transaction hashes.

## Risks and mitigations

- Odra and Rust are new for the author. Mitigation, keep the contracts tiny, lean on odra.dev/llms.txt and AI assisted generation, and copy the Odra CEP-18 and counter examples as the starting point.
- The x402 facilitator demo may expect a local NCTL node in infra/. Mitigation, run the facilitator against testnet through .env.testnet, and if needed run a minimal facilitator that still submits real CEP-18 transfers on casper-test.
- Six days is tight. Mitigation, the qualification bar is only a working testnet prototype with an on chain component, so land the loop once live early, then polish.
- Tooling maturity. Mitigation, prove each external piece with a tiny spike before wiring it in, the faucet, a single Odra deploy, a single x402 payment, and a single MCP read.

## Launch plan, light and without marketing

- Public open source repo with an MIT license and a clear README.
- One social account for the project with the pitch and the demo link.
- A short roadmap document, the path from the testnet prototype to an RWA backed vault, a service agent market, and mainnet.
- The demo video doubles as the public explainer.

No paid promotion, no media outreach, no dependence on community votes.

## Deliverables checklist

- Working prototype deployed on casper-test with a transaction producing on chain component, satisfied by the vault and the x402 CEP-18 transfers.
- Public repo with a README that documents setup and usage.
- A public demo video with a walkthrough.

## Out of scope

- Mainnet deployment.
- Real custody of real funds.
- A marketing campaign.
- Multi chain support.
