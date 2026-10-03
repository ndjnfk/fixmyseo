import crypto from "node:crypto";

const { ENC_KEY } = process.env;

export const encReady = () => ENC_KEY?.length === 64;

// secrets DB mein encrypted (AES-256-GCM) rakhte hain
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENC_KEY, "hex"), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decrypt(b64) {
  const buf = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENC_KEY, "hex"), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
