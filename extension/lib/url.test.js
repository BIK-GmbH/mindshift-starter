/* Unit tests for canonicalizeUrl. Run via `node --test extension/lib/url.test.js`.
 *
 * The same set of cases is mirrored in
 * `backend/tests/test_url_normalize.py` — keep them in lockstep.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl } from "./url.js";

const cases = [
  // [label, input, expected]
  [
    "youtube watch + tracking params → canonical v=ID",
    "https://www.youtube.com/watch?v=abc123&utm_source=newsletter&si=xyz",
    "https://www.youtube.com/watch?v=abc123",
  ],
  [
    "youtu.be short link → canonical watch URL",
    "https://youtu.be/abc123?si=xyz&t=42",
    "https://www.youtube.com/watch?v=abc123&t=42",
  ],
  [
    "youtube shorts → canonical watch URL",
    "https://www.youtube.com/shorts/abc123",
    "https://www.youtube.com/watch?v=abc123",
  ],
  [
    "m.youtube.com → canonical desktop watch URL",
    "https://m.youtube.com/watch?v=abc123",
    "https://www.youtube.com/watch?v=abc123",
  ],
  [
    "youtube preserves t= start timestamp",
    "https://www.youtube.com/watch?v=abc123&t=120s",
    "https://www.youtube.com/watch?v=abc123&t=120s",
  ],
  [
    "article with utm_*, gclid, fbclid is stripped",
    "https://example.com/post?id=42&utm_source=x&utm_medium=y&gclid=z&fbclid=q",
    "https://example.com/post?id=42",
  ],
  [
    "ref / ref_src / igshid stripped",
    "https://example.com/p?id=1&ref=foo&ref_src=bar&igshid=baz",
    "https://example.com/p?id=1",
  ],
  [
    "uppercase scheme + host lowercased",
    "HTTPS://Example.COM/About",
    "https://example.com/About",
  ],
  [
    "default port stripped (https:443)",
    "https://example.com:443/path",
    "https://example.com/path",
  ],
  [
    "default port stripped (http:80)",
    "http://example.com:80/",
    "http://example.com",
  ],
  [
    "trailing slash on root collapsed",
    "https://example.com/",
    "https://example.com",
  ],
  [
    "trailing slash on deep path preserved",
    "https://example.com/articles/",
    "https://example.com/articles/",
  ],
  [
    "empty fragment removed",
    "https://example.com/page#",
    "https://example.com/page",
  ],
  [
    "non-tracking query params preserved & order kept",
    "https://example.com/?b=2&a=1&utm_source=x",
    "https://example.com/?b=2&a=1",
  ],
  [
    "non-http URL passed through",
    "note://internal/abc",
    "note://internal/abc",
  ],
  [
    "garbage input passes through",
    "not a url at all",
    "not a url at all",
  ],
  [
    "empty string passes through",
    "",
    "",
  ],
  [
    "clean URL untouched",
    "https://example.com/some/article",
    "https://example.com/some/article",
  ],
];

for (const [label, input, expected] of cases) {
  test(label, () => {
    assert.equal(canonicalizeUrl(input), expected);
  });
}
