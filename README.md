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
2. It requests a price feed from the data agent. The data agent answers an unpaid
   request with HTTP 402 and a set of payment requirements. The fund agent signs an
   EIP-712 TransferWithAuthorization over those requirements with its Casper key,
   settles the fee as a CEP-18 transfer on testnet, and retries with the payment in
   the X-PAYMENT header. The data agent verifies the signature, then serves the feed.
3. It buys a risk score from the risk agent through the same x402 handshake.
4. A bounded decision function picks the target allocation, and Gemini narrates it.
5. The agent signs and submits a rebalance to the vault on Casper testnet.
6. The vault skims a capped performance fee, the income side of the loop, enforced by
   the contract.

The x402 layer is real, not a stub. The 402 challenge, the EIP-712 signature, and the
server side verification use the @make-software/casper-x402 scheme, so a payload our
client builds verifies against the SDK facilitator and vice versa. The one production
gap is settlement. A plain CEP-18 cannot pull a transfer from a signed authorization
on chain, so today the payer submits the transfer itself. The drop in upgrade is a
CEP-18 with transfer_with_authorization plus the SDK facilitator that submits it, which
needs no change to the handshake.

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

- Rust with Odra 2.8 and odra-modules for the contracts, deployed on the Casper 2.0
  vm-casper-v1 runtime.
- Node and TypeScript for the agents and the dashboard, casper-js-sdk 5.x for signing
  and submitting transactions.
- A CEP-18 token as both the vault asset and the settlement currency for service
  payments. The @make-software/casper-x402 package is the transport wrapper for turning
  those payments into pay per request HTTP exchanges.
- CSPR.cloud and the public testnet RPC for reading chain state and submitting on testnet.
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
casper-client 5.x. The contracts build cleanly to optimized wasm with this toolchain.
The network is Casper 2.0, protocol 2.2.2, so contracts deploy with
`casper-client put-transaction session` and the Odra contracts run on the
`vm-casper-v1` runtime.

1. Fund the agent account from the testnet faucet at testnet.cspr.live. Sign in with a
   Casper Wallet and request the test tokens, then export the account key from the
   wallet to `keys/agent/secret_key.pem`. The funded public key goes in
   `keys/agent/public_key_hex`.
2. Build the contracts on the build host with `cargo odra build`, producing
   `wasm/PayToken.wasm` and `wasm/Vault.wasm`.
3. Deploy each contract. The exact session args, including the Odra config args, are in
   `scripts/deploy-contracts.sh`. Install the pay token, read its package hash from the
   deployer account named keys, then install the vault with the agent account hash and
   the pay token hash as constructor args.
4. Put the deployed `PAY_TOKEN_HASH` and `VAULT_HASH` into `agents/.env.testnet`, set
   `CASPER_LIVE=1` and `CASPER_NODE=https://node.testnet.casper.network/rpc`, then run
   the agents. The fund agent signs and submits real rebalances, and it settles each
   service payment with a real CEP-18 transfer to the service agent account.

```bash
cd agents
npx tsx src/dataAgent/server.ts &     # data agent on 4001
npx tsx src/riskAgent/server.ts &     # risk agent on 4002
npx tsx src/fundAgent/index.ts --once # one live cycle, real rebalance on chain
npx tsx scripts/pay-services-once.ts  # settle the two service payments on chain
```

## Testnet deployment

Live on Casper testnet, chain `casper-test`, Casper 2.0 protocol 2.2.2. Explorer base
`https://testnet.cspr.live`. Every transaction below executed with no error.

Agent account, the fund agent that signs every action:
`02020f62f89d5d78d79eba973ed5a45556b1dd6e1a31c5fb9490f634394e1af1a7ad`,
account hash `account-hash-c9c6b8f622cbeee77fca9e6e5d3f739f30e4116a1f5c41f6ccf2e0ddedb84383`.

Contracts, the live yield vault build:

- Pay token, CEP-18 sUSD with approve and transfer_from, package
  `hash-f7b25be95ff7c6ecb3518b2d8cd3fbad89949551661e99509f544673fe39ce59`
- Vault, custody plus yield accrual, package
  `hash-ef636b715136655ffe4796aeb8e221ce236710f0dcf08c163f85cd39a8397711`

