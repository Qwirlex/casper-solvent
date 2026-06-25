import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import casper from "casper-js-sdk";
import { ExactCasperScheme } from "@make-software/casper-x402/exact/client";
import { toClientCasperSigner } from "@make-software/casper-x402";
import { startDataAgent } from "../src/dataAgent/server.js";
import { payAndGet, type ClientSigner } from "../src/fundAgent/x402Client.js";
import {
  buildRequirements,
  verifyPayment,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
} from "../src/shared/x402.js";

const { PrivateKey, KeyAlgorithm } = casper;

// A funded looking pay token package hash, 64 hex. Any valid hash works for the
// handshake, the signature binds to it through the EIP-712 domain.
const ASSET = "77b6965b86199ef296953065c643661d67bb7f588d7b1b02c0444c2b59dd901e";
const PAY_TO = "account-hash-3bcc0b3b98b667b6d7d95105b076f9389ccabbc4be16ab4def9be21b733797b9";
const PRICE = "1000000000";
const PORT = 4133;

// Ephemeral payer signer, generated per run so no real key is touched.
function makeSigner(): ClientSigner {
  const priv = PrivateKey.generate(KeyAlgorithm.SECP256K1);
  return toClientCasperSigner(priv) as ClientSigner;
}

async function signFor(
  signer: ClientSigner,
  requirements: PaymentRequirements,
): Promise<PaymentPayload> {
  const created = await new ExactCasperScheme(signer).createPaymentPayload(X402_VERSION, requirements as never);
  return { x402Version: X402_VERSION, accepted: requirements, payload: created.payload as never };
}

describe("verifyPayment", () => {
  const requirements = buildRequirements({ asset: ASSET, payTo: PAY_TO, amount: PRICE });

  it("accepts a payload signed for the requirements", async () => {
    const payload = await signFor(makeSigner(), requirements);
    const r = verifyPayment(payload, requirements);
    expect(r.valid).toBe(true);
    expect(r.payer).toBe(payload.payload.authorization.from);
  });

  it("rejects a payload whose amount was tampered after signing", async () => {
    const payload = await signFor(makeSigner(), requirements);
    payload.payload.authorization.value = "1"; // below required, also breaks the signature
    const r = verifyPayment(payload, requirements);
    expect(r.valid).toBe(false);
  });

  it("rejects an expired authorization", async () => {
    const payload = await signFor(makeSigner(), requirements);
    const future = Number(payload.payload.authorization.validBefore) + 10;
    const r = verifyPayment(payload, requirements, { now: future });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/expired/);
  });

  it("rejects a replayed nonce", async () => {
    const payload = await signFor(makeSigner(), requirements);
    const seen = new Set<string>();
    expect(verifyPayment(payload, requirements, { seenNonces: seen }).valid).toBe(true);
    const replay = verifyPayment(payload, requirements, { seenNonces: seen });
    expect(replay.valid).toBe(false);
    expect(replay.reason).toMatch(/replay/);
  });

  it("rejects a payment whose recipient does not match", async () => {
    const other = buildRequirements({
      asset: ASSET,
      payTo: "account-hash-1d9254a2f50645ef7c956e667f1751b017d06a09ed259be5b8c3de9588f48148",
      amount: PRICE,
    });
    const payload = await signFor(makeSigner(), other);
    const r = verifyPayment(payload, requirements);
    expect(r.valid).toBe(false);
  });
});

describe("x402 handshake round trip", () => {
  let server: Server;

  beforeAll(async () => {
    server = startDataAgent(PORT, { asset: ASSET, payTo: PAY_TO, price: PRICE });
    await new Promise((r) => setTimeout(r, 300));
  });
  afterAll(() => server.close());

  it("answers an unpaid request with 402 and payment requirements", async () => {
    const res = await fetch(`http://localhost:${PORT}/feed`);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.accepts[0].scheme).toBe("exact");
    expect(body.accepts[0].asset).toBe(ASSET);
  });

  it("serves the resource after a signed payment and returns a receipt", async () => {
    const signer = makeSigner();
    const result = await payAndGet<{ price: number }>(`http://localhost:${PORT}/feed`, {
      signer,
      settle: async () => "settlement-tx-abc",
    });
    expect(typeof result.data.price).toBe("number");
    expect(result.payment).not.toBeNull();
    expect(result.payment?.settlement).toBe("settlement-tx-abc");
    expect(result.payment?.payer).toBe(signer.accountAddress());
  });
});
