// Enumerate Casper Wallet account candidates from a 24-word mnemonic.
// Casper Wallet uses casper-storage: mnemonic -> entropy -> HD (SLIP-0010), path m/44'/506'/0'/0/index.
// We try several inputs/curves/indices and print every candidate public key so the
// caller can pick the one that actually holds the funded testnet balance.
const { User, EncryptionType, KeyFactory } = require("casper-storage");

const MNEMONIC = process.argv[2];
if (!MNEMONIC) { console.error("usage: node derive.js \"<24 words>\""); process.exit(1); }

const kf = KeyFactory.getInstance();

async function candidatesFor(label, keyBytes, type, maxIndex = 3) {
  const out = [];
  const user = new User("Aa1!aaaaaaaa"); // password only gates serialization, irrelevant here
  await user.setHDWallet(keyBytes, type);
  for (let i = 0; i < maxIndex; i++) {
    const w = await user.getWalletAccount(i);
    const pub = await w.getPublicKey();              // hex, 01.. ed25519 / 02.. secp256k1
    const priv = Buffer.from(w.getPrivateKeyByteArray()).toString("hex");
    out.push({ source: label, type, index: i, publicKey: pub, privHex: priv });
  }
  return out;
}

(async () => {
  const words = MNEMONIC.trim().split(/\s+/);
  const entropy = kf.toEntropy(words);               // Casper Wallet input
  let all = [];
  all = all.concat(await candidatesFor("entropy", entropy, EncryptionType.Ed25519));
  all = all.concat(await candidatesFor("entropy", entropy, EncryptionType.Secp256k1));
  // dedupe by publicKey, keep first
  const seen = new Set();
  const uniq = all.filter(c => (seen.has(c.publicKey) ? false : (seen.add(c.publicKey), true)));
  console.log(JSON.stringify(uniq, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
