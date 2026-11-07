/**
 * Hybrid OCR Engine
 * - Android native: Google ML Kit Text Recognition (fast, on-device)
 * - Web/PWA fallback: Tesseract.js (client-side WASM)
 *
 * All processing stays 100% on-device. No data ever leaves the phone.
 */

import { Capacitor } from "@capacitor/core";

export interface OcrResult {
  text: string;
  /** How many pages were processed */
  pagesProcessed: number;
  /** Which engine was used */
  engine: "mlkit" | "tesseract";
}

export interface OcrProgress {
  page: number;
  totalPages: number;
  percent: number;
  message: string;
}

/**
 * Convert a Blob to a base64 data-URI string.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Run OCR on a single image blob using ML Kit Text Recognition (Android only).
 */
async function recognizeWithMLKit(imageBlob: Blob): Promise<string> {
  const { TextRecognition } = await import("@capacitor-mlkit/text-recognition");
  const { Filesystem, Directory } = await import("@capacitor/filesystem");

  const base64Uri = await blobToBase64(imageBlob);
  const base64Data = base64Uri.includes(",") ? base64Uri.split(",")[1] : base64Uri;
  const tempFileName = `ocr_temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;

  const saved = await Filesystem.writeFile({
    path: tempFileName,
    data: base64Data,
    directory: Directory.Cache,
  });

  try {
    const result = await TextRecognition.processImage({
      path: saved.uri,
    });
    return result.text || "";
  } finally {
    await Filesystem.deleteFile({
      path: tempFileName,
      directory: Directory.Cache,
    }).catch(() => undefined);
  }
}

/**
 * Run OCR on a single image blob using Tesseract.js (web fallback).
 */
async function recognizeWithTesseract(
  imageBlob: Blob,
  onProgress?: (percent: number) => void
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: `${import.meta.env.BASE_URL}vendor/tesseract/worker.min.js`,
    corePath: `${import.meta.env.BASE_URL}vendor/tesseract/`,
    langPath: `${import.meta.env.BASE_URL}tessdata/`,
    gzip: true,
    logger: (m: any) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const result = await worker.recognize(imageBlob);
    return result.data.text || "";
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

/**
 * Run OCR across multiple page blobs, automatically choosing the best engine.
 *
 * - On Android native app -> uses ML Kit (fast, on-device)
 * - On web/PWA -> uses Tesseract.js
 */
export async function recognizePages(
  pages: Blob[],
  onProgress?: (progress: OcrProgress) => void
): Promise<OcrResult> {
  if (pages.length === 0) {
    return { text: "", pagesProcessed: 0, engine: "tesseract" };
  }

  const isNative = Capacitor.isNativePlatform();
  let engine: OcrResult["engine"] = isNative ? "mlkit" : "tesseract";
  const parts: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    onProgress?.({
      page: i + 1,
      totalPages: pages.length,
      percent: Math.round((i / pages.length) * 100),
      message: `Reading page ${i + 1} of ${pages.length}…`,
    });

    let pageText = "";
    if (isNative) {
      try {
        pageText = await recognizeWithMLKit(pages[i]);
      } catch (nativeErr) {
        console.warn(`ML Kit OCR error on page ${i + 1}, falling back to Tesseract:`, nativeErr);
        engine = "tesseract";
        pageText = await recognizeWithTesseract(pages[i], (pct) => {
          onProgress?.({
            page: i + 1,
            totalPages: pages.length,
            percent: Math.round(((i + pct / 100) / pages.length) * 100),
            message: `Reading page ${i + 1} of ${pages.length}… (${pct}%)`,
          });
        });
      }
    } else {
      pageText = await recognizeWithTesseract(pages[i], (pct) => {
        onProgress?.({
          page: i + 1,
          totalPages: pages.length,
          percent: Math.round(((i + pct / 100) / pages.length) * 100),
          message: `Reading page ${i + 1} of ${pages.length}… (${pct}%)`,
        });
      });
    }

    parts.push(pageText.trim());
  }

  onProgress?.({
    page: pages.length,
    totalPages: pages.length,
    percent: 100,
    message: "Text extraction complete.",
  });

  return {
    text: parts.join("\n\n"),
    pagesProcessed: pages.length,
    engine,
  };
}
