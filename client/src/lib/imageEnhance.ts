/**
 * Pure CPU image enhancement algorithms for document scanning.
 * No external dependencies — fully self-contained math functions.
 */

/**
 * Otsu's method: finds the optimal global threshold that maximizes
 * inter-class variance between foreground and background pixels.
 *
 * Builds a 256-bin histogram, then sweeps all possible thresholds
 * to find the one that best separates the two pixel classes.
 *
 * @returns optimal threshold value (0–255)
 */
export function otsuThreshold(grayscale: Uint8Array, length: number): number {
  // Build histogram
  const histogram = new Float64Array(256);
  for (let i = 0; i < length; i++) {
    histogram[grayscale[i]]++;
  }

  // Total number of pixels and weighted sum
  let totalSum = 0;
  for (let t = 0; t < 256; t++) {
    totalSum += t * histogram[t];
  }

  let bestThreshold = 0;
  let bestVariance = 0;
  let weightBackground = 0;
  let sumBackground = 0;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;

    const weightForeground = length - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (totalSum - sumBackground) / weightForeground;

    // Inter-class variance: ωB * ωF * (μB - μF)²
    const diff = meanBackground - meanForeground;
    const variance = weightBackground * weightForeground * diff * diff;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = t;
    }
  }

  return bestThreshold;
}

/**
 * Sauvola's local adaptive thresholding.
 *
 * For each pixel, computes a local threshold based on the mean and
 * standard deviation within a surrounding window:
 *   T(x,y) = mean * (1 + k * (stddev / R - 1))
 * where R = 128 (half the dynamic range of grayscale).
 *
 * Uses integral images (summed area tables) for O(1) per-pixel
 * mean and variance computation regardless of window size.
 *
 * @param windowSize - side length of the local window (must be odd; default 15)
 * @param k - sensitivity parameter (default 0.2; higher → more aggressive background removal)
 * @returns binary Uint8Array (0 or 255 per pixel)
 */
export function sauvolaThreshold(
  grayscale: Uint8Array,
  width: number,
  height: number,
  windowSize: number = 15,
  k: number = 0.2,
): Uint8Array {
  const halfWin = (windowSize >> 1) | 0;
  const total = width * height;
  const output = new Uint8Array(total);

  // Build integral image and integral squared image
  // Using Float64Array to avoid overflow on large images
  const integralLen = (width + 1) * (height + 1);
  const integral = new Float64Array(integralLen);
  const integralSq = new Float64Array(integralLen);
  const w1 = width + 1;

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < width; x++) {
      const val = grayscale[y * width + x];
      rowSum += val;
      rowSumSq += val * val;
      const idx = (y + 1) * w1 + (x + 1);
      integral[idx] = rowSum + integral[idx - w1];
      integralSq[idx] = rowSumSq + integralSq[idx - w1];
    }
  }

  const R = 128; // half of dynamic range

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Window bounds (clamped to image)
      const x1 = Math.max(0, x - halfWin);
      const y1 = Math.max(0, y - halfWin);
      const x2 = Math.min(width - 1, x + halfWin);
      const y2 = Math.min(height - 1, y + halfWin);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      // Sum and sumSq from integral images (inclusive corners)
      const a1 = y1 * w1 + x1;           // top-left  (shifted)
      const a2 = y1 * w1 + (x2 + 1);     // top-right
      const a3 = (y2 + 1) * w1 + x1;     // bottom-left
      const a4 = (y2 + 1) * w1 + (x2 + 1); // bottom-right

      const sum = integral[a4] - integral[a2] - integral[a3] + integral[a1];
      const sumSq = integralSq[a4] - integralSq[a2] - integralSq[a3] + integralSq[a1];

      const mean = sum / count;
      const variance = sumSq / count - mean * mean;
      const stddev = Math.sqrt(Math.max(0, variance));

      // Sauvola threshold: T = mean * (1 + k * (stddev / R - 1))
      const threshold = mean * (1 + k * (stddev / R - 1));

      output[y * width + x] = grayscale[y * width + x] > threshold ? 255 : 0;
    }
  }

  return output;
}

/**
 * In-place unsharp mask sharpening.
 *
 * Computes a 3×3 Gaussian blur, then enhances edges:
 *   sharpened = original + amount × (original − blurred)
 *
 * @param amount - sharpening strength (default 1.5)
 * @param radius - unused (reserved); always uses 3×3 kernel
 */
export function unsharpMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number = 1.5,
  _radius: number = 1,
): void {
  // 3×3 Gaussian kernel (σ ≈ 0.85): [1 2 1; 2 4 2; 1 2 1] / 16
  const length = width * height * 4;
  const blurred = new Uint8ClampedArray(length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let rSum = 0, gSum = 0, bSum = 0, wSum = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          // Gaussian weight: center=4, edge=2, corner=1
          const w = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0) ? 2 : 1;
          const nIdx = (ny * width + nx) * 4;
          rSum += pixels[nIdx] * w;
          gSum += pixels[nIdx + 1] * w;
          bSum += pixels[nIdx + 2] * w;
          wSum += w;
        }
      }

      blurred[idx] = (rSum / wSum) | 0;
      blurred[idx + 1] = (gSum / wSum) | 0;
      blurred[idx + 2] = (bSum / wSum) | 0;
      blurred[idx + 3] = pixels[idx + 3];
    }
  }

  // Apply: sharpened = original + amount * (original - blurred)
  for (let i = 0; i < length; i += 4) {
    pixels[i] = Math.min(255, Math.max(0, pixels[i] + amount * (pixels[i] - blurred[i])));
    pixels[i + 1] = Math.min(255, Math.max(0, pixels[i + 1] + amount * (pixels[i + 1] - blurred[i + 1])));
    pixels[i + 2] = Math.min(255, Math.max(0, pixels[i + 2] + amount * (pixels[i + 2] - blurred[i + 2])));
  }
}

