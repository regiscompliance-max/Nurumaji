import assert from "node:assert/strict";
import test from "node:test";
import { deliverWhatsAppOtp, readWhatsAppDelivery, whatsAppOtpPayload } from "./whatsapp.mjs";

test("builds an authentication template with the code in the body and the copy button", () => {
  const payload = whatsAppOtpPayload("+254712000111", "123456", "nurumaji_login_code");
  assert.equal(payload.to, "254712000111");
  assert.equal(payload.template.name, "nurumaji_login_code");
  assert.equal(payload.template.language.code, "en");
  assert.equal(payload.template.components[0].parameters[0].text, "123456");
  assert.equal(payload.template.components[1].sub_type, "url");
  assert.equal(payload.template.components[1].parameters[0].text, "123456");
});

test("accepts a message id and rejects a successful HTTP response without one", () => {
  assert.equal(readWhatsAppDelivery(200, JSON.stringify({ messages: [{ id: "wamid.1" }] })).ok, true);
  assert.equal(readWhatsAppDelivery(200, JSON.stringify({ messages: [] })).ok, false);
  const failed = readWhatsAppDelivery(400, JSON.stringify({ error: { message: "bad token-value" } }));
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "bad token-value");
});

test("posts to Graph and does not keep the token in the parsed result", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return {
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: "wamid.1" }], note: "Bearer secret-token" }),
    };
  };
  const result = await deliverWhatsAppOtp({
    fetchImpl,
    token: "secret-token",
    phoneId: "123",
    to: "+254712000111",
    code: "123456",
    template: "nurumaji_login_code",
  });
  assert.equal(result.ok, true);
  assert.equal(seen.url, "https://graph.facebook.com/v21.0/123/messages");
  assert.equal(seen.init.headers.Authorization, "Bearer secret-token");
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});
