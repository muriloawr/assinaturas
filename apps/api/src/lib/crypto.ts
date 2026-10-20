import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Formato: base64(iv).base64(authTag).base64(ciphertext)

export function encrypt(plain: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string, keyBase64: string): string {
  const [iv, tag, ciphertext] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !ciphertext) throw new Error("Valor criptografado em formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyBase64, "base64"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * A Appmax não assina os webhooks (sem HMAC). Para não aceitar chamadas de
 * qualquer um, a URL cadastrada leva um token derivado do id da loja.
 */
export function webhookToken(storeId: string, keyBase64: string): string {
  return createHmac("sha256", Buffer.from(keyBase64, "base64"))
    .update(`webhook:${storeId}`)
    .digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
