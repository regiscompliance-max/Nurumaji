type QueueItem = {
  id: string;
  status: string;
  name: string;
  area: string;
  trades: string;
  invited: boolean;
  idMasked: string;
  kraMasked: string;
};

type DetailDoc = { id: string; doc_type: string; number: string | null; expiry_date: string | null; verified: number; r2_key?: string | null };

const CHECKS: [string, string][] = [
  ["id_verified", "ID verified"],
  ["licence_verified", "Licence verified"],
  ["good_conduct_verified", "Good conduct verified"],
  ["references_called", "References called"],
  ["interview_passed", "Interview or trade test passed"],
];

export function queuePage(items: QueueItem[], filters: { status: string; trade: string; area: string }, probation: string): string {
  const rows = items.map((item) => `<article class="portal-empty">
      <p class="eyebrow">${escapeHtml(item.status)}${item.invited ? " · Invited" : ""}</p>
      <h2><a href="/portal/applications/${item.id}">${escapeHtml(item.name)}</a></h2>
      <p>${escapeHtml(item.area || "Area not given")} · ${escapeHtml(item.trades || "No trade yet")}</p>
      <p class="muted">ID ${escapeHtml(item.idMasked)} · KRA ${escapeHtml(item.kraMasked)}</p>
    </article>`).join("") || `<p>No applications match.</p>`;
  return `<p class="eyebrow">Review</p><h1>Applications</h1>
    <form method="get" action="/portal/applications" class="form">
      <div class="field"><label for="status">Status</label><select id="status" name="status">
        <option value="">Any</option>${["submitted", "needs_info", "approved", "rejected", "probation"].map((status) => `<option value="${status}"${filters.status === status ? " selected" : ""}>${status}</option>`).join("")}
      </select></div>
      <div class="field"><label for="trade">Trade</label><select id="trade" name="trade">
        <option value="">Any</option>
        <option value="electrical"${filters.trade === "electrical" ? " selected" : ""}>Electrical</option>
        <option value="plumbing"${filters.trade === "plumbing" ? " selected" : ""}>Plumbing</option>
      </select></div>
      <div class="field"><label for="area">Area</label><input id="area" name="area" value="${escapeHtml(filters.area)}"></div>
      <button class="btn btn-line-ink" type="submit">Filter</button>
    </form>
    <form method="post" action="/api/settings/probation" class="form">
      <div class="field"><label for="count">Completed standard jobs that end probation</label><input id="count" name="count" inputmode="numeric" value="${escapeHtml(probation)}" placeholder="Deng to set this number"></div>
      <button class="btn btn-line-ink" type="submit">Save setting</button>
    </form>
    <p><a href="/portal/applications/invites">Create an invite link</a></p>
    <div class="job-stack">${rows}</div>`;
}

