#!/usr/bin/env bash
# Builds the Odra contracts and deploys them to Casper testnet.
# Runs on the build host where Rust and cargo-odra are installed, the Aegis VPS.
# casper-client is installed there via the Casper apt repo at deploy time.
#
# Required env:
#   CASPER_NODE   a testnet rpc node address, for example http://NODE:7777/rpc
#   CASPER_KEY    path to the agent secret_key.pem
# The deploying account must hold testnet CSPR from the faucet.
set -euo pipefail
NODE=${CASPER_NODE:?set CASPER_NODE}
KEY=${CASPER_KEY:?set CASPER_KEY to the secret_key.pem path}

cd "$(dirname "$0")/../contracts"

echo "building wasm"
cargo odra build

deploy_session() {
  local wasm=$1; shift
  casper-client put-deploy \
    --node-address "$NODE" \
    --chain-name casper-test \
    --secret-key "$KEY" \
    --payment-amount 300000000000 \
    --session-path "$wasm" \
    "$@"
}

echo "deploying pay token, initial supply 1,000,000 sUSD at 9 decimals"
deploy_session wasm/PayToken.wasm \
  --session-arg "odra_cfg_package_hash_key_name:string='pay_token_package_hash'" \
  --session-arg "odra_cfg_allow_key_override:bool='true'" \
  --session-arg "odra_cfg_is_upgradable:bool='false'" \
  --session-arg "initial_supply:u256='1000000000000000'"

echo "wait for execution, read pay_token_package_hash from the account named keys on testnet.cspr.live, then export it"
echo "PAY_TOKEN_HASH=hash-... and rerun with the vault block below"

if [ -n "${PAY_TOKEN_HASH:-}" ] && [ -n "${AGENT_ACCOUNT_HASH:-}" ]; then
  echo "deploying vault"
  deploy_session wasm/Vault.wasm \
    --session-arg "odra_cfg_package_hash_key_name:string='vault_package_hash'" \
    --session-arg "odra_cfg_allow_key_override:bool='true'" \
    --session-arg "odra_cfg_is_upgradable:bool='false'" \
    --session-arg "agent:key='${AGENT_ACCOUNT_HASH}'" \
    --session-arg "token:key='${PAY_TOKEN_HASH}'"
fi
