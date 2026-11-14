import assert from "node:assert/strict";
import test from "node:test";
import { lookupService } from "./services.mjs";

test("maps household jobs to a trade", () => {
  assert.equal(lookupService("tripping")?.trade, "electrical");
  assert.equal(lookupService("leak")?.trade, "plumbing");
  assert.equal(lookupService("safety")?.label, "Building safety check");
  assert.equal(lookupService("inspection")?.label, "Electrical safety inspection");
  assert.equal(lookupService("inspection")?.trade, "electrical");
  assert.equal(lookupService("nope"), null);
});
