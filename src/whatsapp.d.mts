export function whatsAppTemplateName(value: string | undefined): string;
export function whatsAppOtpPayload(to: string, code: string, templateName: string): {
  messaging_product: string;
  to: string;
  type: string;
  template: {
    name: string;
    language: { code: string };
    components: Array<Record<string, unknown>>;
  };
};
export function readWhatsAppDelivery(httpStatus: number, bodyText: string): { ok: boolean; status: string; httpStatus: number };
export function deliverWhatsAppOtp(input: {
  fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: () => Promise<string> }>;
  token: string;
  phoneId: string;
  to: string;
  code: string;
  template: string;
}): Promise<{ ok: boolean; status: string; httpStatus: number }>;
