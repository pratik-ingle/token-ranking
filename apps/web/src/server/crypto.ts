import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Purpose-separated subkeys derived from SERVER_SECRET via HKDF. */
function subkey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", env.serverSecret, "tokenrank", `tokenrank:${purpose}`, 32));
}

export function hmacHex(purpose: "org-fingerprint" | "recovery-email" | "cookie", data: string): string {
  return createHmac("sha256", subkey(purpose)).update(data, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Org de-duplication fingerprint. Clients send sha256(source:org_id); the
 * server never sees (or stores) the org id, only HMAC(secret, that hash).
 * For cloud sync the server computes the same input from the org id it
 * fetched, then discards the id.
 */
export function orgFingerprintHmac(fingerprintInput: string): string {
  return hmacHex("org-fingerprint", fingerprintInput.toLowerCase());
}

export function recoveryEmailHmac(email: string): string {
  return hmacHex("recovery-email", email.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Envelope encryption: credential --(per-user data key)--> ciphertext,
// data key --(master key / KMS)--> wrapped key stored in user_keys.
// ---------------------------------------------------------------------------

export interface Kms {
  wrap(dataKey: Buffer): Promise<string>;
  unwrap(wrapped: string): Promise<Buffer>;
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

function aesGcmDecrypt(key: Buffer, payload: string, aad: string): Buffer {
  const [version, iv, ct, tag] = payload.split(".");
  if (version !== "v1" || !iv || !ct || !tag) throw new Error("unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
}

/**
 * Local KMS: the key-encryption key comes from the MASTER_KEY env secret.
 * Swap for a cloud KMS (AWS KMS Encrypt/Decrypt, GCP KMS, Vault transit) by
 * implementing the same two methods.
 */
export class LocalKms implements Kms {
  private readonly kek: Buffer;
  constructor(masterKeyBase64: string) {
    const key = Buffer.from(masterKeyBase64, "base64");
    if (key.length !== 32) throw new Error("MASTER_KEY must be 32 bytes, base64-encoded");
    this.kek = key;
  }
  async wrap(dataKey: Buffer): Promise<string> {
    return aesGcmEncrypt(this.kek, dataKey, "tokenrank:dek");
  }
  async unwrap(wrapped: string): Promise<Buffer> {
    return aesGcmDecrypt(this.kek, wrapped, "tokenrank:dek");
  }
}

let kms: Kms | null = null;
export function getKms(): Kms {
  kms ??= new LocalKms(env.masterKey);
  return kms;
}
export function setKms(k: Kms | null): void {
  kms = k;
}

export function newDataKey(): Buffer {
  return randomBytes(32);
}

/** AAD binds a ciphertext to its owner and source so rows can't be swapped. */
export function encryptCredential(dataKey: Buffer, credential: unknown, aad: string): string {
  return aesGcmEncrypt(dataKey, Buffer.from(JSON.stringify(credential), "utf8"), aad);
}

export function decryptCredential<T>(dataKey: Buffer, payload: string, aad: string): T {
  return JSON.parse(aesGcmDecrypt(dataKey, payload, aad).toString("utf8")) as T;
}
