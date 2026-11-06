import type { Bindings } from "./types";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const MAX_STORED_BYTES = 1500 * 1024;
const MAX_EDGE = 512;

export function technicianPhotoKey(userId: string): string {
  return `technician-photos/${userId}.jpg`;
}

export async function preparePortrait(file: File): Promise<{ bytes: ArrayBuffer; contentType: string } | { error: string }> {
  if (!TYPES.has(file.type)) return { error: "Use a JPG, PNG, or WebP photo." };
  if (file.size <= 0 || file.size > MAX_RAW_BYTES) return { error: "Use a photo under 8 MB." };
  try {
    const scope = globalThis as unknown as {
      createImageBitmap?: (blob: Blob) => Promise<{ width: number; height: number; close: () => void }>;
      OffscreenCanvas?: new (width: number, height: number) => {
        getContext: (kind: "2d") => { drawImage: (image: unknown, x: number, y: number, w: number, h: number) => void } | null;
        convertToBlob: (options: { type: string; quality: number }) => Promise<Blob>;
      };
    };
    if (!scope.createImageBitmap || !scope.OffscreenCanvas) throw new Error("resize unavailable");
    const bitmap = await scope.createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new scope.OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength > MAX_STORED_BYTES) return { error: "That photo is still too large after resizing." };
    return { bytes, contentType: "image/jpeg" };
  } catch (error) {
    console.error("Portrait resize was skipped.", error);
    if (file.size > MAX_STORED_BYTES) return { error: "Use a smaller photo, under 1.5 MB." };
    return { bytes: await file.arrayBuffer(), contentType: file.type };
  }
}

export async function storeTechnicianPhoto(env: Bindings, userId: string, file: File): Promise<string | { error: string }> {
  if (!env.UPLOADS) return { error: "Photo storage is not connected yet." };
  const prepared = await preparePortrait(file);
  if ("error" in prepared) return prepared;
  const key = technicianPhotoKey(userId);
  await env.UPLOADS.put(key, prepared.bytes, { httpMetadata: { contentType: prepared.contentType } });
  await env.DB.prepare(
    `INSERT INTO technician_profiles (user_id, trades, on_duty, approved, rating_avg, rating_count, photo_key)
     VALUES (?, '', 0, 0, 0, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET photo_key = excluded.photo_key`
  ).bind(userId, key).run();
  return key;
}
