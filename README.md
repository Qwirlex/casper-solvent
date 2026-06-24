# Solvent

An autonomous fund agent on Casper that runs an on chain vault and pays its own way.

To make each allocation decision the agent buys a price feed and a risk score from
other agents over the x402 payment protocol, then submits a rebalance to the vault on
Casper testnet. It earns a performance fee as x402 income. The name carries two
meanings, the agent keeps the vault solvent and it stays solvent itself by earning
more than it spends.

Built for the Casper Agentic Buildathon 2026.

## Why Casper

Casper is the first WebAssembly native chain with live x402 payments, and it positions
itself as the trust layer for the agent economy. Solvent is a working demonstration of
an agent as a real economic actor that earns and spends value autonomously on chain.
This only makes sense on a chain with native x402.

## How it works

One decision cycle:

1. The fund agent reads the vault and the market through CSPR.cloud.
2. It buys a price feed from the data agent over x402, a real CEP-18 micro payment.
3. It buys a risk score from the risk agent over x402, another micro payment.
4. A bounded decision function picks the target allocation, and Gemini narrates it.
5. The agent signs and submits a rebalance to the vault on Casper testnet.
6. It periodically harvests a capped performance fee, the income side of the loop.

Every step lands on chain and can be audited. The agent acts on its own but inside
guardrails the contract enforces. It can only choose among a fixed allocation set and
it can never move depositor funds to an arbitrary address.

## Architecture

Five units.

- `contracts/src/vault.rs`, an Odra Rust vault. Depositors hold shares. The agent sets
  the allocation across named strategy buckets and skims a capped fee. The agent only
  functions are guarded by an access check.
- `contracts/src/pay_token.rs`, a CEP-18 test token used both as the vault asset and as
  the x402 settlement currency.
- `agents/src/dataAgent`, a service that sells a price feed behind x402.
- `agents/src/riskAgent`, a service that sells a risk score behind x402.
- `agents/src/fundAgent`, the hero agent that runs the loop, with a bounded decision
  function, a Gemini narrator, an x402 paying client, and the chain glue.
- `dashboard/`, a page that shows the live economic loop with links to the testnet
  explorer.

## Tech stack

- Rust with Odra 2.8 and odra-modules for the contracts.
- Node and TypeScript for the agents and the dashboard.
- The @make-software/casper-x402 package for the payment economy, settling CEP-18
  transfers authorized by EIP-712 signatures.
- Casper MCP and CSPR.cloud for reading chain state on testnet.
- Gemini through Vertex for the decision narration.

## Run it locally

No funded chain needed. The loop runs in local mode with an in memory vault.

```bash
cd agents
npm install
npm test            # unit tests for the pure logic
npm run e2e         # boots both service agents and runs one full cycle
npm run fund-agent -- --once   # one cycle, appends to dashboard/loop-log.json
```

Open `dashboard/index.html` to watch the loop. It falls back to a sample log if no
live log exists yet.

## Run it on Casper testnet

The build host needs Rust, cargo-odra, the binaryen wasm-opt, the wabt wasm-strip, and
casper-client. The contracts build cleanly to optimized wasm with this toolchain.

1. Fund the agent account from the testnet faucet at testnet.cspr.live. The faucet
   funds the account signed in with a Casper Wallet, so import `keys/agent/secret_key.pem`
   into Casper Wallet and request the test tokens, or send them from another funded
   account to the public key in `keys/agent/public_key_hex`.
2. Build and deploy the contracts on the build host:

```bash
CASPER_NODE=<node> CASPER_KEY=keys/agent/secret_key.pem ./scripts/deploy-contracts.sh
```

3. Put the deployed `PAY_TOKEN_HASH` and `VAULT_HASH` into `agents/.env.testnet`, set
   `CASPER_LIVE=1`, then run the agents. The fund agent now submits real rebalances and
   the service agents settle real CEP-18 transfers over x402.

## Testnet deployment

The deployed contract hashes and the proof transactions are recorded here after the
funded deploy.

- Pay token contract: pending the funded deploy
- Vault contract: pending the funded deploy
- Example x402 payment transactions and a rebalance transaction: pending

## License

MIT.