/**
 * In-place auto-levels adjustment.
 *
 * Finds the 1st and 99th percentile of the luminance histogram,
 * then stretches all RGB channels proportionally so the full
 * 0–255 range is utilized.
 */
export function autoLevels(pixels: Uint8ClampedArray, length: number): void {
  // Build luminance histogram
  const histogram = new Uint32Array(256);
  const pixelCount = length / 4;

  for (let i = 0; i < length; i += 4) {
    const lum = ((pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000) | 0;
    histogram[Math.min(255, lum)]++;
  }

  // Find 1st and 99th percentile
  const p1Target = pixelCount * 0.01;
  const p99Target = pixelCount * 0.99;
  let cumulative = 0;
  let low = 0;
  let high = 255;

  for (let i = 0; i < 256; i++) {
    cumulative += histogram[i];
    if (cumulative < p1Target) {
      low = i;
    }
    if (cumulative < p99Target) {
      high = i;
    }
  }

  // Ensure we don't divide by zero
  if (high <= low) {
    high = low + 1;
  }

  const range = high - low;
  const scale = 255 / range;

  for (let i = 0; i < length; i += 4) {
    pixels[i] = Math.min(255, Math.max(0, ((pixels[i] - low) * scale) | 0));
    pixels[i + 1] = Math.min(255, Math.max(0, ((pixels[i + 1] - low) * scale) | 0));
    pixels[i + 2] = Math.min(255, Math.max(0, ((pixels[i + 2] - low) * scale) | 0));
  }
}

/**
 * In-place whiteboard / projector photo enhancement.
 *
 * 1. Downscales the image to 1/8 resolution
 * 2. Computes a local max-filter (background estimate) on the downscaled image
 * 3. Upscales the background estimate back to full resolution
 * 4. Normalizes each pixel: output = (pixel / background) × 255
 * 5. Applies a mild contrast boost
 *
 * This removes uneven lighting and whiteboard glare, producing
 * clean, readable text on a uniform white background.
 */
export function whiteboardEnhance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const scale = 8;
  const smallW = Math.max(1, (width / scale) | 0);
  const smallH = Math.max(1, (height / scale) | 0);

  // Downscale: take max luminance in each block (approximates background)
  const smallBg = new Float32Array(smallW * smallH);

  for (let sy = 0; sy < smallH; sy++) {
    for (let sx = 0; sx < smallW; sx++) {
      let maxLum = 0;
      const yStart = sy * scale;
      const yEnd = Math.min(yStart + scale, height);
      const xStart = sx * scale;
      const xEnd = Math.min(xStart + scale, width);

      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const idx = (y * width + x) * 4;
          const lum = (pixels[idx] * 299 + pixels[idx + 1] * 587 + pixels[idx + 2] * 114) / 1000;
          if (lum > maxLum) maxLum = lum;
        }
      }
      smallBg[sy * smallW + sx] = maxLum;
    }
  }

  // 5×5 max-filter on the small background estimate to fill gaps
  const filteredBg = new Float32Array(smallW * smallH);
  const filterRadius = 2;
  for (let sy = 0; sy < smallH; sy++) {
    for (let sx = 0; sx < smallW; sx++) {
      let maxVal = 0;
      for (let dy = -filterRadius; dy <= filterRadius; dy++) {
        const ny = sy + dy;
        if (ny < 0 || ny >= smallH) continue;
        for (let dx = -filterRadius; dx <= filterRadius; dx++) {
          const nx = sx + dx;
          if (nx < 0 || nx >= smallW) continue;
          const val = smallBg[ny * smallW + nx];
          if (val > maxVal) maxVal = val;
        }
      }
      filteredBg[sy * smallW + sx] = Math.max(maxVal, 1); // avoid division by zero
    }
  }

  // Normalize each pixel using bilinear-interpolated background
  for (let y = 0; y < height; y++) {
    // Map to small coordinates
    const syf = (y / scale) - 0.5;
    const sy0 = Math.max(0, Math.min(smallH - 1, syf | 0));
    const sy1 = Math.min(smallH - 1, sy0 + 1);
    const yFrac = Math.max(0, syf - sy0);

    for (let x = 0; x < width; x++) {
      const sxf = (x / scale) - 0.5;
      const sx0 = Math.max(0, Math.min(smallW - 1, sxf | 0));
      const sx1 = Math.min(smallW - 1, sx0 + 1);
      const xFrac = Math.max(0, sxf - sx0);

      // Bilinear interpolation of background
      const bg =
        filteredBg[sy0 * smallW + sx0] * (1 - xFrac) * (1 - yFrac) +
        filteredBg[sy0 * smallW + sx1] * xFrac * (1 - yFrac) +
        filteredBg[sy1 * smallW + sx0] * (1 - xFrac) * yFrac +
        filteredBg[sy1 * smallW + sx1] * xFrac * yFrac;

      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        // Normalize: output = (pixel / background) * 255
        let val = (pixels[idx + c] / bg) * 255;

        // Mild contrast boost: push toward extremes
        val = (val - 128) * 1.15 + 128;

        pixels[idx + c] = Math.min(255, Math.max(0, val | 0));
      }
    }
  }
}