export function detailPage(input: {
  id: string;
  status: string;
  phone: string;
  role: string;
  approved: number;
  personal: Record<string, unknown>;
  trades: string;
  experience: number | null;
  specialisms: string;
  tools: number | null;
  transport: string;
  baseLat: number | null;
  baseLng: number | null;
  radius: number | null;
  availability: string | null;
  mpesa: string;
  references: string | null;
  reason: string | null;
  documents: DetailDoc[];
}): string {
  const checklist = input.personal._checklist && typeof input.personal._checklist === "object"
    ? input.personal._checklist as Record<string, boolean> : {};
  const checks = CHECKS.map(([key, label]) => `<form method="post" action="/api/applications/${input.id}/checklist">
      <input type="hidden" name="key" value="${key}">
      <input type="hidden" name="checked" value="${checklist[key] ? "0" : "1"}">
      <button class="btn btn-line-ink" type="submit">${checklist[key] ? "Clear" : "Tick"}: ${label}</button>
    </form>`).join("");
  const docs = input.documents.map((doc) => `<li>${escapeHtml(docLabel(doc.doc_type))}${doc.expiry_date ? ` · expires ${escapeHtml(doc.expiry_date)}` : ""}${doc.number ? ` · ${escapeHtml(doc.number)}` : ""} ${doc.r2_key ? `<a href="/api/join/documents/${doc.id}">Open file</a>` : "(details only)"}</li>`).join("");
  const personal = Object.entries(input.personal)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => `<li>${escapeHtml(fieldLabel(key))}: ${escapeHtml(String(value ?? ""))}</li>`).join("");
  return `<p><a href="/portal/applications">Applications</a></p>
    <p class="eyebrow">${escapeHtml(input.status)}</p>
    <h1>Application</h1>
    <p class="muted">Phone is shown here for the reviewer only. It is not shown to clients.</p>
    <ul class="timeline">${personal}<li>Phone: ${escapeHtml(input.phone)}</li><li>Role now: ${escapeHtml(input.role)}</li>
      <li>Trades: ${escapeHtml(input.trades || "none")}</li>
      <li>Experience: ${input.experience ?? "not given"} years</li>
      <li>Specialisms: ${escapeHtml(input.specialisms || "none")}</li>
      <li>Tools: ${input.tools === 1 ? "yes" : "no"} · Transport: ${escapeHtml(input.transport || "not given")}</li>
      <li>Base: ${input.baseLat ?? "—"}, ${input.baseLng ?? "—"} · Radius ${input.radius ?? "—"} km</li>
      <li>Hours: ${escapeHtml(readableHours(input.availability))}</li>
      <li>M-Pesa: ${escapeHtml(input.mpesa || "not given")}</li>
      <li>References: ${escapeHtml(readableReferences(input.references))}</li>
    </ul>
    <h2>Files</h2><ul>${docs || "<li>No files yet.</li>"}</ul>
    <h2>Checklist</h2><div class="job-stack">${checks}</div>
    ${input.reason ? `<p>Last message: ${escapeHtml(input.reason)}</p>` : ""}
    <h2>Actions</h2>
    <form method="post" action="/api/applications/${input.id}/request-info" class="form">
      <div class="field"><label for="message">What needs fixing</label><textarea id="message" name="message" required></textarea></div>
      ${["personal", "trade", "licences", "uploads", "coverage", "payout", "references"].map((field) => `<label class="trade-choice"><input type="checkbox" name="fields" value="${field}"> ${field}</label>`).join("")}
      <button class="btn btn-line-ink" type="submit">Request information</button>
    </form>
    <form method="post" action="/api/applications/${input.id}/reject" class="form">
      <div class="field"><label for="reason">Reason for rejection</label><textarea id="reason" name="reason" required></textarea></div>
      <button class="btn btn-line-ink" type="submit">Reject</button>
    </form>
    <form method="post" action="/api/applications/${input.id}/approve"><button class="btn btn-amber" type="submit">Approve</button></form>
    <form method="post" action="/api/applications/${input.id}/approve"><input type="hidden" name="probation" value="1"><button class="btn btn-line-ink" type="submit">Approve on probation</button></form>
    ${input.role === "technician" && input.approved === 0 ? `<form method="post" action="/api/applications/${input.id}/reapprove"><button class="btn btn-amber" type="submit">Re-approve after renewal</button></form>` : ""}`;
}

export function invitePage(): string {
  return `<p class="eyebrow">Admin</p><h1>Invite a technician</h1>
    <p>The link works once, expires after 7 days, and skips the introduction page.</p>
    <form method="post" action="/api/invites"><button class="btn btn-amber" type="submit">Create invite link</button></form>
    <p><a href="/portal/applications">Back to applications</a></p>`;
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    full_name: "Full name", email: "Email", date_of_birth: "Date of birth", id_number: "National ID",
    kra_pin: "KRA PIN", area: "Area", epra_class: "EPRA class", good_conduct_issued: "Good conduct issued",
  };
  return labels[key] || key;
}

function docLabel(type: string): string {
  const labels: Record<string, string> = {
    id_front: "ID front", id_back: "ID back", selfie: "Selfie", epra_licence: "EPRA licence",
    nca_accreditation: "NCA accreditation", trade_test: "Trade test", good_conduct: "Certificate of Good Conduct", past_work: "Past work",
  };
  return labels[type] || type;
}

function readableHours(value: string | null): string {
  if (!value) return "not given";
  try {
    const parsed = JSON.parse(value) as { days?: string[]; start?: string; end?: string };
    if (!parsed.days) return value;
    return `${parsed.days.join(", ")} ${parsed.start || ""}–${parsed.end || ""}`;
  } catch {
    return value;
  }
}

function readableReferences(value: string | null): string {
  if (!value) return "not given";
  try {
    const parsed = JSON.parse(value) as { name?: string; phone?: string }[];
    if (!Array.isArray(parsed)) return value;
    return parsed.map((item) => `${item.name || ""} ${item.phone || ""}`.trim()).join("; ");
  } catch {
    return value;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}