The vault custodies deposits on chain. A depositor approves the vault, deposits and
receives shares, the agent accrues yield from an emissions reserve each cycle which
raises assets per share, and withdraw returns the principal plus the earned yield.
Real yield proof on chain, all executed with no error:

| Step | Hash |
| --- | --- |
| Install pay token v2 | `2a49934a247a5afb7272ca3b35341579aa0ba5ebee45c0ac3da5c509dcedcac3` |
| Install vault v2 | `36966cf13e7894598166fe7b8e82f91f2239f0f68f9198f375c5e67dea2217a8` |
| Approve vault | `c148985a0eb19260cbb50abf1569c7e1da7ab43f4ca06b1c4a60e3c3de7bfc05` |
| Deposit, 100 sUSD | `0b79ef5f4b49fe2a430a365ac82548b4064a0e613619557eec9bd6194d17039a` |
| Accrue yield, 8 sUSD | `5d0f246e58a1bbcd164a23057f42442b711d120d0f60431abdc23c1798bb71c9` |

After accrual the assets per share is 1.08, an 8 percent gain for every depositor.

The earlier non custodial build is superseded, its pay token was
`hash-77b6965b86199ef296953065c643661d67bb7f588d7b1b02c0444c2b59dd901e` and vault
`hash-99abf0408b2c799aabf8b1b3d275d1117b0a2ca020657ec0f1fd4664b0638389`.

Proof transactions:

| Step | Hash | Explorer |
| --- | --- | --- |
| Install pay token | `b93f65452d45fe765ff7d9d1ae8c1f81fb2957e4786af9b8f7c5e48e9a348edd` | `/transaction/b93f65452d45fe765ff7d9d1ae8c1f81fb2957e4786af9b8f7c5e48e9a348edd` |
| Install vault | `5976ca27d3459dbbf6e71508d64fbc52bd17262bf6a845cdc6123113fc3e4c98` | `/transaction/5976ca27d3459dbbf6e71508d64fbc52bd17262bf6a845cdc6123113fc3e4c98` |
| Depositor funds the vault | `5cd4f504ab5d3d19883e6c5c306f49b06d8b614204b347a6997b0ffbfbca64f4` | `/deploy/5cd4f504ab5d3d19883e6c5c306f49b06d8b614204b347a6997b0ffbfbca64f4` |
| Agent rebalance, 4 conservative 96 growth | `89865acd6fe37265b04a9e42e929b3ad580dbf2a1c4b75b2157e4c96922e418c` | `/deploy/89865acd6fe37265b04a9e42e929b3ad580dbf2a1c4b75b2157e4c96922e418c` |
| Agent rebalance, 3 conservative 97 growth | `1e2146ed1764407e592d68b1d4c2f2d76c797507a3e0be8d332e519ac5e07c5c` | `/deploy/1e2146ed1764407e592d68b1d4c2f2d76c797507a3e0be8d332e519ac5e07c5c` |
| Agent rebalance, 0 conservative 100 growth | `b82641c1442c848e350e3eefd6cebb2298d897d1cc54541e6d3ee0e5131f2f3a` | `/deploy/b82641c1442c848e350e3eefd6cebb2298d897d1cc54541e6d3ee0e5131f2f3a` |
| Agent pays data agent, CEP-18 transfer | `7cac8a9fdd57678f399802a508e617dd668cd0b63ab31554ebc4a7ad3f3c12b7` | `/deploy/7cac8a9fdd57678f399802a508e617dd668cd0b63ab31554ebc4a7ad3f3c12b7` |
| Agent pays risk agent, CEP-18 transfer | `a6255d32cdc12577932675fd1e15180e54e59ccd1a0eae89c266da9d1078cba1` | `/deploy/a6255d32cdc12577932675fd1e15180e54e59ccd1a0eae89c266da9d1078cba1` |

Service agent payment accounts that receive the CEP-18 micro payments:

- data agent `account-hash-3bcc0b3b98b667b6d7d95105b076f9389ccabbc4be16ab4def9be21b733797b9`
- risk agent `account-hash-1d9254a2f50645ef7c956e667f1751b017d06a09ed259be5b8c3de9588f48148`

## License

MIT.
