import assert from "node:assert/strict";
import test from "node:test";
import { isCrossSite, needsOriginCheck, withoutTrailingSlash } from "./http-guards.mjs";

test("trailing slash redirects keep the query string", () => {
  const portal = withoutTrailingSlash("https://nurumaji.regiscompliance.workers.dev/portal/?next=1");
  assert.equal(portal?.pathname, "/portal");
  assert.equal(portal?.search, "?next=1");

  const login = withoutTrailingSlash("http://127.0.0.1:8787/portal/login/");
  assert.equal(login?.pathname, "/portal/login");
  assert.equal(login?.search, "");

  const book = withoutTrailingSlash("https://nurumaji.co.ke/book/");
  assert.equal(book?.pathname, "/book");

  const join = withoutTrailingSlash("https://nurumaji.co.ke/join/?invite=abc");
  assert.equal(join?.pathname, "/join");
  assert.equal(join?.search, "?invite=abc");

  assert.equal(withoutTrailingSlash("https://nurumaji.co.ke/portal/jobs/abc//")?.pathname, "/portal/jobs/abc");
  assert.equal(withoutTrailingSlash("https://nurumaji.co.ke/"), null);
  assert.equal(withoutTrailingSlash("https://nurumaji.co.ke/book"), null);
});

test("state-changing methods are checked and same-origin posts are allowed", () => {
  assert.equal(needsOriginCheck("POST"), true);
  assert.equal(needsOriginCheck("GET"), false);
  const url = "https://nurumaji.regiscompliance.workers.dev/api/jobs";
  assert.equal(isCrossSite(url, "https://nurumaji.regiscompliance.workers.dev", "same-origin"), false);
  assert.equal(isCrossSite(url, "https://evil.example", "cross-site"), true);
  assert.equal(isCrossSite(url, "not a url", null), true);
  assert.equal(isCrossSite(url, null, "cross-site"), true);
  assert.equal(isCrossSite(url, null, "same-origin"), false);
  assert.equal(isCrossSite(url, null, null), false);
});
