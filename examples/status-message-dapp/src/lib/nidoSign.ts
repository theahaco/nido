/**
 * In-page signing of target-contract calls with a delegated Nido session
 * passkey — no per-transaction redirect to the wallet.
 *
 * This is the payoff of "log in with Nido = create a passkey for this dApp"
 * (see `delegationHandover.ts`): once a session key is delegated, the dApp
 * signs the target contract's calls locally with that passkey (Touch ID /
 * device unlock at the dApp origin) and submits.
 *
 * Two flows share one signing core (`signSessionCallInPage`):
 *
 *  - `signUpdateMessageInPage` — the status-message write. A smart account
 *    (C-address) can't be a classic transaction source, so a throwaway
 *    friendbot-funded G-address pays the fee and submits; the smart account is
 *    only the auth *author*. Ported from the g2c frontend's `status-message`
 *    page so the example is self-contained.
 *
 *  - `tipAuthorInPage` — a GASLESS native-XLM tip via a direct
 *    `SAC.transfer(smartAccount → author, amount)`. The session key is scoped
 *    to the XLM Stellar Asset Contract (with a wallet-installed spending
 *    limit), the signed `{func, auth}` pair goes to the Nido relayer, and the
 *    relayer's channel accounts source + fee-bump the transaction — no fee
 *    payer, no friendbot anywhere in the path.
 */

import {
	buildAuthHash,
	computeAuthDigest,
	getAuthEntry,
	injectPasskeySignature,
	hex2buf,
	loadSessionKeyMaterial,
	forgetSessionKeyMaterial,
	signWithSessionPasskey,
	extractFuncAndAuth,
	submitSorobanTransaction,
	waitForConfirmation,
} from "@g2c/passkey-sdk"
import {
	Address,
	Asset,
	Keypair,
	Operation,
	TransactionBuilder,
	type Transaction,
	nativeToScVal,
	rpc,
	type xdr,
} from "@stellar/stellar-sdk"
import { Client } from "status_message"
import { rpcUrl, networkPassphrase, relayerUrl, stellarNetwork } from "../contracts/util"
import { getFriendbotUrl } from "../util/friendbot"
import { withPasskeySheet } from "./passkeySheet"
import { decodeContractCall, buildApprovalDetails } from "./describeAuthEntry"
import { findRuleForPubkey, fetchVerifierAddress } from "./policyChainFetch"

// Same key the g2c frontend uses for its status-message fee payer, so tooling
// that seeds a funded bank account (e.g. the e2e harness) funds this too.
const FEE_PAYER_KEY = "sm:keypairSecret"

/** Native-XLM Stellar Asset Contract id for the configured network — the
 *  target contract a tipping session key is scoped to. */
export const XLM_SAC_ID = Asset.native().contractId(networkPassphrase)

/**
 * Recording-mode simulation needs SOME existing on-chain source account; the
 * source neither signs nor pays in the gasless path (the relayer's channel
 * accounts become the real source later). The Nido relayer's fund address is
 * public and always funded on testnet, so it serves as a constant sim source
 * — no friendbot, no locally stored keypair required.
 */
const TIP_SIM_SOURCE = "GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2"

/** True when a session passkey is already delegated for (account, contract). */
export function hasSessionKey(account: string, contractId: string): boolean {
	return loadSessionKeyMaterial(account, contractId) !== null
}

/** Param names for a contract function (from its spec) — labels the sheet's args. */
function specParamNames(client: Client, fnName: string): string[] {
	try {
		const f = client.spec.funcs().find((x) => x.name().toString() === fnName)
		return f ? f.inputs().map((i) => i.name().toString()) : []
	} catch {
		return []
	}
}

/**
 * Get (or lazily friendbot-fund) a throwaway G-address to pay fees and submit.
 * The smart account can't be a tx source; this classic account is.
 * (Classic self-submission only — the relayer tip path never calls this.)
 */
async function getOrCreateFeePayer(): Promise<Keypair> {
	const stored = localStorage.getItem(FEE_PAYER_KEY)
	if (stored) return Keypair.fromSecret(stored)
	const kp = Keypair.random()
	const resp = await fetch(getFriendbotUrl(kp.publicKey()))
	if (!resp.ok) throw new Error(`Friendbot funding failed: ${resp.statusText}`)
	localStorage.setItem(FEE_PAYER_KEY, kp.secret())
	return kp
}

