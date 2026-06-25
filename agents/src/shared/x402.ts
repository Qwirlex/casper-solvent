// Real x402 protocol layer for Casper, the exact scheme.
//
// This is the actual HTTP 402 handshake, not a stub. A resource server answers an
// unpaid request with 402 and a set of PaymentRequirements. The client signs an
// EIP-712 TransferWithAuthorization over those requirements with its Casper key,
// encodes it into the X-PAYMENT header, and retries. The server verifies the
// signature with the same EIP-712 digest the official @make-software/casper-x402
// SDK produces, so a payload built by the SDK client verifies here and vice versa.
//
// Settlement note. The token used for fees is a plain CEP-18, which cannot pull a
// transfer from a signed authorization on chain yet. So the on chain settlement is
// a CEP-18 transfer the payer submits itself, and its hash travels in X-SETTLEMENT.
// The production upgrade is a CEP-18 with transfer_with_authorization plus a
// facilitator that submits it, the path the SDK facilitator already implements.
import casper from "casper-js-sdk";
import { buildDomain, hashTypedData, CASPER_DOMAIN_TYPES, fromHex } from "@casper-ecosystem/casper-eip-712";

const { PublicKey } = casper;

export const X402_VERSION = 2;
export const X402_NETWORK = "casper:casper-test";
export const X402_SCHEME = "exact";

// EIP-712 type used by the exact Casper scheme, matched byte for byte to the SDK so
// signatures are interchangeable with @make-software/casper-x402.
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

// EIP-712 domain identity for the fee token. Client and server must agree, the
// values only need to match across the handshake since the on chain settlement is a
// plain CEP-18 transfer today, not an in contract authorization check.
export const X402_TOKEN_NAME = process.env.X402_TOKEN_NAME ?? "Solvent USD";
export const X402_TOKEN_VERSION = process.env.X402_TOKEN_VERSION ?? "1";

export interface ExactCasperAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface ExactCasperPayload {
  signature: string;
  publicKey: string;
  authorization: ExactCasperAuthorization;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface PaymentPayload {
  x402Version: number;
  accepted: PaymentRequirements;
  payload: ExactCasperPayload;
}

// Normalise a Casper address to the 66 character x402 form, account-hash with the
// "00" algorithm prefix. Accepts the "account-hash-" string, a raw 64 char hash, or
// an already prefixed value.
export function toX402Address(value: string): string {
  let h = value.trim();
  if (h.startsWith("account-hash-")) h = h.slice("account-hash-".length);
  if (h.length === 66 && h.startsWith("00")) return h;
  if (h.length === 64) return "00" + h;
  throw new Error(`cannot normalise address ${value}`);
}

// Strip an Odra package hash to the raw 64 hex characters the asset field expects.
export function toAssetHash(value: string): string {
  return value.replace(/^hash-/, "").replace(/^0x/, "");
}

export interface BuildRequirementsOptions {
  asset: string;
  payTo: string;
  amount: string;
  tokenName?: string;
  tokenVersion?: string;
  maxTimeoutSeconds?: number;
}

export function buildRequirements(opts: BuildRequirementsOptions): PaymentRequirements {
  return {
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    asset: toAssetHash(opts.asset),
    amount: opts.amount,
    payTo: toX402Address(opts.payTo),
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 120,
    extra: {
      name: opts.tokenName ?? X402_TOKEN_NAME,
      version: opts.tokenVersion ?? X402_TOKEN_VERSION,
    },
  };
}

export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodePaymentHeader(header: string): PaymentPayload {
  const json = Buffer.from(header, "base64").toString("utf8");
  const p = JSON.parse(json) as PaymentPayload;
  if (!p || !p.payload || !p.payload.authorization) throw new Error("malformed x402 payment header");
  return p;
}

export interface VerifyOptions {
  now?: number; // unix seconds, for tests
  seenNonces?: Set<string>; // replay protection, mutated in place
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  payer?: string;
}

// Verify an exact Casper payment against requirements. Mirrors the SDK facilitator
// verify: rebuild the EIP-712 digest, check the payer public key derives the
// authorization.from account hash, then verify the signature with that public key.
export function verifyPayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  opts: VerifyOptions = {},
): VerifyResult {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const p = payload?.payload;
  if (!p || !p.signature || !p.publicKey || !p.authorization) {
    return { valid: false, reason: "missing payment fields" };
  }
  const a = p.authorization;

  if (payload.accepted?.scheme !== requirements.scheme) return { valid: false, reason: "scheme mismatch" };
  if (payload.accepted?.network !== requirements.network) return { valid: false, reason: "network mismatch" };
  if (toAssetHash(payload.accepted?.asset ?? "") !== requirements.asset) {
    return { valid: false, reason: "asset mismatch" };
  }

  // The authorization recipient and amount must match what the server demanded.
  let payTo: string;
  try {
    payTo = toX402Address(a.to);
  } catch {
    return { valid: false, reason: "bad recipient" };
  }
  if (payTo !== requirements.payTo) return { valid: false, reason: "recipient mismatch", payer: a.from };
  let value: bigint;
  let required: bigint;
  try {
    value = BigInt(a.value);
    required = BigInt(requirements.amount);
  } catch {
    return { valid: false, reason: "bad amount", payer: a.from };
  }
  if (value < required) return { valid: false, reason: "amount too low", payer: a.from };

  // Validity window.
  const validAfter = Number(a.validAfter);
  const validBefore = Number(a.validBefore);
  if (!(now >= validAfter)) return { valid: false, reason: "not yet valid", payer: a.from };
  if (!(now < validBefore)) return { valid: false, reason: "authorization expired", payer: a.from };

  // Replay protection.
  if (opts.seenNonces) {
    if (opts.seenNonces.has(a.nonce)) return { valid: false, reason: "nonce replay", payer: a.from };
  }

  // Rebuild the exact EIP-712 digest and verify the signature.
  let ok = false;
  try {
    const domain = buildDomain(
      requirements.extra.name as string,
      requirements.extra.version as string,
      requirements.network,
      "0x" + requirements.asset,
    );
    const message = {
      from: "0x" + a.from,
      to: "0x" + a.to,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: "0x" + a.nonce,
    };
    const digest = hashTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, "TransferWithAuthorization", message, {
      domainTypes: CASPER_DOMAIN_TYPES,
    });
    const pub = PublicKey.fromHex(p.publicKey);
    if (pub.accountHash().toHex() !== a.from.slice(2)) {
      return { valid: false, reason: "public key does not match payer", payer: a.from };
    }
    // casper-js-sdk verifySignature throws on a bad signature instead of returning
    // false, so a throw here means invalid.
    ok = pub.verifySignature(digest, fromHex(p.signature));
  } catch {
    return { valid: false, reason: "signature verification failed", payer: a.from };
  }
  if (!ok) return { valid: false, reason: "signature verification failed", payer: a.from };

  if (opts.seenNonces) opts.seenNonces.add(a.nonce);
  return { valid: true, payer: a.from };
}
