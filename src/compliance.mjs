const LABELS = { id: "ID", insurance: "Insurance", licence: "Licence", certificate: "Certificate" };

export function daysUntilExpiry(expiry, today) {
  const end = Date.parse(`${expiry}T00:00:00+03:00`);
  const start = Date.parse(`${today}T00:00:00+03:00`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.round((end - start) / 86_400_000);
}

export function reminderOffset(days) {
  if (days === 30 || days === 14 || days === 7) return days;
  return null;
}

function valid(expiry, today) {
  const days = daysUntilExpiry(expiry, today);
  return days != null && days >= 0;
}

// ID, insurance, and a licence or certificate must all be in date.
export function dispatchHold(docs, today) {
  const latest = new Map();
  for (const doc of docs) latest.set(doc.docType, doc.expiryDate);
  for (const type of ["id", "insurance"]) {
    const expiry = latest.get(type);
    if (!expiry) return `${LABELS[type]} is missing`;
    if (!valid(expiry, today)) return `${LABELS[type]} has expired`;
  }
  const licence = latest.get("licence");
  const certificate = latest.get("certificate");
  if (valid(licence, today) || valid(certificate, today)) return null;
  if (!licence && !certificate) return "Licence is missing";
  return "Licence has expired";
}

export function documentLabel(type) {
  return LABELS[type] || "Document";
}
