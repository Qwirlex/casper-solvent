import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  buildRequirements,
  decodePaymentHeader,
  verifyPayment,
  X402_VERSION,
  type PaymentPayload,
} from "./x402.js";

export interface X402GateOptions {
  asset: string; // pay token package hash
  payTo: string; // service account, account-hash form
  amount: string; // atomic price per call
  tokenName?: string;
  tokenVersion?: string;
  resource?: string; // description for the 402 body
}

// What the gate attaches to the request once payment verifies.
export interface X402Context {
  payer: string;
  settlement: string;
  payload: PaymentPayload;
}

// Express middleware that enforces an x402 payment on a route. No X-PAYMENT header
// gives a 402 with the payment requirements. A present header is verified, and on
// success the request proceeds and an X-PAYMENT-RESPONSE settlement receipt is set.
export function x402Gate(opts: X402GateOptions): RequestHandler {
  const seenNonces = new Set<string>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const requirements = buildRequirements({
      asset: opts.asset,
      payTo: opts.payTo,
      amount: opts.amount,
      tokenName: opts.tokenName,
      tokenVersion: opts.tokenVersion,
    });

    const challenge = (reason: string) =>
      res.status(402).json({
        x402Version: X402_VERSION,
        error: reason,
        resource: opts.resource ?? req.path,
        accepts: [requirements],
      });

    const header = req.header("x-payment");
    if (!header) {
      challenge("payment required");
      return;
    }

    let payload: PaymentPayload;
    try {
      payload = decodePaymentHeader(header);
    } catch {
      challenge("malformed x-payment header");
      return;
    }

    const result = verifyPayment(payload, requirements, { seenNonces });
    if (!result.valid) {
      challenge(result.reason ?? "payment invalid");
      return;
    }

    const settlement = req.header("x-settlement") ?? "";
    const receipt = {
      success: true,
      payer: result.payer,
      transaction: settlement,
      network: requirements.network,
      amount: requirements.amount,
      asset: requirements.asset,
    };
    res.setHeader("x-payment-response", Buffer.from(JSON.stringify(receipt), "utf8").toString("base64"));

    (req as Request & { x402?: X402Context }).x402 = {
      payer: result.payer ?? "",
      settlement,
      payload,
    };
    next();
  };
}
