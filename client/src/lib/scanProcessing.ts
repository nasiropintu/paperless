import { DEFAULT_CORNERS, type Point, type ScanPage } from "./scanTypes";
import { detectEdgesOpenCV, isOpenCVReady, loadOpenCV, perspectiveCorrectionOpenCV } from "./opencvProcessor";
import { autoLevels, sauvolaThreshold, unsharpMask, whiteboardEnhance } from "./imageEnhance";

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be opened."));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not render this scan.")), "image/jpeg", quality);
  });
}

function cornerFromComponent(points: number[], width: number, height: number): [Point, Point, Point, Point] | null {
  if (points.length < width * height * 0.07) return null;
  let tl = points[0];
  let tr = points[0];
  let br = points[0];
  let bl = points[0];
  let minSum = Infinity;
  let maxDiff = -Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  for (const index of points) {
    const x = index % width;
    const y = Math.floor(index / width);
    const sum = x + y;
    const diff = x - y;
    if (sum < minSum) { minSum = sum; tl = index; }
    if (diff > maxDiff) { maxDiff = diff; tr = index; }
    if (sum > maxSum) { maxSum = sum; br = index; }
    if (diff < minDiff) { minDiff = diff; bl = index; }
  }
  const point = (index: number): Point => ({ x: (index % width) / width, y: Math.floor(index / width) / height });
  const result = [point(tl), point(tr), point(br), point(bl)] as [Point, Point, Point, Point];
  const area = Math.abs(result[0].x * result[1].y + result[1].x * result[2].y + result[2].x * result[3].y + result[3].x * result[0].y - result[0].y * result[1].x - result[1].y * result[2].x - result[2].y * result[3].x - result[3].y * result[0].x) / 2;
  return area > 0.06 ? result : null;
}

/** Lightweight offline heuristic: finds the largest connected, bright, low-saturation page region. */
function detectCornersInPixels(pixels: Uint8ClampedArray, width: number, height: number): [Point, Point, Point, Point] | null {
  // Try OpenCV edge detection first
  if (isOpenCVReady()) {
    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    const cvResult = detectEdgesOpenCV(imageData, width, height);
    if (cvResult) return cvResult;
  }

  // Fallback: BFS brightness-threshold algorithm
  const total = width * height;
  const paper = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const light = (r * 299 + g * 587 + b * 114) / 1000;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    paper[i] = light > 155 && saturation < 105 ? 1 : 0;
  }
  const visited = new Uint8Array(total);
  let largest: number[] = [];
  const queue = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (!paper[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const component: number[] = [];
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const x = index % width;
      if (x > 0 && paper[index - 1] && !visited[index - 1]) { visited[index - 1] = 1; queue[tail++] = index - 1; }
      if (x < width - 1 && paper[index + 1] && !visited[index + 1]) { visited[index + 1] = 1; queue[tail++] = index + 1; }
      if (index >= width && paper[index - width] && !visited[index - width]) { visited[index - width] = 1; queue[tail++] = index - width; }
      if (index < total - width && paper[index + width] && !visited[index + width]) { visited[index + width] = 1; queue[tail++] = index + width; }
    }
    if (component.length > largest.length) largest = component;
  }
  return cornerFromComponent(largest, width, height);
}

function detectCanvasCorners(source: CanvasImageSource, aspectRatio: number): [Point, Point, Point, Point] | null {
  // Use higher resolution when OpenCV is available for better edge detection
  const width = isOpenCVReady() ? 480 : 240;
  const height = Math.max(120, Math.round(width * aspectRatio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);
  return detectCornersInPixels(context.getImageData(0, 0, width, height).data, width, height);
}

export function detectDocumentCornersInVideo(video: HTMLVideoElement): [Point, Point, Point, Point] | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  try { return detectCanvasCorners(video, video.videoHeight / video.videoWidth); } catch { return null; }
}

export async function detectDocumentCorners(blob: Blob): Promise<[Point, Point, Point, Point]> {
  // Kick off OpenCV preload in the background (fire-and-forget)
  loadOpenCV();

  try {
    const image = await loadImage(blob);
    return detectCanvasCorners(image, image.height / image.width) ?? DEFAULT_CORNERS;
  } catch {
    return DEFAULT_CORNERS;
  }
}

function solve(matrix: number[][], values: number[]): number[] {
  const n = values.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    [values[col], values[pivot]] = [values[pivot], values[col]];
    const divisor = matrix[col][col] || 1e-10;
    for (let j = col; j < n; j++) matrix[col][j] /= divisor;
    values[col] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let j = col; j < n; j++) matrix[row][j] -= factor * matrix[col][j];
      values[row] -= factor * values[col];
    }
  }
  return values;
}

function homographyToQuad(width: number, height: number, points: [Point, Point, Point, Point]): number[] {
  const destination = [[0, 0], [width, 0], [width, height], [0, height]];
  const matrix: number[][] = [];
  const values: number[] = [];
  points.forEach((point, index) => {
    const [x, y] = destination[index];
    const u = point.x;
    const v = point.y;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
  });
  return solve(matrix, values);
}

