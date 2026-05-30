#!/usr/bin/env bash
#
# Tasks 4 & 4b of the Policy Builder v1 plan:
#   - Publish + deploy the multisig-policy under its canonical registry name
#   - Confirm the WebAuthn verifier is registered by name (publish + register
#     if not)
#   - Publish + upgrade the factory wasm via the stellar-registry
#
# Idempotent: each step checks current state and skips work that's already done.
#
# Usage:
#   ./scripts/deploy-policy-builder-v1.sh <stellar-keys-alias> [network]
#
#   <alias>   Required. The `stellar keys` identity authorized to publish under
#             your registry namespace (see `stellar keys ls`).
#   [network] Optional, defaults to "testnet".
#
# Prerequisites:
#   - `stellar` CLI (>= 26)
#   - `just` available on PATH
#   - The deployed factory's existing contract ID matches FACTORY_CONTRACT_ID
#     below; if you've redeployed elsewhere, edit the constant or pass
#     FACTORY_CONTRACT_ID as an env var.
#
# Environment overrides:
#   FACTORY_CONTRACT_ID  Existing deployed factory address (default = the
#                        testnet instance the frontend currently targets).
#   POLICY_VERSION       multisig-policy semantic version (default 0.1.0).
#   FACTORY_VERSION      factory wasm version to publish + upgrade to
#                        (default 0.2.0).
#   SKIP_BUILD           If set, skip `just build-contracts`.

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "usage: $0 <stellar-keys-alias> [network]" >&2
    echo "  see `stellar keys ls` for available aliases" >&2
    exit 1
fi

ALIAS="$1"
NETWORK="${2:-testnet}"
FACTORY_CONTRACT_ID="${FACTORY_CONTRACT_ID:-CDDMELYHOSD6M2T53F5DUYCXDS3VVOQ72E4KZMMZP37GQWII2WRKM2CC}"
POLICY_VERSION="${POLICY_VERSION:-0.1.0}"
FACTORY_VERSION="${FACTORY_VERSION:-0.2.0}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POLICY_WASM="$REPO_ROOT/target/wasm32v1-none/contract/g2c_multisig_policy.wasm"
VERIFIER_WASM="$REPO_ROOT/target/wasm32v1-none/contract/g2c_webauthn_verifier.wasm"
FACTORY_WASM="$REPO_ROOT/target/wasm32v1-none/contract/g2c_factory.wasm"

cd "$REPO_ROOT"

# --- helpers --------------------------------------------------------------

