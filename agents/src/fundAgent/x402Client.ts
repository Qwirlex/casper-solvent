import casper from "casper-js-sdk";
import { ExactCasperScheme } from "@make-software/casper-x402/exact/client";
import { toClientCasperSigner } from "@make-software/casper-x402";
import {
  encodePaymentHeader,
  X402_VERSION,
  type PaymentRequirements,
  type ExactCasperPayload,
  type PaymentPayload,
} from "../shared/x402.js";

const { PrivateKey, KeyAlgorithm } = casper;

// A Casper x402 client signer. Produced from a PEM key, used to sign the EIP-712
// authorization for each paid call.
export interface ClientSigner {
  accountAddress(): string;
  publicKey(): string;
  signEIP712(digest: Uint8Array): Promise<Uint8Array>;
}

export interface X402Receipt {
  payer: string;
  asset: string;
  value: string;
  payTo: string;
  nonce: string;
  settlement: string; // on chain CEP-18 transfer hash
}

export interface PaidResult<T> {
  data: T;
  payment: X402Receipt | null;
}

export interface PayOptions {
  signer: ClientSigner;
  // Settle the verified authorization on chain and return the transaction hash. For
  // the current CEP-18 this is a transfer the payer submits itself.
  settle: (requirements: PaymentRequirements) => Promise<string>;
  fetchImpl?: typeof fetch;
}

// Load a Casper x402 client signer from a secp256k1 PEM file.
export async function loadClientSigner(pemPath: string): Promise<ClientSigner> {
  const pem = await (await import("node:fs/promises")).readFile(pemPath, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
  return toClientCasperSigner(priv) as ClientSigner;
}

function pickRequirements(body: unknown): PaymentRequirements {
  const accepts = (body as { accepts?: PaymentRequirements[] })?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error("402 response carried no payment requirements");
  }
  const exact = accepts.find((r) => r.scheme === "exact") ?? accepts[0];
  return exact;
}

// Perform the full x402 handshake for a resource. An unpaid GET returns 402 with
// requirements. The client signs the authorization, settles on chain, and retries
// with the X-PAYMENT and X-SETTLEMENT headers. Returns the resource body and a
// receipt. A resource that is not gated, a 200 on the first call, returns with a
// null payment.
export async function payAndGet<T = unknown>(url: string, opts: PayOptions): Promise<PaidResult<T>> {
  const doFetch = opts.fetchImpl ?? fetch;

  const first = await doFetch(url);
  if (first.ok) {
    return { data: (await first.json()) as T, payment: null };
  }
  if (first.status !== 402) {
    throw new Error(`unexpected ${first.status} for ${url}`);
  }

  const requirements = pickRequirements(await first.json());

  const scheme = new ExactCasperScheme(opts.signer);
  const created = await scheme.createPaymentPayload(X402_VERSION, requirements as never);
  const exactPayload = created.payload as unknown as ExactCasperPayload;

  const settlement = await opts.settle(requirements);

  const payment: PaymentPayload = {
    x402Version: X402_VERSION,
    accepted: requirements,
    payload: exactPayload,
  };

  const paid = await doFetch(url, {
    headers: {
      "x-payment": encodePaymentHeader(payment),
      "x-settlement": settlement,
    },
  });
  if (!paid.ok) {
    let reason = String(paid.status);
    try {
      const b = (await paid.json()) as { error?: string };
      if (b?.error) reason = b.error;
    } catch {
      // ignore
    }
    throw new Error(`paid request rejected for ${url}: ${reason}`);
  }

  return {
    data: (await paid.json()) as T,
    payment: {
      payer: exactPayload.authorization.from,
      asset: requirements.asset,
      value: exactPayload.authorization.value,
      payTo: requirements.payTo,
      nonce: exactPayload.authorization.nonce,
      settlement,
    },
  };
}
