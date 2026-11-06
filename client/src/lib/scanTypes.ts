export type FilterMode = "original" | "auto" | "grayscale" | "bw" | "contrast" | "shadow";
export type MarkupMode = "off" | "ink" | "redact" | "signature";

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  mode: Exclude<MarkupMode, "off">;
  points: Point[];
  width: number;
}

export interface ScanPage {
  id: string;
  image: Blob;
  corners: [Point, Point, Point, Point];
  rotation: number;
  filter: FilterMode;
  strokes: Stroke[];
  createdAt: number;
}

export interface ScanDocument {
  id: string;
  title: string;
  folder: string;
  tags: string[];
  pages: ScanPage[];
  ocrText: string;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_CORNERS: [Point, Point, Point, Point] = [
  { x: 0.04, y: 0.04 },
  { x: 0.96, y: 0.04 },
  { x: 0.96, y: 0.96 },
  { x: 0.04, y: 0.96 },
];
