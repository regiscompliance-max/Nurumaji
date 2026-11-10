const RESULTS = new Set(["pass", "fail"]);

function numberInRange(value, min, max) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

// Ranges are only to reject typing mistakes. They are not a pass mark.
export function validateTestSheet(trade, raw) {
  const result = String(raw.result || "");
  const notes = String(raw.notes || "").trim().slice(0, 1000);
  if (!RESULTS.has(result)) return { error: "Choose an overall result." };
  if (trade === "electrical") {
    const insulationMohm = numberInRange(raw.insulationMohm, 0, 2000);
    const zsOhm = numberInRange(raw.zsOhm, 0, 200);
    const rcdMs = numberInRange(raw.rcdMs, 0, 2000);
    const polarity = String(raw.polarity || "");
    if (insulationMohm == null || zsOhm == null || rcdMs == null) {
      return { error: "Enter the electrical readings as numbers in range." };
    }
    if (!RESULTS.has(polarity)) return { error: "Choose a polarity result." };
    return { readings: { insulationMohm, zsOhm, rcdMs, polarity }, result, notes };
  }
  if (trade === "plumbing") {
    const pressureBar = numberInRange(raw.pressureBar, 0, 25);
    const durationMin = numberInRange(raw.durationMin, 0, 240);
    const leakCheck = String(raw.leakCheck || "");
    if (pressureBar == null || durationMin == null) {
      return { error: "Enter the plumbing readings as numbers in range." };
    }
    if (!RESULTS.has(leakCheck)) return { error: "Choose a leak check result." };
    return { readings: { pressureBar, durationMin, leakCheck }, result, notes };
  }
  return { error: "This trade does not have a test sheet." };
}
