import type {
  MultisigRecoveryBlock,
  RotationRequest,
  FriendSignature,
  SignerSignature,
} from '@g2c/passkey-sdk';
import {
  multisigRecoveryModule,
  saveFriendNickname,
  buildRotation,
  describeRotation,
  planRotation,
  buildAuthHash,
  computeAuthDigest,
  getAuthEntry,
  buildAuthPayloadScVal,
  hex2buf,
  encodeRotationHandoff,
  decodeRotationHandoff,
  decodeFriendSignature,
  encodeFriendSignature,
  loadCredential,
  parseAssertionResponse,
  type RotationHandoff,
} from '@g2c/passkey-sdk';
import {
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  hash,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { fetchRegistryAddress, fetchVerifierAddress, fetchAllChainRules } from './policyChainFetch.js';
import { signAndSubmit } from './primaryPasskeySigner.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const SUBMITTER_KEY = 'g2c:name-keypair';

export async function installRecovery(
  account: string,
  block: MultisigRecoveryBlock,
): Promise<void> {
  const built = await multisigRecoveryModule.buildInstall({
    account,
    block,
    factoryAddress: '', // unused in architecture C
    rpcUrl: RPC_URL,
    policyAddress: (name) =>
      fetchRegistryAddress(name === 'multisig' ? 'multisig-policy' : name),
    verifierAddress: () => fetchVerifierAddress(account),
  });

  const verifierAddr = await fetchVerifierAddress(account);
  await signAndSubmit({
    account,
    operation: built.operations[0],
    verifierAddress: verifierAddr,
  });

  // Persist overlay metadata only after successful submission.
  for (const f of block.friends) {
    if (f.nickname) saveFriendNickname(account, f.address, f.nickname);
  }
}

// ===========================================================================
// Recovery completion (key rotation)
// ===========================================================================
//
// Flow: the originator stages a rotation (prepareRotation), shares a per-friend
// link, each friend signs and returns a blob (addFriendSignature), and once the
// threshold is met the originator submits (submitRotation).
//
// Partial signatures persist in localStorage at the recovering account's
// subdomain — same pattern as session-key material. We never store private
// key bytes; only the friends' returned signature blobs.

const stagingKey = (account: string) => `g2c.${account}.recovery-rotation`;

export interface RotationStaging {
  account: string;
  recoveryRuleId: number;
  threshold: number;
  /** All friend accounts authorized by the recovery rule. */
  friends: string[];
  /** Base64 XDR of the assembled, unsigned rotation transaction. */
  txXdr: string;
  /** The parent auth digest friends authorize, hex-encoded. */
  parentAuthDigestHex: string;
  /** Context rule ids (all = recoveryRuleId), one per operation. */
  contextRuleIds: number[];
  /** Ledger the simulation was pinned to (for expiration math). */
  lastLedger: number;
  description: string;
  /** Collected friend signatures keyed by friend account. */
  collected: Record<string, FriendSignature>;
}

function loadStaging(account: string): RotationStaging | null {
  const raw = localStorage.getItem(stagingKey(account));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as RotationStaging & {
      collected: Record<string, ReturnType<typeof serializeFriendSig>>;
    };
    const collected: Record<string, FriendSignature> = {};
    for (const [k, v] of Object.entries(o.collected ?? {})) {
      collected[k] = deserializeFriendSig(v);
    }
    return { ...o, collected };
  } catch {
    return null;
  }
}

function saveStaging(staging: RotationStaging): void {
  const collected: Record<string, ReturnType<typeof serializeFriendSig>> = {};
  for (const [k, v] of Object.entries(staging.collected)) {
    collected[k] = serializeFriendSig(v);
  }
  localStorage.setItem(
    stagingKey(staging.account),
    JSON.stringify({ ...staging, collected }),
  );
}

export function clearStaging(account: string): void {
  localStorage.removeItem(stagingKey(account));
}

export function getStaging(account: string): RotationStaging | null {
  return loadStaging(account);
}

