#!/usr/bin/env bash
# Deploys the Odra contracts to Casper testnet, Casper 2.0 protocol 2.2.2.
#
# The network uses the transaction model, so contracts install with
# `casper-client put-transaction session`, not the deprecated put-deploy. The Odra
# wasm runs on the vm-casper-v1 runtime. The generated installer reads four odra_cfg
# args, note odra_cfg_is_upgrade which the generated call() checks first, plus the
# contract constructor args.
#
# Run on the build host where cargo-odra and casper-client 5.x are installed and the
# wasm is built at wasm/PayToken.wasm and wasm/Vault.wasm.
#
# Required env:
#   CASPER_NODE   a public testnet rpc base, for example https://node.testnet.casper.network
#   CASPER_KEY    path to the funded account secret_key.pem
#   AGENT_ACCOUNT_HASH  the funded account hash, used as the vault agent, account-hash-...
# The deploying account must hold testnet CSPR from the faucet.
set -euo pipefail
NODE=${CASPER_NODE:?set CASPER_NODE}
KEY=${CASPER_KEY:?set CASPER_KEY to the secret_key.pem path}
AGENT=${AGENT_ACCOUNT_HASH:?set AGENT_ACCOUNT_HASH to account-hash-...}

cd "$(dirname "$0")/../contracts"

echo "building wasm"
cargo odra build

install_session() {
  local wasm=$1; shift
  casper-client put-transaction session \
    --node-address "$NODE" \
    --chain-name casper-test \
    --secret-key "$KEY" \
    --gas-price-tolerance 1 \
    --pricing-mode classic \
    --standard-payment true \
    --payment-amount 300000000000 \
    --install-upgrade \
    --transaction-runtime vm-casper-v1 \
    --wasm-path "$wasm" \
    --session-arg "odra_cfg_is_upgrade:bool='false'" \
    --session-arg "odra_cfg_allow_key_override:bool='true'" \
    --session-arg "odra_cfg_is_upgradable:bool='false'" \
    "$@"
}

echo "deploying pay token, initial supply 1,000,000 sUSD at 9 decimals"
install_session wasm/PayToken.wasm \
  --session-arg "odra_cfg_package_hash_key_name:string='pay_token_package_hash'" \
  --session-arg "initial_supply:u256='1000000000000000'"

echo "wait for execution, then read pay_token_package_hash from the deployer account:"
echo "  casper-client get-entity -n $NODE --public-key <PUBLIC_KEY_HEX>"
echo "export PAY_TOKEN_HASH=hash-... and rerun with the vault block below"

if [ -n "${PAY_TOKEN_HASH:-}" ]; then
  echo "deploying vault, agent $AGENT, token $PAY_TOKEN_HASH"
  install_session wasm/Vault.wasm \
    --session-arg "odra_cfg_package_hash_key_name:string='vault_package_hash'" \
    --session-arg "agent:key='${AGENT}'" \
    --session-arg "token:key='${PAY_TOKEN_HASH}'"
fi
