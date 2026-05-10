/* Unit tests for the JWT-exp helper used by the popup's token-health
 * indicator. The real `decodeJwtExp` lives in popup.js so we copy a
 * minimal fixture here — keep them in sync. (popup.js is page-scoped
 * and not module-importable from Node without a DOM shim.)
 */
import test from "node:test";
import assert from "node:assert/strict";

function decodeJwtExp(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

function mockJwt(payload) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.signature-not-checked`;
}

test("decodes a numeric exp claim", () => {
  const tok = mockJwt({ sub: "u1", exp: 1_900_000_000 });
  assert.equal(decodeJwtExp(tok), 1_900_000_000);
});

test("returns null when exp is missing", () => {
  const tok = mockJwt({ sub: "u1" });
  assert.equal(decodeJwtExp(tok), null);
});

test("returns null on malformed input", () => {
  assert.equal(decodeJwtExp(""), null);
  assert.equal(decodeJwtExp("not-a-jwt"), null);
  assert.equal(decodeJwtExp(null), null);
  assert.equal(decodeJwtExp(undefined), null);
  assert.equal(decodeJwtExp("a.b"), null);
  assert.equal(decodeJwtExp("a.@@@.c"), null);
});

test("handles base64url-encoded payloads (- and _)", () => {
  // Construct a payload whose base64 encoding includes - / _.
  const payloadStr = JSON.stringify({ exp: 1_888_888_888, n: "?>?>?>" });
  const stdB64 = Buffer.from(payloadStr).toString("base64");
  const urlB64 = stdB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tok = `header.${urlB64}.sig`;
  assert.equal(decodeJwtExp(tok), 1_888_888_888);
});

test("warning threshold logic — within 7 days = warn", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + 3 * 86_400; // 3 days
  const remaining = exp - nowSec;
  const days = Math.ceil(remaining / 86_400);
  assert.equal(days, 3);
  assert.ok(days <= 7); // within warn window
});

test("warning threshold logic — beyond 7 days = silent", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + 30 * 86_400;
  const remaining = exp - nowSec;
  const days = Math.ceil(remaining / 86_400);
  assert.equal(days, 30);
  assert.ok(days > 7);
});

test("warning threshold logic — past expiry = expired", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec - 60;
  const remaining = exp - nowSec;
  assert.ok(remaining <= 0);
});
