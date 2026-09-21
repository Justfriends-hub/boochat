import crypto from "node:crypto";
const { BASE = "https://moneymatesupport.online", SLUG, SECRET, EXT_ID = "test-user-001", EMAIL = "testuser@example.com", DEST } = process.env;
const now = Math.floor(Date.now() / 1000);
const payload = {
  partner: SLUG,
  ext_user_id: EXT_ID,
  email: EMAIL,
  name: "Test User",
  iat: now,
  exp: now + 300,
  nonce: crypto.randomUUID(),
  ...(DEST === "support"
    ? { dest: "support", note: "📋 Payment Support Request\n💰 Amount: ₦15,000\n🏦 Method: Test" }
    : {}),
};
const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const unsigned = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
const token = `${unsigned}.${crypto.createHmac("sha256", SECRET).update(unsigned).digest("base64url")}`;
const r = await fetch(`${BASE}/api/partner/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ partner: SLUG, token }),
});
const body = await r.json();
console.log(r.status, { ...body, accessToken: body.accessToken ? "<redacted>" : undefined, refreshToken: body.refreshToken ? "<redacted>" : undefined });
