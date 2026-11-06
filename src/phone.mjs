// Kenyan mobile numbers only: +2547XXXXXXXX or +2541XXXXXXXX.

export function normalizeKenyanMobile(input) {
  if (typeof input !== "string") return null;
  let digits = input.trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("254")) {
    // already includes the country code
  } else if (digits.startsWith("0") && digits.length === 10) {
    digits = "254" + digits.slice(1);
  } else if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1"))) {
    digits = "254" + digits;
  } else {
    return null;
  }
  if (!/^254[17]\d{8}$/.test(digits)) return null;
  return "+" + digits;
}