export type SignProgress = (message: string) => void

/**
 * The structural minimum the signing core needs from a built transaction:
 * whatever `injectPasskeySignature` accepts. Generic so the bindings' bundled
 * stellar-sdk `Transaction` (update_message) and this app's own (tip) both
 * round-trip through the core with their exact type preserved.
 */
type InjectableTx = Parameters<typeof injectPasskeySignature>[0]

/** What `buildTx` hands the signing core. */
export interface BuiltSessionCall<T extends InjectableTx> {
	/** Built tx whose invoke op carries the simulated (unsigned) auth entries. */
	tx: T
	/** The recording-mode simulation that produced those auth entries. */
	sim: rpc.Api.SimulateTransactionSuccessResponse
	/** Spec-derived parameter names for the approval sheet, by function name. */
	paramNames?: (fn: string) => string[]
}

/**
 * Shared session-signing core: load the (account, targetContract) session-key
 * material, let the caller build + recording-simulate the call, discover the
 * on-chain context rule for the key, compute the OZ v0.7 auth digest, run the
 * passkey ceremony inside the Nido-styled sheet, and inject the signature into
 * the built tx's auth entry. Submission is the CALLER's concern — the
 * update_message flow self-submits with its own fee payer, the tip flow ships
 * `{func, auth}` to the relayer.
 */
export async function signSessionCallInPage<T extends InjectableTx>(opts: {
	account: string
	/** Contract the session key is scoped to (the material's storage key). */
	targetContract: string
	/** Build + recording-simulate the call. Runs AFTER the material check. */
	buildTx: () => Promise<BuiltSessionCall<T>>
	/** Heading for the approval sheet, e.g. "Approve status update". */
	approvalTitle: string
	/** Sub text for the approval sheet. */
	approvalSub?: string
	/** Flow-specific error copy (defaults match the update_message flow). */
	errors?: { noMaterial?: string; ruleMissing?: string }
	onProgress?: SignProgress
}): Promise<{ tx: T }> {
	const { account, targetContract, onProgress } = opts
	const note = (m: string) => onProgress?.(m)

	const material = loadSessionKeyMaterial(account, targetContract)
	if (!material) {
		throw new Error(
			opts.errors?.noMaterial ??
				'No dApp passkey for this account — click "Create dApp passkey" to delegate one first.',
		)
	}

	const { tx, sim, paramNames } = await opts.buildTx()
	const authEntry = getAuthEntry(sim)
	const lastLedger = sim.latestLedger
	const authHash = buildAuthHash(authEntry, networkPassphrase, lastLedger)

	note("Finding session rule on chain…")
	// The wallet's add_context_rule assigned some non-zero rule id; discover it
	// so the AuthPayload + the chain-recomputed digest reference the same rule.
	const ruleId = await findRuleForPubkey(account, material.publicKey)
	if (ruleId === null) {
		forgetSessionKeyMaterial(account, targetContract)
		throw new Error(
			opts.errors?.ruleMissing ??
				"Session passkey is not installed on chain (the delegation never committed). " +
					"Create the dApp passkey again.",
		)
	}
	const contextRuleIds = [ruleId]
	const verifierAddress = await fetchVerifierAddress(account)

	note("Touch your authenticator to sign…")
	// OZ v0.7+ accounts verify sha256(signature_payload || context_rule_ids.to_xdr()).
	const authDigest = computeAuthDigest(new Uint8Array(authHash), contextRuleIds)
	// Decode what the signature actually authorises straight from the auth entry
	// (what-you-see-is-what-you-sign) rather than restating app inputs, so the
	// sheet provably reflects the signed payload. Values render via textContent,
	// so decoded user input (the message) can't inject into the dialog.
	const call = decodeContractCall(authEntry.rootInvocation())
	const details = call
		? buildApprovalDetails(call, paramNames?.(call.fn) ?? [])
		: [{ label: "Warning", value: "Could not decode this authorization." }]

	// Wrap the real in-page ceremony in the Nido-styled confirm sheet — the OS
	// passkey prompt is browser chrome we can't restyle, but this frames it.
	const parsed = await withPasskeySheet(
		() => signWithSessionPasskey(material.credentialId, new Uint8Array(authDigest)),
		{
			title: opts.approvalTitle,
			sub: opts.approvalSub ?? "Confirm with your dApp passkey.",
			details,
		},
	)

	// Inject the session-key signature into the built tx's auth entry in OZ
	// v0.7 AuthPayload shape, threading the same contextRuleIds.
	injectPasskeySignature(
		tx,
		parsed,
		verifierAddress,
		hex2buf(material.publicKey),
		lastLedger,
		undefined,
		contextRuleIds,
	)
	return { tx }
}