function applyTone(canvas: HTMLCanvasElement, mode: ScanPage["filter"]): void {
  if (mode === "original") return;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;
  const { width, height } = canvas;

  if (mode === "bw") {
    // Sauvola local adaptive thresholding for crisp black text on white paper
    const totalPixels = width * height;
    const gray = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      gray[i] = ((data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000) | 0;
    }
    const binary = sauvolaThreshold(gray, width, height, 15, 0.2);
    for (let i = 0; i < totalPixels; i++) {
      const v = binary[i];
      const idx = i * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
    }
  } else if (mode === "auto") {
    autoLevels(data, data.length);
    unsharpMask(data, width, height, 0.8);
  } else if (mode === "contrast") {
    autoLevels(data, data.length);
    unsharpMask(data, width, height, 1.5);
  } else if (mode === "sharpen") {
    unsharpMask(data, width, height, 2.0);
  } else if (mode === "whiteboard") {
    whiteboardEnhance(data, width, height);
  } else if (mode === "grayscale") {
    for (let i = 0; i < data.length; i += 4) {
      const gray = ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000) | 0;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  } else if (mode === "shadow") {
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      r += (255 - r) * 0.36 * (1 - r / 255);
      g += (255 - g) * 0.36 * (1 - g / 255);
      b += (255 - b) * 0.36 * (1 - b / 255);
      data[i] = Math.min(255, Math.max(0, r | 0));
      data[i + 1] = Math.min(255, Math.max(0, g | 0));
      data[i + 2] = Math.min(255, Math.max(0, b | 0));
    }
  }

  context.putImageData(frame, 0, 0);
}

function applyStrokes(context: CanvasRenderingContext2D, page: ScanPage, width: number, height: number): void {
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of page.strokes ?? []) {
    if (stroke.points.length < 1) continue;
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineWidth = stroke.width * Math.min(width, height);
    context.strokeStyle = stroke.mode === "redact" ? "#090909" : stroke.mode === "signature" ? "#111111" : "#ed3d32";
    context.stroke();
  }
}

export async function renderPage(page: ScanPage, quality = 0.9, includeMarkup = true): Promise<Blob> {
  const image = await loadImage(page.image);
  const src = document.createElement("canvas");
  const sourceScale = Math.min(1, 2200 / image.naturalWidth, 3000 / image.naturalHeight);
  src.width = Math.max(1, Math.round(image.naturalWidth * sourceScale));
  src.height = Math.max(1, Math.round(image.naturalHeight * sourceScale));
  const sourceContext = src.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas processing is not available in this browser.");
  sourceContext.drawImage(image, 0, 0, src.width, src.height);
  const corners = page.corners?.length === 4 ? page.corners : DEFAULT_CORNERS;
  const edge = (a: Point, b: Point) => Math.hypot((a.x - b.x) * src.width, (a.y - b.y) * src.height);
  const outWidth = Math.max(500, Math.min(2200, Math.round(Math.max(edge(corners[0], corners[1]), edge(corners[3], corners[2])))));
  const outHeight = Math.max(500, Math.min(3000, Math.round(Math.max(edge(corners[0], corners[3]), edge(corners[1], corners[2])))));

  const turn = ((page.rotation % 360) + 360) % 360;

  // Try OpenCV warpPerspective first
  if (isOpenCVReady()) {
    const cvCanvas = perspectiveCorrectionOpenCV(src, corners, outWidth, outHeight);
    if (cvCanvas) {
      // Apply rotation if needed
      const canvas = document.createElement("canvas");
      canvas.width = turn === 90 || turn === 270 ? outHeight : outWidth;
      canvas.height = turn === 90 || turn === 270 ? outWidth : outHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        if (turn !== 0) {
          context.save();
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate((turn * Math.PI) / 180);
          context.drawImage(cvCanvas, -outWidth / 2, -outHeight / 2);
          context.restore();
        } else {
          context.drawImage(cvCanvas, 0, 0);
        }

        applyTone(canvas, page.filter);
        if (includeMarkup) applyStrokes(context, page, canvas.width, canvas.height);
        return toBlob(canvas, quality);
      }
    }
  }

  // Fallback: manual homography pixel-by-pixel loop
  const source = sourceContext.getImageData(0, 0, src.width, src.height);
  const transform = homographyToQuad(outWidth, outHeight, corners);
  const [h0, h1, h2, h3, h4, h5, h6, h7] = transform;
  const canvas = document.createElement("canvas");
  canvas.width = turn === 90 || turn === 270 ? outHeight : outWidth;
  canvas.height = turn === 90 || turn === 270 ? outWidth : outHeight;
  const output = new ImageData(canvas.width, canvas.height);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const denominator = h6 * x + h7 * y + 1;
      const sx = Math.max(0, Math.min(src.width - 1, Math.round(((h0 * x + h1 * y + h2) / denominator) * src.width)));
      const sy = Math.max(0, Math.min(src.height - 1, Math.round(((h3 * x + h4 * y + h5) / denominator) * src.height)));
      let dx = x;
      let dy = y;
      if (turn === 90) { dx = outHeight - 1 - y; dy = x; }
      if (turn === 180) { dx = outWidth - 1 - x; dy = outHeight - 1 - y; }
      if (turn === 270) { dx = y; dy = outWidth - 1 - x; }
      const from = (sy * src.width + sx) * 4;
      const to = (dy * canvas.width + dx) * 4;
      output.data[to] = source.data[from];
      output.data[to + 1] = source.data[from + 1];
      output.data[to + 2] = source.data[from + 2];
      output.data[to + 3] = 255;
    }
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas processing is not available in this browser.");
  context.putImageData(output, 0, 0);
  applyTone(canvas, page.filter);
  if (includeMarkup) applyStrokes(context, page, canvas.width, canvas.height);
  return toBlob(canvas, quality);
}
