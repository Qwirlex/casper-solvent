# Solvent, an autonomous self funding fund agent on Casper

DoraHacks BUIDL submission for the Casper Agentic Buildathon 2026, Casper Innovation Track.

## One line

Solvent is an AI agent that runs a DeFi vault on Casper testnet and pays its own way,
it buys the data and risk signals it needs from other agents over the x402 payment
protocol, decides an allocation, and rebalances the vault on chain, earning a
performance fee as income.

## The problem

Agents are starting to act on chain, but almost none of them are real economic actors.
They are funded and operated by a human who pays for every input. An agent that cannot
earn and cannot spend is a script, not an economy. For the agent economy to exist, an
agent needs to be able to buy a service, prove it paid, and earn for the value it
creates, all without a human in the loop and all auditable.

## Why Casper

Casper is the first WebAssembly native chain with live x402 payments, and it positions
itself as the trust layer for the agent economy. x402 turns any priced HTTP call into a
pay per request exchange with a cryptographic payment proof. Solvent is built to show
exactly the thing Casper is for, an agent that earns and spends through x402 and acts on
chain through a smart contract. It only makes sense on a chain with native x402.

## What it does

One decision cycle:

1. The fund agent reads the vault and the market.
2. It requests a price feed from the data agent. The data agent answers an unpaid
   request with HTTP 402 and payment requirements. The fund agent signs an EIP-712
   TransferWithAuthorization with its Casper key, settles the fee as a CEP-18 transfer
   on testnet, and retries with the payment in the X-PAYMENT header. The data agent
   verifies the signature and serves the feed.
3. It buys a risk score from the risk agent through the same x402 handshake.
4. A bounded decision function picks the target allocation and Gemini narrates it in
   plain language.
5. The agent signs and submits a rebalance to the vault on Casper testnet.
6. The vault skims a capped performance fee, the income side of the loop, enforced by
   the contract.

The agent acts on its own but inside guardrails the contract enforces. It can only
choose among a fixed allocation set and it can never move depositor funds to an
arbitrary address.

## Live on Casper testnet

- dApp, https://caspersolvent.xyz, connect a wallet and deposit or withdraw against the
  real vault.
- Source, https://github.com/Qwirlex/casper-solvent

Contracts on casper-test, Casper 2.0, protocol 2.2.2:

- Pay token, CEP-18 sUSD, package hash-f7b25be95ff7c6ecb3518b2d8cd3fbad89949551661e99509f544673fe39ce59
- Vault, custody plus yield, package hash-ef636b715136655ffe4796aeb8e221ce236710f0dcf08c163f85cd39a8397711

Real yield proof on chain, the vault custodies deposits and the agent accrues yield
from an emissions reserve, raising assets per share, every step executed with no error:

- Install pay token v2, 2a49934a247a5afb7272ca3b35341579aa0ba5ebee45c0ac3da5c509dcedcac3
- Install vault v2, 36966cf13e7894598166fe7b8e82f91f2239f0f68f9198f375c5e67dea2217a8
- Approve vault, c148985a0eb19260cbb50abf1569c7e1da7ab43f4ca06b1c4a60e3c3de7bfc05
- Deposit 100 sUSD, 0b79ef5f4b49fe2a430a365ac82548b4064a0e613619557eec9bd6194d17039a
- Accrue 8 sUSD yield, 5d0f246e58a1bbcd164a23057f42442b711d120d0f60431abdc23c1798bb71c9

Assets per share is now 1.08, an 8 percent gain for every depositor, all on chain.

Proof transactions from the earlier build, all executed with no error:

- Install pay token, b93f65452d45fe765ff7d9d1ae8c1f81fb2957e4786af9b8f7c5e48e9a348edd
- Install vault, 5976ca27d3459dbbf6e71508d64fbc52bd17262bf6a845cdc6123113fc3e4c98
- Deposit, 5cd4f504ab5d3d19883e6c5c306f49b06d8b614204b347a6997b0ffbfbca64f4
- Agent rebalances, 89865acd6fe37265b04a9e42e929b3ad580dbf2a1c4b75b2157e4c96922e418c,
  1e2146ed1764407e592d68b1d4c2f2d76c797507a3e0be8d332e519ac5e07c5c,
  b82641c1442c848e350e3eefd6cebb2298d897d1cc54541e6d3ee0e5131f2f3a
- Service payments, agent pays data agent 7cac8a9fdd57678f399802a508e617dd668cd0b63ab31554ebc4a7ad3f3c12b7
  and risk agent a6255d32cdc12577932675fd1e15180e54e59ccd1a0eae89c266da9d1078cba1

Fresh proof from the real x402 handshake, one full cycle, every transaction confirmed
with no error on chain:

- x402 settlement to data agent, b71c6743a48c85c83b562827221016f3f0f912f318351ad2fb47389a40085a1f, block 8295362
- x402 settlement to risk agent, e93b7a3334eebec65b653cc51f9772b51ac0a7ee3e63b853984a76dbbd5438ff, block 8295362
- agent rebalance, 0af8b1ccdc49f30950d408adbd368f5c05fda20c3eb743ae7b3ee12a2ee68d47, block 8295363

Each settlement here was triggered by a 402 challenge and a verified EIP-712 signature,
the real protocol path. The live loop on the dApp shows more cycles with explorer links.

## How the criteria are met

- Working smart contracts on Casper testnet. Two Odra Rust contracts deployed, a vault
  and a CEP-18, with transactions producing on chain state.
- Use of AI and agentic systems. The fund agent runs autonomously, narrates with
  Gemini, and crucially transacts with other agents through a real x402 handshake.
- Innovation. The agent is a real economic actor, it earns a fee and spends that income
  on services it buys from other agents over x402. The full loop closes on chain.
- DeFi and RWA applicability. A vault that rebalances across strategy buckets is a
  primitive that extends to RWA baskets and managed funds.
- Technical execution. Odra 2.8 contracts, casper-js-sdk 5 for signing, the
  @make-software/casper-x402 exact scheme for payments, EIP-712 verification, a typed
  test suite, and a live dApp.
- UX and design. A clean dApp with multi wallet connect through CSPR.click and a live
  view of the economic loop with explorer links.

## Stack

Rust with Odra 2.8 and odra-modules for the contracts on the vm-casper-v1 runtime. Node
and TypeScript for the agents and dApp. casper-js-sdk 5 for signing and submitting.
@make-software/casper-x402 and @casper-ecosystem/casper-eip-712 for the payment
protocol. CSPR.click for wallet connect. CSPR.cloud and the testnet RPC for chain
access. Gemini through Vertex for decision narration.

## Long term plan

The next contract milestone is a CEP-18 with transfer_with_authorization so the x402
facilitator can settle pulls on chain, which removes the last manual settlement step.
After that the vault grows from two strategy buckets to a configurable RWA basket, the
agent marketplace grows past two service agents, and the performance fee funds the
agent without any human top up. The roadmap lives in ROADMAP.md.

## Team and links

- dApp, https://caspersolvent.xyz
- Repo, https://github.com/Qwirlex/casper-solvent
- Demo video, see the submission