/**
 * Build, session-passkey-sign in-page, and submit an `update_message` call.
 * Throws if no session key is delegated for (account, contractId) — the caller
 * should prompt the user to "Create dApp passkey" (delegate) first.
 */
export async function signUpdateMessageInPage(opts: {
	account: string
	message: string
	contractId: string
	onProgress?: SignProgress
}): Promise<{ hash: string }> {
	const { account, message, contractId, onProgress } = opts
	const note = (m: string) => onProgress?.(m)

	// Assigned inside buildTx (which the core always runs before returning);
	// needed again below to sign the final fee-bearing envelope.
	let keypair: Keypair | null = null

	const { tx: authTxn } = await signSessionCallInPage({
		account,
		targetContract: contractId,
		approvalTitle: "Approve status update",
		onProgress,
		buildTx: async () => {
			note("Funding a fee payer…")
			keypair = await getOrCreateFeePayer()

			note("Building transaction…")
			// A fresh client whose source/fee-payer is the funded G-address (the
			// smart account is only the auth author, passed as `author`).
			const client = new Client({
				contractId,
				networkPassphrase,
				rpcUrl,
				publicKey: keypair.publicKey(),
			})
			const tx = await client.update_message({ message, author: account }, { simulate: true })
			return {
				// `tx.built` is the already-assembled tx (auth-entry templates baked in).
				tx: tx.built!,
				sim: tx.simulation as rpc.Api.SimulateTransactionSuccessResponse,
				paramNames: (fn) => specParamNames(client, fn),
			}
		},
	})
	if (!keypair) throw new Error("unreachable: fee payer not initialised")

	note("Submitting…")
	const server = new rpc.Server(rpcUrl)
	// Re-simulate in enforce mode to recompute the footprint covering __check_auth.
	const sim2 = await server.simulateTransaction(authTxn, undefined, "enforce")
	if (rpc.Api.isSimulationError(sim2) || rpc.Api.isSimulationRestore(sim2)) {
		throw new Error(`Re-simulation failed: ${"error" in sim2 ? sim2.error : "restore needed"}`)
	}
	const successSim2 = sim2 as rpc.Api.SimulateTransactionSuccessResponse
	const newSorobanData = successSim2.transactionData.build()
	const newResourceFee = BigInt(newSorobanData.resourceFee().toString())

	// Round-trip through XDR to materialise a Transaction in THIS bundle's
	// stellar-sdk (TransactionBuilder.cloneFrom's instanceof check fails on the
	// bindings' bundled copy). Signed auth entries survive in the XDR.
	const reparsedAuthTxn = TransactionBuilder.fromXDR(
		authTxn.toEnvelope().toXDR("base64"),
		networkPassphrase,
	) as Transaction
	const oldResourceFee = BigInt(
		(reparsedAuthTxn.toEnvelope().v1().tx().ext().value() as xdr.SorobanTransactionData | undefined)
			?.resourceFee()
			.toString() ?? "0",
	)
	const classicFee = BigInt(reparsedAuthTxn.fee) - oldResourceFee
	const finalTx = TransactionBuilder.cloneFrom(reparsedAuthTxn, {
		fee: (classicFee + newResourceFee).toString(),
		sorobanData: newSorobanData,
		networkPassphrase,
	}).build()
	finalTx.sign(keypair)

	const sendResult = await server.sendTransaction(finalTx)
	if (sendResult.status === "ERROR") {
		throw new Error(
			`Transaction rejected: ${sendResult.errorResult?.toXDR("base64") ?? "unknown"}`,
		)
	}
	let getResult = await server.getTransaction(sendResult.hash)
	while (getResult.status === "NOT_FOUND") {
		await new Promise((r) => setTimeout(r, 1500))
		getResult = await server.getTransaction(sendResult.hash)
	}
	if (getResult.status !== "SUCCESS") {
		throw new Error(`Transaction failed: ${getResult.status}`)
	}
	return { hash: sendResult.hash }
}

