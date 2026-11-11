export function maskPhone(phone: string): string;
export function readSmsDelivery(httpStatus: number, bodyText: string): {
  ok: boolean;
  status: string;
  statusCode: number | null;
  httpStatus: number;
};
export function failureLogLine(input: { status: string; statusCode: number | null; phone: string }): string;
export function loginSmsError(reason: string): string;
