/* Unit tests for the badge cache-staleness rule. */
import test from "node:test";
import assert from "node:assert/strict";
import { shouldRefetch, BADGE_CACHE_MS } from "./badge.js";

test("no cache entry -> refetch", () => {
  assert.equal(shouldRefetch(null, "https://example.com", 1_000), true);
  assert.equal(shouldRefetch(undefined, "https://example.com", 1_000), true);
});

test("URL changed -> refetch", () => {
  const entry = { url: "https://a.com", ts: 1_000 };
  assert.equal(shouldRefetch(entry, "https://b.com", 2_000), true);
});

test("URL unchanged + within TTL -> reuse", () => {
  const entry = { url: "https://a.com", ts: 1_000 };
  assert.equal(shouldRefetch(entry, "https://a.com", 1_000 + BADGE_CACHE_MS - 1), false);
});

test("URL unchanged + at TTL boundary -> reuse", () => {
  const entry = { url: "https://a.com", ts: 1_000 };
  assert.equal(shouldRefetch(entry, "https://a.com", 1_000 + BADGE_CACHE_MS), false);
});

test("URL unchanged + past TTL -> refetch", () => {
  const entry = { url: "https://a.com", ts: 1_000 };
  assert.equal(shouldRefetch(entry, "https://a.com", 1_000 + BADGE_CACHE_MS + 1), true);
});

test("missing ts -> refetch", () => {
  const entry = { url: "https://a.com" };
  assert.equal(shouldRefetch(entry, "https://a.com", 5_000), true);
});

test("empty current URL -> nothing to do", () => {
  const entry = { url: "https://a.com", ts: 1_000 };
  assert.equal(shouldRefetch(entry, "", 5_000), false);
});
