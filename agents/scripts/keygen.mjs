import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

// Generates a Casper Ed25519 account key. Writes a PKCS8 PEM secret key that
// casper-client and casper-js-sdk both read, and prints the public key hex with
// the Casper Ed25519 prefix 01. The keys folder is gitignored.
const dir = "../keys/agent";
mkdirSync(dir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
writeFileSync(`${dir}/secret_key.pem`, pem);

const spkiDer = publicKey.export({ type: "spki", format: "der" });
const raw = spkiDer.subarray(spkiDer.length - 32);
const hex = "01" + Buffer.from(raw).toString("hex");
writeFileSync(`${dir}/public_key_hex`, hex + "\n");

console.log("secret_key.pem written to keys/agent/");
console.log("PUBLIC_KEY_HEX " + hex);
