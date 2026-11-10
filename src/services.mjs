// Shared labels for website links and the booking form.
// Keys are the ?service= values used on the public site.

export const SERVICES = {
  tripping: { trade: "electrical", label: "Power outages and tripping" },
  sockets: { trade: "electrical", label: "Faulty sockets and switches" },
  lighting: { trade: "electrical", label: "Lighting" },
  solar: { trade: "electrical", label: "Solar backup" },
  heater: { trade: "plumbing", label: "Water heaters and showers" },
  leak: { trade: "plumbing", label: "Leaks and burst pipes" },
  drain: { trade: "plumbing", label: "Blocked drains and toilets" },
  tanks: { trade: "plumbing", label: "Tanks and booster pumps" },
  safety: { trade: "electrical", label: "Building safety check" },
  electrical: { trade: "electrical", label: "Electrical work" },
  plumbing: { trade: "plumbing", label: "Plumbing work" },
};

export function lookupService(key) {
  if (typeof key !== "string") return null;
  const found = SERVICES[key];
  if (!found) return null;
  return { key, trade: found.trade, label: found.label };
}
