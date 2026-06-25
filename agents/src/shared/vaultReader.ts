import { blake2b } from "@noble/hashes/blake2b";
import casper from "casper-js-sdk";

const { PublicKey } = casper;

// Reads Odra vault state straight from chain over JSON-RPC. Server side, so it uses
// the public testnet node and needs no API key and no CORS. Odra stores every module
// field in one dictionary named "state". A field value lives at
// dictionary_item_key = hex(blake2b(index_bytes ++ mapping_data)), where index_bytes
// is the big endian u32 of the field path (a single byte index for a top level field)
// and mapping_data is the serialized Mapping key, empty for a plain Var. Field indices
// start at 1 in struct order.
//
// Vault fields, in order: 1 agent, 2 token, 3 total_shares, 4 total_assets,
// 5 shares (Mapping), 6 alloc_conservative, 7 alloc_growth, 8 last_decision, 9 fee_bps.

const FIELD = {
  agent: 1,
  token: 2,
  totalShares: 3,
  totalAssets: 4,
  shares: 5,
  allocConservative: 6,
  allocGrowth: 7,
  lastDecision: 8,
  feeBps: 9,
  totalYield: 10,
} as const;

const ONE = 1_000_000_000n; // 1 share at 9 decimals, the price scale

export interface VaultReaderConfig {
  node: string; // RPC url, e.g. https://node.testnet.casper.network/rpc
  packageHash: string; // vault package hash, with or without the hash- prefix
}

export interface VaultSummary {
  totalAssets: string;
  totalShares: string;
  totalYield: string;
  // Assets per share, scaled by 1e9. 1e9 means one to one, 1.08e9 means each share is
  // worth 1.08 of the asset, an 8 percent gain over a one to one deposit.
  sharePrice: string;
  allocation: { conservative: number; growth: number };
  lastDecision: string;
  feeBps: number;
}

export interface Position {
  shares: string; // raw shares, 9 decimals
  value: string; // current redeemable assets, raw, 9 decimals
  earned: string; // the holder's share of accrued yield, raw, 9 decimals
}

let rpcId = 0;

export class VaultReader {
  private node: string;
  private packageHash: string;
  private stateUref: string | null = null;

