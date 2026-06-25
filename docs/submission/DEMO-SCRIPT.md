# Demo video script, Solvent

Target length two to three minutes. Screen recording with voice over. Keep it concrete,
show the chain, not slides. Record at 1080p. Have testnet.cspr.live open in a tab so you
can paste transaction hashes live.

## Shot list

### 0:00 to 0:20, the hook

On camera or voice over the landing page at https://caspersolvent.xyz.

Say: "This is Solvent, an AI agent that runs a DeFi vault on Casper and pays its own
way. It buys the data it needs from other agents over x402, decides an allocation, and
rebalances the vault on chain. It is a real economic actor, it earns a fee and spends
that income itself."

Scroll the landing page once, top to bottom, so the live loop and the on chain proof
table are visible.

### 0:20 to 0:45, the problem and why Casper

Voice over a static frame of the how it works section.

Say: "Most on chain agents are scripts, a human funds every input. For an agent economy
you need an agent that can earn, can spend, and can prove it paid, with no human in the
loop. Casper is the first WebAssembly chain with native x402 payments, so this is the
one place the whole loop closes."

### 0:45 to 1:30, the live loop, the core

Show the terminal. Run the agent loop. If you run it live on testnet, run the funded
path, otherwise run the local demo. Narrate as the lines print.

Commands, funded path:

```
cd agents
npm run data-agent   # terminal 1
npm run risk-agent   # terminal 2
npm run fund-agent -- --once   # terminal 3
```

Point at the log lines as they appear:

- "x402 paid data-agent" say "the agent asked for the feed, got back HTTP 402, signed an
  EIP-712 authorization with its Casper key, settled the fee on chain, and only then got
  the data."
- "x402 paid risk-agent" say "same handshake for the risk score."
- "decision" say "a bounded function picks the allocation, Gemini explains it in plain
  language."
- "submitted rebalance" say "the agent signs and submits the rebalance to the vault on
  Casper testnet."

### 1:30 to 2:00, proof on chain

Copy a transaction hash from the log or from dashboard, open it on
https://testnet.cspr.live, show it executed with no error.

Say: "Every step lands on chain and can be audited. Here is the rebalance, here is the
service payment. This is the agent earning and spending, on chain, on its own."

### 2:00 to 2:30, the dApp

Back to https://caspersolvent.xyz. Click connect, pick Casper Wallet, connect.

Say: "Anyone can use the vault. Connect a wallet, deposit, and the same agent manages
the allocation. Withdraw at any time. The agent can never move your funds to an
arbitrary address, the contract enforces that."

Show a deposit being signed in the wallet. Optional, show the resulting transaction.

### 2:30 to end, close

Voice over the landing page.

Say: "Solvent, an autonomous self funding fund agent. Live on Casper testnet, open
source, built for the agent economy Casper is made for."

Show the repo URL and the dApp URL on screen.

## Tips

- Practice the run once so the terminals are warm and the timing is tight.
- If the live RPC is slow during recording, fall back to the local demo, the handshake
  and the narration are identical, only the settlement hash differs.
- Keep the voice over calm and plain, no hype words, let the chain do the talking.
