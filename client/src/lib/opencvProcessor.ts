import type { Point } from "./scanTypes";

let cvReady = false;
let cvLoading: Promise<boolean> | null = null;

/** Returns true if OpenCV.js WASM has been loaded and is ready to use. */
export function isOpenCVReady(): boolean {
  return cvReady;
}

/** Lazily loads OpenCV.js WASM from CDN. Resolves true when ready, false on failure. */
export function loadOpenCV(): Promise<boolean> {
  if (cvReady) return Promise.resolve(true);
  if (cvLoading) return cvLoading;

  cvLoading = new Promise<boolean>((resolve) => {
    try {
      // If cv is already on the window (e.g. loaded by another mechanism)
      const existing = (window as any).cv;
      if (existing && typeof existing.Mat === "function") {
        cvReady = true;
        resolve(true);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://docs.opencv.org/4.10.0/opencv.js";
      script.async = true;

      const timeout = setTimeout(() => {
        cvLoading = null;
        resolve(false);
      }, 30_000);

      script.onload = () => {
        // OpenCV.js sets cv on window; it may need a moment to initialize WASM
        const waitForCV = () => {
          const cv = (window as any).cv;
          if (cv && cv.Mat) {
            clearTimeout(timeout);
            cvReady = true;
            resolve(true);
            return;
          }
          // cv may expose an onRuntimeInitialized callback
          if (cv && typeof cv.then === "function") {
            cv.then(() => {
              clearTimeout(timeout);
              cvReady = true;
              resolve(true);
            }).catch(() => {
              clearTimeout(timeout);
              cvLoading = null;
              resolve(false);
            });
            return;
          }
          if (cv && typeof cv.onRuntimeInitialized === "undefined") {
            cv.onRuntimeInitialized = () => {
              clearTimeout(timeout);
              cvReady = true;
              resolve(true);
            };
            return;
          }
          // Poll briefly
          setTimeout(waitForCV, 100);
        };
        waitForCV();
      };

      script.onerror = () => {
        clearTimeout(timeout);
        cvLoading = null;
        resolve(false);
      };

      document.head.appendChild(script);
    } catch {
      cvLoading = null;
      resolve(false);
    }
  });

  return cvLoading;
}

/**
 * Orders 4 points as: top-left, top-right, bottom-right, bottom-left.
 * Points are in pixel coordinates.
 */
function orderCorners(pts: { x: number; y: number }[]): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  // Sum = x+y  → smallest = TL, largest = BR
  // Diff = x-y → smallest = BL, largest = TR
  const sorted = [...pts];
  let tl = sorted[0], tr = sorted[0], br = sorted[0], bl = sorted[0];
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (const p of sorted) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < minSum) { minSum = sum; tl = p; }
    if (sum > maxSum) { maxSum = sum; br = p; }
    if (diff > maxDiff) { maxDiff = diff; tr = p; }
    if (diff < minDiff) { minDiff = diff; bl = p; }
  }
  return [tl, tr, br, bl];
}

/**
 * Detect document edges using OpenCV.js: grayscale → GaussianBlur → Canny → findContours → approxPolyDP.
 * Returns normalized [0-1] corner coordinates, or null if detection fails.
 */