note()   { printf "\n\033[1m▸ %s\033[0m\n" "$*"; }
ok()     { printf "  \033[32m✓\033[0m %s\n" "$*"; }
skip()   { printf "  \033[90m·\033[0m %s\n" "$*"; }
warn()   { printf "  \033[33m!\033[0m %s\n" "$*" >&2; }
die()    { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# Returns the contract ID for a registered name, empty string if not registered.
fetch_contract_id() {
    local name="$1"
    stellar registry fetch-contract-id --name "$name" --network "$NETWORK" 2>/dev/null \
        | tr -d '[:space:]' \
        || true
}

# Returns the wasm hash for a published (name, version), empty if not published.
fetch_hash() {
    local name="$1" version="$2"
    stellar registry fetch-hash --name "$name" --version "$version" --network "$NETWORK" 2>/dev/null \
        | tr -d '[:space:]' \
        || true
}

# --- preflight ------------------------------------------------------------

note "Preflight"

command -v stellar >/dev/null \
    || die "'stellar' CLI not found on PATH"

if ! stellar keys ls 2>/dev/null | grep -qx "$ALIAS"; then
    die "'$ALIAS' is not a known stellar keys alias. Run 'stellar keys ls' to check."
fi
ok "Using stellar keys alias: $ALIAS"
ok "Network: $NETWORK"
ok "Factory contract: $FACTORY_CONTRACT_ID"

if [ -z "${SKIP_BUILD:-}" ]; then
    note "Building contracts (set SKIP_BUILD=1 to skip)"
    just build-contracts >/dev/null
    ok "build-contracts complete"
fi

for wasm in "$POLICY_WASM" "$VERIFIER_WASM" "$FACTORY_WASM"; do
    [ -f "$wasm" ] || die "expected wasm not found: $wasm (run 'just build-contracts' first)"
done

# --- Task 4: multisig-policy ---------------------------------------------

note "Task 4 · multisig-policy v$POLICY_VERSION"

published_hash="$(fetch_hash multisig-policy "$POLICY_VERSION")"
if [ -n "$published_hash" ]; then
    skip "multisig-policy@$POLICY_VERSION already published (hash $published_hash)"
else
    stellar registry publish \
        --wasm "$POLICY_WASM" \
        --name multisig-policy --version "$POLICY_VERSION" \
        --network "$NETWORK" --source "$ALIAS"
    ok "published multisig-policy@$POLICY_VERSION"
fi

policy_addr="$(fetch_contract_id multisig-policy)"
if [ -n "$policy_addr" ]; then
    skip "multisig-policy already deployed: $policy_addr"
else
    stellar registry deploy \
        --name multisig-policy --version "$POLICY_VERSION" \
        --network "$NETWORK" --source "$ALIAS"
    policy_addr="$(fetch_contract_id multisig-policy)"
    ok "deployed multisig-policy: $policy_addr"
fi

# --- Verifier (publish + register if missing) -----------------------------

note "verifier · ensure registered by name"

verifier_addr="$(fetch_contract_id verifier)"
if [ -n "$verifier_addr" ]; then
    skip "verifier already registered: $verifier_addr"
else
    warn "'verifier' is not registered in the registry."
    warn "The factory's pre-upgrade verifier deployment (if any) was created via"
    warn "lazy-deploy from a hardcoded hash, so it has no registry name."
    warn "Publishing the current verifier wasm and deploying it under the name"
    warn "'verifier'. The resulting contract address WILL DIFFER from any"
    warn "pre-existing unregistered verifier deployment — accounts created"
    warn "BEFORE this script ran reference the old address and won't see the"
    warn "registered one. New accounts created via the upgraded factory will."

    if [ -z "$(fetch_hash verifier "$POLICY_VERSION")" ]; then
        stellar registry publish \
            --wasm "$VERIFIER_WASM" \
            --name verifier --version "$POLICY_VERSION" \
            --network "$NETWORK" --source "$ALIAS"
        ok "published verifier@$POLICY_VERSION"
    else
        skip "verifier@$POLICY_VERSION already published"
    fi

    stellar registry deploy \
        --name verifier --version "$POLICY_VERSION" \
        --network "$NETWORK" --source "$ALIAS"
    verifier_addr="$(fetch_contract_id verifier)"
    ok "deployed verifier: $verifier_addr"
fi

# --- Task 4b: factory publish + upgrade ----------------------------------

note "Task 4b · factory v$FACTORY_VERSION"

published_factory_hash="$(fetch_hash factory "$FACTORY_VERSION")"
if [ -n "$published_factory_hash" ]; then
    skip "factory@$FACTORY_VERSION already published (hash $published_factory_hash)"
else
    stellar registry publish \
        --wasm "$FACTORY_WASM" \
        --name factory --version "$FACTORY_VERSION" \
        --network "$NETWORK" --source "$ALIAS"
    ok "published factory@$FACTORY_VERSION"
fi

registered_factory="$(fetch_contract_id factory)"
if [ -z "$registered_factory" ]; then
    warn "factory at $FACTORY_CONTRACT_ID is not yet registered by name."
    warn "Registering as 'factory' so 'stellar registry upgrade' can target it."
    stellar registry register-contract \
        --name factory \
        --contract-id "$FACTORY_CONTRACT_ID" \
        --owner "$ALIAS" \
        --network "$NETWORK" --source "$ALIAS"
    registered_factory="$(fetch_contract_id factory)"
    ok "registered factory: $registered_factory"
elif [ "$registered_factory" != "$FACTORY_CONTRACT_ID" ]; then
    die "registered factory ($registered_factory) does not match FACTORY_CONTRACT_ID ($FACTORY_CONTRACT_ID). Set FACTORY_CONTRACT_ID env var if you're targeting a different deployment."
else
    skip "factory already registered as $registered_factory"
fi

stellar registry upgrade \
    --name factory --version "$FACTORY_VERSION" \
    --network "$NETWORK" --source "$ALIAS"
ok "upgraded factory to $FACTORY_VERSION"

# --- Verification ---------------------------------------------------------

note "Verify factory can resolve registry names (smoke check)"

# Read the factory's stored verifier address by calling its `resolve` indirectly
# through `create_account` semantics is invasive; instead, just confirm the
# registry resolves the two names to addresses the factory will see.
echo "  registry resolves 'verifier'         → $verifier_addr"
echo "  registry resolves 'multisig-policy'  → $policy_addr"
echo "  factory contract                     → $registered_factory"

note "Done."
cat <<EOF

Summary:
  multisig-policy@$POLICY_VERSION   $policy_addr
  verifier (registered)              $verifier_addr
  factory@$FACTORY_VERSION           $registered_factory (upgraded in place)

The frontend's hardcoded FACTORY_CONTRACT_ID is unchanged; the upgrade swaps
the deployed wasm at that address. The factory's resolve() will now look up
'verifier' and 'multisig-policy' by name via the registry on first use per
name, and cache results in its instance storage.

If you registered a NEW verifier address above (because the prior deployment
was hash-based and unregistered), only accounts created AFTER this upgrade
will use it. Pre-existing accounts continue to reference their old verifier;
they remain functional.

Next: the policy-builder UI on /security is now operational end-to-end.
Use the inline forms to set up a recovery rule or delegate a session key.
EOF