function serializeFriendSig(s: FriendSignature) {
  return {
    friendAccount: s.friendAccount,
    verifierAddress: s.verifierAddress,
    publicKey: Array.from(s.publicKey),
    authenticatorData: Array.from(s.authenticatorData),
    clientDataJson: Array.from(s.clientDataJson),
    signature: Array.from(s.signature),
    nonce: s.nonce,
    signatureExpirationLedger: s.signatureExpirationLedger,
  };
}

function deserializeFriendSig(o: ReturnType<typeof serializeFriendSig>): FriendSignature {
  return {
    friendAccount: o.friendAccount,
    verifierAddress: o.verifierAddress,
    publicKey: new Uint8Array(o.publicKey),
    authenticatorData: new Uint8Array(o.authenticatorData),
    clientDataJson: new Uint8Array(o.clientDataJson),
    signature: new Uint8Array(o.signature),
    nonce: o.nonce,
    signatureExpirationLedger: o.signatureExpirationLedger,
  };
}

/** Locate the recovery rule(s): CallContract(self) rules carrying a policy. */
export interface RecoveryRuleInfo {
  ruleId: number;
  threshold: number | null;
  friends: string[];
}

export async function findRecoveryRules(account: string): Promise<RecoveryRuleInfo[]> {
  const rules = await fetchAllChainRules(account);
  const out: RecoveryRuleInfo[] = [];
  for (const r of rules) {
    if (r.policies.length === 0) continue;
    if (r.contextType.kind !== 'call-contract') continue;
    if (r.contextType.contract !== account) continue;
    const friends = r.signers
      .filter((s): s is { kind: 'delegated'; address: string } => s.kind === 'delegated')
      .map((s) => s.address);
    out.push({ ruleId: r.ruleId, threshold: null, friends });
  }
  return out;
}

/**
 * Stage a rotation: build the (unsigned) rotation transaction, simulate it to
 * derive the parent auth digest the friends must authorize, and persist the
 * staging blob. Returns the per-friend handoff payload the originator shares.
 */
