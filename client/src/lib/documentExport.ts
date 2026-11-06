import { renderPage } from "./scanProcessing";
import type { ScanDocument } from "./scanTypes";

export async function createPdf(document: ScanDocument, quality: number): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(document.title || "Paperless scan");
  pdf.setCreator("Paperless — local document scanner");
  for (const page of document.pages) {
    const image = await renderPage(page, quality, true);
    const bytes = new Uint8Array(await image.arrayBuffer());
    const jpg = await pdf.embedJpg(bytes);
    const outputPage = pdf.addPage([jpg.width, jpg.height]);
    outputPage.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
  }
  const saved = await pdf.save();
  const buffer = new ArrayBuffer(saved.byteLength);
  new Uint8Array(buffer).set(saved);
  return new Blob([buffer], { type: "application/pdf" });
}

export async function createImageCopies(document: ScanDocument, quality: number): Promise<Blob[]> {
  const copies: Blob[] = [];
  for (const page of document.pages) copies.push(await renderPage(page, quality, true));
  return copies;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title, files: [file] });
    return "shared";
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

export async function lockPdf(blob: Blob, password: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await blob.arrayBuffer());
  const payload = new Uint8Array(5 + salt.length + iv.length + encrypted.byteLength);
  payload.set(new TextEncoder().encode("PLSS1"), 0);
  payload.set(salt, 5);
  payload.set(iv, 21);
  payload.set(new Uint8Array(encrypted), 33);
  return new Blob([payload], { type: "application/vnd.paperless.encrypted" });
}

export async function unlockPdf(file: File, password: string): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "PLSS1") throw new Error("This is not a Paperless encrypted PDF.");
  const salt = bytes.slice(5, 21);
  const iv = bytes.slice(21, 33);
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(33));
  return new Blob([decrypted], { type: "application/pdf" });
}
