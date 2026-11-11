import assert from "node:assert/strict";
import test from "node:test";
import { failureLogLine, loginSmsError, maskPhone, readSmsDelivery } from "./sms-delivery.mjs";

const rejected = JSON.stringify({
  SMSMessageData: {
    Message: "Sent to 0/1 Total Cost: 0",
    Recipients: [{ status: "InvalidPhoneNumber", statusCode: 403, number: "+254798000000" }],
  },
});

test("treats HTTP 201 as a failure when the recipient was not accepted", () => {
  const result = readSmsDelivery(201, rejected);
  assert.equal(result.ok, false);
  assert.equal(result.status, "InvalidPhoneNumber");
  assert.equal(result.statusCode, 403);
});

test("accepts processed, sent, and queued recipient codes", () => {
  for (const statusCode of [100, 101, 102]) {
    const body = JSON.stringify({ SMSMessageData: { Recipients: [{ status: "Sent", statusCode }] } });
    assert.equal(readSmsDelivery(201, body).ok, true);
  }
  assert.equal(readSmsDelivery(500, rejected).ok, false);
});

test("logs the status and only the last three digits", async () => {
  const line = failureLogLine({ status: "InvalidPhoneNumber", statusCode: 403, phone: "+254798000111" });
  assert.equal(line.includes("InvalidPhoneNumber"), true);
  assert.equal(line.includes("403"), true);
  assert.equal(line.includes("***111"), true);
  assert.equal(line.includes("254798000111"), false);
  assert.equal(line.includes("secret-key"), false);
  assert.equal(maskPhone("+254798000111"), "***111");

  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(rejected, { status: 201, headers: { "content-type": "application/json" } });
  try {
    const response = await fetch("https://sms.example/test");
    const parsed = readSmsDelivery(response.status, await response.text());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, "InvalidPhoneNumber");
  } finally {
    globalThis.fetch = original;
  }
});

test("gives the client a plain message without the Africa's Talking status", () => {
  const message = loginSmsError("sms_rejected");
  assert.equal(message, "We couldn't send a code to that number. Check it and try again, or WhatsApp us on 0181 969 005.");
  assert.equal(message.includes("InvalidPhoneNumber"), false);
  assert.equal(loginSmsError("sms_failed"), "The code could not be sent. Try again shortly.");
});
