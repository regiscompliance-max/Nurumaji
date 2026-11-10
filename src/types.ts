export type Role = "client" | "technician" | "operator" | "admin";

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  AT_API_KEY?: string;
  AT_USERNAME?: string;
  // Optional. Sent as `from` on the live API only. Ignored when AT_USERNAME is "sandbox".
  AT_SENDER_ID?: string;
  OTP_DEV_MODE?: string;
  APP_URL?: string;
  UPLOADS?: R2Bucket;
};

export type UserRow = {
  id: string;
  phone: string;
  name: string | null;
  role: Role;
  status: "active" | "disabled";
  created_at: number;
};

export type AppContext = { Bindings: Bindings; Variables: { user: UserRow } };
