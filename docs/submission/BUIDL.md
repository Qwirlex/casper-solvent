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

- Pay token, CEP-18 sUSD, package hash-77b6965b86199ef296953065c643661d67bb7f588d7b1b02c0444c2b59dd901e
- Vault, package hash-99abf0408b2c799aabf8b1b3d275d1117b0a2ca020657ec0f1fd4664b0638389,
  contract entity contract-441c58d80c599df4f21688c657fa67c93eec381d52c0b0ebe88fbeceaad4679c

Proof transactions, all executed with no error:

- Install pay token, b93f65452d45fe765ff7d9d1ae8c1f81fb2957e4786af9b8f7c5e48e9a348edd
- Install vault, 5976ca27d3459dbbf6e71508d64fbc52bd17262bf6a845cdc6123113fc3e4c98
- Deposit, 5cd4f504ab5d3d19883e6c5c306f49b06d8b614204b347a6997b0ffbfbca64f4
- Agent rebalances, 89865acd6fe37265b04a9e42e929b3ad580dbf2a1c4b75b2157e4c96922e418c,
  1e2146ed1764407e592d68b1d4c2f2d76c797507a3e0be8d332e519ac5e07c5c,
  b82641c1442c848e350e3eefd6cebb2298d897d1cc54541e6d3ee0e5131f2f3a
- Service payments, agent pays data agent 7cac8a9fdd57678f399802a508e617dd668cd0b63ab31554ebc4a7ad3f3c12b7
  and risk agent a6255d32cdc12577932675fd1e15180e54e59ccd1a0eae89c266da9d1078cba1

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