export function detectEdgesOpenCV(
  imageData: ImageData,
  width: number,
  height: number,
): [Point, Point, Point, Point] | null {
  if (!cvReady) return null;

  const cv = (window as any).cv;
  if (!cv) return null;

  let src: any = null;
  let gray: any = null;
  let blurred: any = null;
  let edges: any = null;
  let contours: any = null;
  let hierarchy: any = null;

  try {
    // Load image data into a cv.Mat
    src = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();

    // Convert to grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Apply Gaussian blur (5x5 kernel)
    const ksize = new cv.Size(5, 5);
    cv.GaussianBlur(gray, blurred, ksize, 0);

    // Canny edge detection (threshold 50-150)
    cv.Canny(blurred, edges, 50, 150);

    // Find contours
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    // Find the largest contour that can be approximated as a 4-point polygon
    let bestApprox: any = null;
    let bestArea = 0;
    const minArea = width * height * 0.06; // At least 6% of image area

    for (let i = 0; i < (contours.size() as number); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < minArea || area <= bestArea) {
        contour.delete();
        continue;
      }

      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);

      if ((approx.rows as number) === 4) {
        if (bestApprox) bestApprox.delete();
        bestApprox = approx;
        bestArea = area;
      } else {
        approx.delete();
      }
      contour.delete();
    }

    if (!bestApprox) return null;

    // Extract the 4 corner points
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 4; i++) {
      points.push({
        x: bestApprox.data32S[i * 2],
        y: bestApprox.data32S[i * 2 + 1],
      });
    }
    bestApprox.delete();

    // Order corners: TL, TR, BR, BL
    const ordered = orderCorners(points);

    // Normalize to [0-1]
    const result: [Point, Point, Point, Point] = [
      { x: ordered[0].x / width, y: ordered[0].y / height },
      { x: ordered[1].x / width, y: ordered[1].y / height },
      { x: ordered[2].x / width, y: ordered[2].y / height },
      { x: ordered[3].x / width, y: ordered[3].y / height },
    ];

    // Validate: the quad must have reasonable area (> 6% of frame)
    const area =
      Math.abs(
        result[0].x * result[1].y +
        result[1].x * result[2].y +
        result[2].x * result[3].y +
        result[3].x * result[0].y -
        result[0].y * result[1].x -
        result[1].y * result[2].x -
        result[2].y * result[3].x -
        result[3].y * result[0].x,
      ) / 2;

    return area > 0.06 ? result : null;
  } catch {
    return null;
  } finally {
    // Cleanup all OpenCV mats
    try { src?.delete(); } catch { /* noop */ }
    try { gray?.delete(); } catch { /* noop */ }
    try { blurred?.delete(); } catch { /* noop */ }
    try { edges?.delete(); } catch { /* noop */ }
    try { contours?.delete(); } catch { /* noop */ }
    try { hierarchy?.delete(); } catch { /* noop */ }
  }
}

/**
 * Apply perspective correction using OpenCV's warpPerspective.
 * Returns a new canvas with the corrected image, or null on failure.
 */
export function perspectiveCorrectionOpenCV(
  sourceCanvas: HTMLCanvasElement,
  corners: [Point, Point, Point, Point],
  outWidth: number,
  outHeight: number,
): HTMLCanvasElement | null {
  if (!cvReady) return null;

  const cv = (window as any).cv;
  if (!cv) return null;

  let src: any = null;
  let dst: any = null;
  let srcPoints: any = null;
  let dstPoints: any = null;
  let M: any = null;

  try {
    src = cv.imread(sourceCanvas);

    const sW = sourceCanvas.width;
    const sH = sourceCanvas.height;

    // Source corners in pixel coordinates (from normalized [0-1])
    srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x * sW, corners[0].y * sH, // TL
      corners[1].x * sW, corners[1].y * sH, // TR
      corners[2].x * sW, corners[2].y * sH, // BR
      corners[3].x * sW, corners[3].y * sH, // BL
    ]);

    // Destination corners (the output rectangle)
    dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      outWidth, 0,
      outWidth, outHeight,
      0, outHeight,
    ]);

    // Compute perspective transform matrix
    M = cv.getPerspectiveTransform(srcPoints, dstPoints);

    // Apply warp
    dst = new cv.Mat();
    const dsize = new cv.Size(outWidth, outHeight);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // Write result to a new canvas
    const outCanvas = document.createElement("canvas");
    outCanvas.width = outWidth;
    outCanvas.height = outHeight;
    cv.imshow(outCanvas, dst);

    return outCanvas;
  } catch {
    return null;
  } finally {
    try { src?.delete(); } catch { /* noop */ }
    try { dst?.delete(); } catch { /* noop */ }
    try { srcPoints?.delete(); } catch { /* noop */ }
    try { dstPoints?.delete(); } catch { /* noop */ }
    try { M?.delete(); } catch { /* noop */ }
  }
}
