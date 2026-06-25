import { describe, it, expect } from "vitest";
import { decodeU256, decodeU8, decodeU32, decodeString, toAccountHash } from "../src/shared/vaultReader.js";

// Decoders operate on the raw bytesrepr bytes the node returns as a List<U8>. These
// fixtures are the exact byte arrays read from the live vault during development.

describe("vault state decoders", () => {
  it("decodes a U256 with a length prefix and little endian bytes", () => {
    // 19,000,000,000 = 0x046c7cfe00, stored as [len, ...LE]
    expect(decodeU256([5, 0, 254, 124, 108, 4])).toBe("19000000000");
  });

  it("decodes zero and empty U256", () => {
    expect(decodeU256([0])).toBe("0");
    expect(decodeU256(null)).toBe("0");
  });

  it("decodes a U8", () => {
    expect(decodeU8([3])).toBe(3);
    expect(decodeU8([97])).toBe(97);
    expect(decodeU8(null)).toBe(0);
  });

  it("decodes a u32 as four little endian bytes", () => {
    expect(decodeU32([0, 0, 0, 0])).toBe(0);
    expect(decodeU32([210, 4, 0, 0])).toBe(1234);
  });

  it("decodes a length prefixed string", () => {
    // "risk-3-growth-97" with a 4 byte LE length of 16
    const bytes = [16, 0, 0, 0, ...Buffer.from("risk-3-growth-97", "utf8")];
    expect(decodeString(bytes)).toBe("risk-3-growth-97");
  });
});

describe("toAccountHash", () => {
  it("passes through an account-hash string", () => {
    expect(toAccountHash("account-hash-c9c6b8f622cbeee77fca9e6e5d3f739f30e4116a1f5c41f6ccf2e0ddedb84383")).toBe(
      "c9c6b8f622cbeee77fca9e6e5d3f739f30e4116a1f5c41f6ccf2e0ddedb84383",
    );
  });

  it("derives the account hash from a secp256k1 public key", () => {
    const acct = toAccountHash("02020f62f89d5d78d79eba973ed5a45556b1dd6e1a31c5fb9490f634394e1af1a7ad");
    expect(acct).toBe("c9c6b8f622cbeee77fca9e6e5d3f739f30e4116a1f5c41f6ccf2e0ddedb84383");
  });
});