export async function prepareRotation(args: {
  account: string;
  recoveryRuleId: number;
  friends: string[];
  threshold: number;
  request: RotationRequest;
}): Promise<{ staging: RotationStaging; handoff: RotationHandoff; handoffLink: string }> {
  const { account, recoveryRuleId, friends, threshold, request } = args;

  const built = await buildRotation({
    account,
    rpcUrl: RPC_URL,
    recoveryRuleId,
    request,
  });

  // Soroban permits only one InvokeHostFunction op per transaction, so a
  // combined add+remove cannot ride a single rotation tx. First cut: one
  // operation per rotation. Callers wanting both run two rotations in
  // sequence (add the new key first, then remove the old one).
  if (built.operations.length !== 1) {
    throw new Error(
      'prepareRotation: a rotation must be a single operation (add OR remove). ' +
        'Run two rotations to do both.',
    );
  }

  const server = new rpc.Server(RPC_URL);
  const submitter = await getSubmitter();
  const sourceAccount = await server.getAccount(submitter.publicKey());

  // Simulate with auth stripped so the simulator generates fresh auth
  // templates in recording mode (see primaryPasskeySigner for rationale).
  const opClone = xdr.Operation.fromXDR(built.operations[0].toXDR());
  opClone.body().invokeHostFunctionOp().auth([]);
  const simTx = new TransactionBuilder(sourceAccount, {
    fee: '10000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(opClone)
    .setTimeout(0)
    .build();

  const sim = await server.simulateTransaction(simTx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Rotation simulation failed: ${(sim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successSim = sim as rpc.Api.SimulateTransactionSuccessResponse;
  const authEntry = getAuthEntry(successSim);
  const lastLedger = successSim.latestLedger;
  const signaturePayload = buildAuthHash(authEntry, Networks.TESTNET, lastLedger);
  const parentAuthDigest = computeAuthDigest(signaturePayload, [recoveryRuleId]);

  const assembled = rpc.assembleTransaction(simTx, successSim).build();
  const txXdr = assembled.toXDR();

  const staging: RotationStaging = {
    account,
    recoveryRuleId,
    threshold,
    friends,
    txXdr,
    parentAuthDigestHex: Buffer.from(parentAuthDigest).toString('hex'),
    contextRuleIds: built.contextRuleIds,
    lastLedger,
    description: built.description,
    collected: {},
  };
  saveStaging(staging);

  const handoff: RotationHandoff = {
    version: 1,
    account,
    recoveryRuleId,
    description: built.description,
    txXdr,
    friends,
  };
  const encoded = encodeRotationHandoff(handoff);
  const handoffLink = `${window.location.origin}/security/recover/?handoff=${encoded}`;

  return { staging, handoff, handoffLink };
}

/**
 * Record a friend's returned signature blob into the staging area.
 * Returns the updated staging (idempotent per friend).
 */
export function addFriendSignature(account: string, blob: string): RotationStaging {
  const staging = loadStaging(account);
  if (!staging) throw new Error('No rotation in progress for this account.');
  const fs = decodeFriendSignature(blob.trim());
  if (!staging.friends.includes(fs.friendAccount)) {
    throw new Error(
      `${fs.friendAccount} is not one of this account's recovery friends.`,
    );
  }
  staging.collected[fs.friendAccount] = fs;
  saveStaging(staging);
  return staging;
}

export function collectedCount(staging: RotationStaging): number {
  return Object.keys(staging.collected).length;
}

/**
 * Assemble the full auth tree from the staged transaction plus the collected
 * friend signatures and submit it.
 *
 * The parent (recovering account) auth entry's signature is a multi-signer
 * `AuthPayload` whose `signers` map holds one `Delegated(friend)` entry per
 * contributing friend. Each friend's actual cryptographic proof rides in a
 * nested sub-invocation auth entry: the recovering account's `__check_auth`
 * calls `friend.require_auth_for_args((parent_auth_digest,))`, and the host
 * matches that against the friend's nested entry, whose own `__check_auth`
 * verifies the friend's primary passkey over the friend's auth digest.
 */
export async function submitRotation(account: string): Promise<string> {
  const staging = loadStaging(account);
  if (!staging) throw new Error('No rotation in progress.');
  const contributors = Object.values(staging.collected);
  if (contributors.length < staging.threshold) {
    throw new Error(
      `Need ${staging.threshold} friend signatures, have ${contributors.length}.`,
    );
  }

  const server = new rpc.Server(RPC_URL);

  // Build the parent multi-signer AuthPayload (Delegated friends only — the
  // primary passkey is lost, so the recovery rule is the sole authority).
  const signerSpecs: SignerSignature[] = contributors.map((c) => ({
    kind: 'delegated' as const,
    address: c.friendAccount,
  }));
  const parentAuthPayload = buildAuthPayloadScVal({
    contextRuleIds: staging.contextRuleIds,
    signers: signerSpecs,
  });

  // Splice the parent AuthPayload into the root auth entry and append one
  // nested friend entry per contributor.
  const envelope = xdr.TransactionEnvelope.fromXDR(staging.txXdr, 'base64');
  const v1 = envelope.v1();
  const innerOp = v1.tx().operations()[0];
  const ihfOp = innerOp.body().invokeHostFunctionOp();
  const rootAuth = ihfOp.auth()[0];
  const rootCreds = rootAuth.credentials().address();
  rootCreds.signature(parentAuthPayload);

  const friendEntries = contributors.map((c) =>
    buildFriendAuthEntry(c, staging.parentAuthDigestHex),
  );
  ihfOp.auth([rootAuth, ...friendEntries]);

  // Re-wrap the mutated envelope as a Transaction; submit via the established
  // refit pattern (recompute footprint via enforce-mode simulation).
  const rebuilt = TransactionBuilder.fromXDR(
    envelope.toXDR('base64'),
    Networks.TESTNET,
  ) as import('@stellar/stellar-sdk').Transaction;

  const finalSim = await server.simulateTransaction(rebuilt, undefined, 'enforce');
  if (rpc.Api.isSimulationError(finalSim)) {
    throw new Error(`Final rotation simulation failed: ${(finalSim as rpc.Api.SimulateTransactionErrorResponse).error}`);
  }
  const successFinal = finalSim as rpc.Api.SimulateTransactionSuccessResponse;
  const newSorobanData = successFinal.transactionData.build();
  const newResourceFee = BigInt(newSorobanData.resourceFee().toString());
  const submitter = await getSubmitter();
  const refitted = TransactionBuilder.cloneFrom(rebuilt, {
    fee: (BigInt(rebuilt.fee) + newResourceFee).toString(),
    sorobanData: newSorobanData,
    networkPassphrase: Networks.TESTNET,
  }).build();
  refitted.sign(submitter);

  const send = await server.sendTransaction(refitted);
  if (send.status === 'ERROR') {
    throw new Error(`Submit rejected: ${send.errorResult?.toXDR('base64') ?? 'unknown'}`);
  }
  let got = await server.getTransaction(send.hash);
  for (let i = 0; got.status === 'NOT_FOUND' && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    got = await server.getTransaction(send.hash);
  }
  if (got.status !== 'SUCCESS') {
    throw new Error(`Rotation tx ${send.hash} ${got.status}`);
  }
  clearStaging(account);
  return send.hash;
}

/**
 * Construct a nested `SorobanAuthorizationEntry` for a friend authorizing
 * `friend.require_auth_for_args((parent_auth_digest,))` with the friend's own
 * primary-passkey signature.
 */
function buildFriendAuthEntry(
  fs: FriendSignature,
  parentAuthDigestHex: string,
): xdr.SorobanAuthorizationEntry {
  const invocation = buildFriendInvocation(fs.friendAccount, parentAuthDigestHex);

  // The friend's own AuthPayload (primary passkey, default rule 0). The blob
  // already holds the COMPACT 64-byte signature, so build the
  // PasskeySignature directly — do not re-run derToCompact via
  // parseAssertionResponse.
  const friendAuthPayload = buildAuthPayloadScVal({
    contextRuleIds: [0],
    signers: [
      {
        kind: 'external',
        verifierAddress: fs.verifierAddress,
        publicKey: fs.publicKey,
        passkeySignature: {
          authenticatorData: fs.authenticatorData,
          clientDataJson: fs.clientDataJson,
          signature: fs.signature,
        },
      },
    ],
  });

  const creds = new xdr.SorobanAddressCredentials({
    address: Address.fromString(fs.friendAccount).toScAddress(),
    nonce: xdr.Int64.fromString(fs.nonce),
    signatureExpirationLedger: fs.signatureExpirationLedger,
    signature: friendAuthPayload,
  });

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(creds),
    rootInvocation: invocation,
  });
}

/**
 * The invocation a friend authorizes:
 * `friend.require_auth_for_args((parent_auth_digest,))`. Soroban encodes
 * `require_auth_for_args` as a ContractFn invocation on the address with a
 * synthetic function name; the host builds the identical shape on-chain, so
 * the friend-signing and submit paths MUST construct it byte-identically.
 */
function buildFriendInvocation(
  friendAccount: string,
  parentAuthDigestHex: string,
): xdr.SorobanAuthorizedInvocation {
  const argScVal = xdr.ScVal.scvBytes(Buffer.from(hex2buf(parentAuthDigestHex)));
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(friendAccount).toScAddress(),
        functionName: '__check_auth',
        args: [argScVal],
      }),
    ),
    subInvocations: [],
  });
}