  constructor(cfg: VaultReaderConfig) {
    this.node = cfg.node;
    this.packageHash = cfg.packageHash.replace(/^hash-/, "").replace(/^0x/, "");
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const res = await fetch(this.node, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
    return body.result;
  }

  private async stateRootHash(): Promise<string> {
    return (await this.rpc("chain_get_state_root_hash", [])).state_root_hash;
  }

  // Resolve the latest contract hash from the package, then read its "state" uref.
  // Cached after the first lookup.
  private async resolveStateUref(srh: string): Promise<string> {
    if (this.stateUref) return this.stateUref;
    const pkg = await this.rpc("query_global_state", {
      state_identifier: { StateRootHash: srh },
      key: `hash-${this.packageHash}`,
      path: [],
    });
    const versions = pkg.stored_value?.ContractPackage?.versions ?? [];
    if (versions.length === 0) throw new Error("vault package has no versions");
    const latest = versions[versions.length - 1].contract_hash.replace(/^contract-/, "");
    const contract = await this.rpc("query_global_state", {
      state_identifier: { StateRootHash: srh },
      key: `hash-${latest}`,
      path: [],
    });
    const named = contract.stored_value?.Contract?.named_keys ?? [];
    const state = named.find((n: { name: string }) => n.name === "state");
    if (!state) throw new Error("vault contract has no state named key");
    this.stateUref = state.key;
    return this.stateUref!;
  }

  private itemKey(fieldIndex: number, mappingData?: Uint8Array): string {
    const idx = Buffer.from([0, 0, 0, fieldIndex]);
    const input = mappingData ? Buffer.concat([idx, Buffer.from(mappingData)]) : idx;
    return Buffer.from(blake2b(input, { dkLen: 32 })).toString("hex");
  }

  private async readItem(srh: string, seed: string, dik: string): Promise<number[] | null> {
    try {
      const r = await this.rpc("state_get_dictionary_item", {
        state_root_hash: srh,
        dictionary_identifier: { URef: { seed_uref: seed, dictionary_item_key: dik } },
      });
      return r.stored_value?.CLValue?.parsed ?? null;
    } catch {
      return null; // a missing key, an account with no shares, reads as null
    }
  }

  private async readVar(srh: string, seed: string, fieldIndex: number): Promise<number[] | null> {
    return this.readItem(srh, seed, this.itemKey(fieldIndex));
  }

  async summary(): Promise<VaultSummary> {
    const srh = await this.stateRootHash();
    const seed = await this.resolveStateUref(srh);
    const [ta, ts, ty, ac, ag, ld, fb] = await Promise.all([
      this.readVar(srh, seed, FIELD.totalAssets),
      this.readVar(srh, seed, FIELD.totalShares),
      this.readVar(srh, seed, FIELD.totalYield),
      this.readVar(srh, seed, FIELD.allocConservative),
      this.readVar(srh, seed, FIELD.allocGrowth),
      this.readVar(srh, seed, FIELD.lastDecision),
      this.readVar(srh, seed, FIELD.feeBps),
    ]);
    const totalAssets = BigInt(decodeU256(ta));
    const totalShares = BigInt(decodeU256(ts));
    const sharePrice = totalShares > 0n ? (totalAssets * ONE) / totalShares : ONE;
    return {
      totalAssets: totalAssets.toString(),
      totalShares: totalShares.toString(),
      totalYield: decodeU256(ty),
      sharePrice: sharePrice.toString(),
      allocation: { conservative: decodeU8(ac), growth: decodeU8(ag) },
      lastDecision: decodeString(ld),
      feeBps: decodeU32(fb),
    };
  }

  // Shares for an owner, given a public key hex or an account hash.
  async sharesOf(accountInput: string): Promise<string> {
    const srh = await this.stateRootHash();
    const seed = await this.resolveStateUref(srh);
    return this.readSharesAt(srh, seed, accountInput);
  }

  private async readSharesAt(srh: string, seed: string, accountInput: string): Promise<string> {
    const accountHash = toAccountHash(accountInput);
    const mappingData = Buffer.concat([Buffer.from([0x00]), Buffer.from(accountHash, "hex")]);
    const bytes = await this.readItem(srh, seed, this.itemKey(FIELD.shares, mappingData));
    return decodeU256(bytes);
  }

  // A holder's shares, their current redeemable value, and their share of the yield.
  // Value is shares times assets per share. Earned is the holder's proportional slice
  // of the total yield ever accrued, shares over total shares times total yield, which
  // needs no off chain cost basis and is read straight from the contract.
  async position(accountInput: string): Promise<Position> {
    const srh = await this.stateRootHash();
    const seed = await this.resolveStateUref(srh);
    const [sharesStr, taStr, tsStr, tyStr] = await Promise.all([
      this.readSharesAt(srh, seed, accountInput),
      this.readVar(srh, seed, FIELD.totalAssets).then(decodeU256),
      this.readVar(srh, seed, FIELD.totalShares).then(decodeU256),
      this.readVar(srh, seed, FIELD.totalYield).then(decodeU256),
    ]);
    const shares = BigInt(sharesStr);
    const totalAssets = BigInt(taStr);
    const totalShares = BigInt(tsStr);
    const totalYield = BigInt(tyStr);
    const value = totalShares > 0n ? (shares * totalAssets) / totalShares : 0n;
    const earned = totalShares > 0n ? (shares * totalYield) / totalShares : 0n;
    return { shares: shares.toString(), value: value.toString(), earned: earned.toString() };
  }
}

// Convert a public key hex or an account-hash string to the 64 char account hash hex.
export function toAccountHash(input: string): string {
  const v = input.trim();
  if (v.startsWith("account-hash-")) return v.slice("account-hash-".length);
  if (/^0[12][0-9a-fA-F]{66}$/.test(v) || /^0[12][0-9a-fA-F]{64}$/.test(v)) {
    return PublicKey.fromHex(v).accountHash().toHex();
  }
  if (/^[0-9a-fA-F]{64}$/.test(v)) return v; // already an account hash
  // Last resort, try to parse as a public key.
  return PublicKey.fromHex(v).accountHash().toHex();
}

// Odra stores values as their raw bytesrepr serialization, surfaced by the node as a
// CLValue of type List<U8>, so parsed is a byte array. Decode per the stored type.

export function decodeU256(bytes: number[] | null): string {
  if (!bytes || bytes.length === 0) return "0";
  const n = bytes[0];
  let v = 0n;
  for (let i = 0; i < n; i++) v += BigInt(bytes[1 + i]) << (8n * BigInt(i));
  return v.toString();
}

export function decodeU8(bytes: number[] | null): number {
  return bytes && bytes.length > 0 ? bytes[0] : 0;
}

export function decodeU32(bytes: number[] | null): number {
  if (!bytes || bytes.length < 4) return 0;
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}

export function decodeString(bytes: number[] | null): string {
  if (!bytes || bytes.length < 4) return "";
  const len = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return Buffer.from(bytes.slice(4, 4 + len)).toString("utf8");
}
