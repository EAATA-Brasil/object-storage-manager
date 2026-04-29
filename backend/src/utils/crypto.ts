import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const KEY = process.env.MASTER_ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef"; // 32 chars
const IV_LENGTH = 16;

export function encrypt(text: string): string {
  if (!text) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(text: string): string {
  if (!text) return "";
  try {
    const textParts = text.split(":");
    const iv = Buffer.from(textParts.shift()!, "hex");
    const encryptedText = Buffer.from(textParts.join(":"), "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error("Decryption failed. Using raw text as fallback.");
    return text; // Se falhar, assume que não está criptografado (migração)
  }
}