/**
 * Compute a friend's `signature_payload` — the sha256 of the
 * HashIdPreimageSorobanAuthorization for the friend's nested invocation. This
 * is what the friend's own `__check_auth` receives as the host payload; the
 * friend then signs `auth_digest = sha256(signature_payload || [0].to_xdr())`.
 */
function friendSignaturePayload(args: {
  friendAccount: string;
  parentAuthDigestHex: string;
  nonce: string;
  signatureExpirationLedger: number;
}): Buffer {
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.TESTNET, 'utf-8')),
      nonce: xdr.Int64.fromString(args.nonce),
      signatureExpirationLedger: args.signatureExpirationLedger,
      invocation: buildFriendInvocation(args.friendAccount, args.parentAuthDigestHex),
    }),
  );
  return hash(preimage.toXDR());
}

// --- Friend side -----------------------------------------------------------

/**
 * Friend-side: decode a handoff link, review it, sign the rotation with the
 * friend's own primary passkey, and return the blob to hand back to the
 * originator.
 *
 * `friendAccount` is the friend's own smart account (the page this runs on).
 * The friend chooses a fresh nonce + expiration; those travel back in the blob
 * so the originator reconstructs the friend's nested entry byte-identically.
 */
export async function signRotationAsFriend(
  friendAccount: string,
  handoffEncoded: string,
): Promise<{ blob: string; description: string }> {
  const handoff = decodeRotationHandoff(handoffEncoded);
  if (!handoff.friends.includes(friendAccount)) {
    throw new Error('This recovery request does not list your account as a friend.');
  }

  const cred = loadCredential(friendAccount);
  if (!cred) throw new Error('No primary passkey registered for your account on this device.');
  const verifierAddress = await fetchVerifierAddress(friendAccount);

  // Recompute the PARENT auth digest from the shared tx so the friend signs
  // over exactly what the recovering account will require.
  const server = new rpc.Server(RPC_URL);
  const parentTx = TransactionBuilder.fromXDR(handoff.txXdr, Networks.TESTNET);
  const parentOp = (parentTx as unknown as { operations: xdr.Operation[] }).operations[0];
  const parentEnvelope = xdr.TransactionEnvelope.fromXDR(handoff.txXdr, 'base64');
  const parentIhf = parentEnvelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
  const parentRootAuth = parentIhf.auth()[0];
  void parentOp;
  const latest = await server.getLatestLedger();
  const lastLedger = latest.sequence;
  const parentSignaturePayload = buildAuthHash(
    parentRootAuth,
    Networks.TESTNET,
    lastLedger,
    0, // use the expiration baked into the shared tx; offset 0 keeps it as-is
  );
  const parentAuthDigest = computeAuthDigest(parentSignaturePayload, [handoff.recoveryRuleId]);
  const parentAuthDigestHex = Buffer.from(parentAuthDigest).toString('hex');

  // Friend's own nested-entry params.
  const nonce = randomNonce();
  const signatureExpirationLedger = lastLedger + 10000;
  const friendPayload = friendSignaturePayload({
    friendAccount,
    parentAuthDigestHex,
    nonce,
    signatureExpirationLedger,
  });
  const friendDigest = computeAuthDigest(friendPayload, [0]);

  // Sign the friend digest with the friend's primary passkey.
  const challenge = new ArrayBuffer(friendDigest.byteLength);
  new Uint8Array(challenge).set(friendDigest);
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [
        { id: cred.credentialId as unknown as Uint8Array<ArrayBuffer>, type: 'public-key' },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Passkey signing was cancelled.');
  const response = assertion.response as AuthenticatorAssertionResponse;
  const parsed = parseAssertionResponse({
    authenticatorData: response.authenticatorData,
    clientDataJSON: response.clientDataJSON,
    signature: response.signature,
  });

  const blob = encodeFriendSignature({
    friendAccount,
    verifierAddress,
    publicKey: hex2buf(cred.publicKey),
    authenticatorData: parsed.authenticatorData,
    clientDataJson: parsed.clientDataJson,
    signature: parsed.signature,
    nonce,
    signatureExpirationLedger,
  });
  return { blob, description: handoff.description };
}

function randomNonce(): string {
  // A random positive i64 fits in 63 bits; build from two 32-bit halves.
  const hi = BigInt(Math.floor(Math.random() * 0x7fffffff));
  const lo = BigInt(Math.floor(Math.random() * 0xffffffff));
  return ((hi << 32n) | lo).toString();
}

async function getSubmitter(): Promise<Keypair> {
  const stored = localStorage.getItem(SUBMITTER_KEY);
  if (stored) return Keypair.fromSecret(stored);
  const kp = Keypair.random();
  const resp = await fetch(`${FRIENDBOT_URL}?addr=${kp.publicKey()}`);
  if (!resp.ok) throw new Error(`Friendbot funding failed: ${resp.statusText}`);
  localStorage.setItem(SUBMITTER_KEY, kp.secret());
  return kp;
}

export { describeRotation, planRotation };
