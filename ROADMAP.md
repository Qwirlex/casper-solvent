# Roadmap

Solvent starts as a working testnet prototype of an autonomous self funding agent.
The path from here.

## Now, the Buildathon prototype

- A vault and a CEP-18 token deployed on Casper testnet.
- A fund agent that reads state, buys a feed and a risk score over x402, decides a
  bounded allocation, and rebalances on chain.
- A dashboard that shows the live economic loop.

## Next, a real managed asset

- Replace the named strategy buckets with real positions, swapping through a Casper
  decentralized exchange so a rebalance moves real value.
- Back the vault with a real world asset and a price oracle, so the agent manages an
  RWA portfolio, not a test token.

## Then, a service agent market

- Open the data and risk roles to many competing providers, each priced over x402.
  The agent shops for the best feed and the most accurate risk score.
- Give each service agent an on chain reputation built from historical accuracy.

## Later, a subscriber economy

- Let many depositors subscribe to the fund and pay the agent a performance fee over
  x402, closing the loop at scale.
- Move from testnet to mainnet once the contracts pass an external review.

## Principle that does not change

The agent acts on its own but inside guardrails the contract enforces. It suggests and
acts within bounds, it never takes custody it should not have, and every action stays
auditable on chain.
