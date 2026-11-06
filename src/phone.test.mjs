import assert from "node:assert/strict";
import test from "node:test";
import { normalizeKenyanMobile } from "./phone.mjs";

test("accepts local 07 and 01 numbers", () => {
  assert.equal(normalizeKenyanMobile("0712345678"), "+254712345678");
  assert.equal(normalizeKenyanMobile("0112345678"), "+254112345678");
});

test("accepts spaced, international, and missing-zero forms", () => {
  assert.equal(normalizeKenyanMobile("0712 345 678"), "+254712345678");
  assert.equal(normalizeKenyanMobile("+254712345678"), "+254712345678");
  assert.equal(normalizeKenyanMobile("254712345678"), "+254712345678");
  assert.equal(normalizeKenyanMobile("712345678"), "+254712345678");
  assert.equal(normalizeKenyanMobile("112345678"), "+254112345678");
});

test("rejects landlines and other prefixes", () => {
  assert.equal(normalizeKenyanMobile("0612345678"), null);
  assert.equal(normalizeKenyanMobile("+254812345678"), null);
  assert.equal(normalizeKenyanMobile("071234567"), null);
  assert.equal(normalizeKenyanMobile(""), null);
  assert.equal(normalizeKenyanMobile("hello"), null);
});