/**
 * Tip `author` some native XLM from the connected smart account, gaslessly:
 * a direct `SAC.transfer(account → author, stroops)` signed in-page with the
 * tipping session passkey and submitted through the Nido relayer. The auth
 * context is `CallContract(XLM SAC)`, so the session key's contract scope AND
 * its spending-limit policy both apply on-chain.
 *
 * No fee payer, no friendbot: recording simulation borrows the relayer's
 * public fund address as a source, and the relayer's channel accounts pay for
 * real. On rejection (over-limit, expired, out-of-scope) the relayer surfaces
 * the enforce failure — the thrown error carries its message and the session
 * material is KEPT (the rule may still allow smaller amounts later).
 */
export async function tipAuthorInPage(opts: {
	/** Connected Nido smart account (the tipper / auth author). */
	account: string
	/** Recipient address — C… or G…. */
	author: string
	/** Whole-XLM amount, e.g. 1. */
	xlm: number
	onProgress?: SignProgress
}): Promise<{ hash: string }> {
	const { account, author, xlm, onProgress } = opts
	const note = (m: string) => onProgress?.(m)
	const stroops = BigInt(Math.round(xlm * 10_000_000))

	const { tx: signedTx } = await signSessionCallInPage({
		account,
		targetContract: XLM_SAC_ID,
		approvalTitle: "Approve tip",
		errors: {
			noMaterial:
				'No tipping passkey for this account — click "Enable tipping" to delegate one first.',
			ruleMissing:
				"The tipping passkey is not installed on chain (the delegation never " +
					'committed or was revoked). Click "Enable tipping" again.',
		},
		onProgress,
		buildTx: async () => {
			note("Building transaction…")
			const server = new rpc.Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })
			const source = await server.getAccount(TIP_SIM_SOURCE)
			const op = Operation.invokeContractFunction({
				contract: XLM_SAC_ID,
				function: "transfer",
				args: [
					Address.fromString(account).toScVal(), // from = the smart account
					Address.fromString(author).toScVal(), // to = the author being tipped
					nativeToScVal(stroops, { type: "i128" }), // amount
				],
			})
			const simTx = new TransactionBuilder(source, {
				fee: "10000000",
				networkPassphrase,
			})
				.addOperation(op)
				.setTimeout(0)
				.build()
			const sim = await server.simulateTransaction(simTx)
			if (rpc.Api.isSimulationError(sim)) {
				throw new Error(`Simulation failed: ${sim.error}`)
			}
			const success = sim as rpc.Api.SimulateTransactionSuccessResponse
			// Bake the simulated footprint + (unsigned) auth-entry templates into
			// the tx so the core can inject the signature in place.
			const tx = rpc.assembleTransaction(simTx, success).build()
			// SEP-41 transfer arg names — labels the approval sheet rows.
			return { tx, sim: success, paramNames: () => ["from", "to", "amount"] }
		},
	})

	note("Submitting via relayer…")
	// The relayer re-simulates server-side in enforce mode (running the smart
	// account's __check_auth + the spending-limit policy), sources the tx from a
	// channel account, and fee-bumps it from the fund address. We ship ONLY the
	// host function + the passkey-signed auth entry.
	const { func, auth } = extractFuncAndAuth(signedTx)
	if (auth.length > 1) {
		throw new Error(`Expected a single auth entry, got ${auth.length} — only the first is passkey-signed.`)
	}
	const submitted = await submitSorobanTransaction({ func, auth }, relayerUrl)
	if (!submitted.transactionId) {
		throw new Error("Relayer accepted the tip but returned no transaction id")
	}
	const confirmed = await waitForConfirmation(submitted.transactionId, relayerUrl)
	if (!confirmed.hash) throw new Error("Relayer confirmed without a transaction hash")
	return { hash: confirmed.hash }
}
