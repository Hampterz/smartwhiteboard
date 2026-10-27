import { getCombinedBounds } from "./strokeGrouping";

import type { BoundingBox, StrokeSymbol } from "./types";

/**
 * Converts a single symbol's stroke points into a 32x32 Float32Array
 * compatible with Drawculator's CNN model (input shape [1, 1, 32, 32]).
 */
export function symbolToTensor(symbol: StrokeSymbol): Float32Array | null {
  const GRID_SIZE = 32;
  const PADDING = 6;
  const USABLE_SIZE = GRID_SIZE - PADDING * 2;

  const points = symbol.points;
  if (!points || points.length === 0) {
    return null;
  }

  const grid = new Uint8Array(GRID_SIZE * GRID_SIZE);

  const xData = points.map((p) => p.x);
  const yData = points.map((p) => p.y);

  let xMin = xData[0];
  let xMax = xData[0];
  let yMin = yData[0];
  let yMax = yData[0];

  for (let i = 1; i < xData.length; i++) {
    if (xData[i] < xMin) {
      xMin = xData[i];
    }
    if (xData[i] > xMax) {
      xMax = xData[i];
    }
    if (yData[i] < yMin) {
      yMin = yData[i];
    }
    if (yData[i] > yMax) {
      yMax = yData[i];
    }
  }

  const dataWidth = xMax - xMin || 1;
  const dataHeight = yMax - yMin || 1;

  const SOFTENING = 67;
  const maxDimension = Math.max(dataWidth, dataHeight);
  const scale = USABLE_SIZE / (maxDimension + SOFTENING);

  const scaledWidth = dataWidth * scale;
  const scaledHeight = dataHeight * scale;
  const xOffset = PADDING + (USABLE_SIZE - scaledWidth) / 2;
  const yOffset = PADDING + (USABLE_SIZE - scaledHeight) / 2;

  const pixelPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < xData.length; i++) {
    const xPixel = Math.round((xData[i] - xMin) * scale + xOffset);
    const yPixel = Math.round((yData[i] - yMin) * scale + yOffset);
    pixelPoints.push({
      x: Math.max(0, Math.min(GRID_SIZE - 1, xPixel)),
      y: Math.max(0, Math.min(GRID_SIZE - 1, yPixel)),
    });
  }

  const drawPixel = (x: number, y: number) => {
    grid[y * GRID_SIZE + x] = 255;
    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
        grid[ny * GRID_SIZE + nx] = Math.max(grid[ny * GRID_SIZE + nx], 128);
      }
    }
  };

  // Bresenham's line algorithm
  const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      drawPixel(x0, y0);
      if (x0 === x1 && y0 === y1) {
        break;
      }
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  // Draw lines through sequential points
  let offset = 0;
  if (symbol.children && symbol.children.length > 0) {
    for (const child of symbol.children) {
      if (child.points && child.points.length > 1) {
        for (let i = 0; i < child.points.length - 1; i++) {
          const p1 = pixelPoints[i + offset];
          const p2 = pixelPoints[i + offset + 1];
          if (p1 && p2) {
            drawLine(p1.x, p1.y, p2.x, p2.y);
          }
        }
        offset += child.points.length;
      }
    }
  } else {
    for (let i = 0; i < pixelPoints.length - 1; i++) {
      drawLine(
        pixelPoints[i].x,
        pixelPoints[i].y,
        pixelPoints[i + 1].x,
        pixelPoints[i + 1].y,
      );
    }
  }

  // Normalize: (PixelValue / 255.0 - 0.5) / 0.5
  const floatBuffer = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (let i = 0; i < grid.length; i++) {
    floatBuffer[i] = (grid[i] / 255.0 - 0.5) / 0.5;
  }

  return floatBuffer;
}

/**
 * Renders an entire mathematical expression's strokes onto an offscreen canvas.
 * Useful for visual preview, full-expression OCR models (like pix2tex / LaTeX-OCR),
 * and image generation.
 */
export function rasterizeExpressionToCanvas(
  symbols: StrokeSymbol[],
  targetWidth = 512,
  targetHeight = 160,
  padding = 24,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  if (symbols.length === 0) {
    return canvas;
  }

  const bounds: BoundingBox = getCombinedBounds(symbols);
  const exprW = Math.max(1, bounds.maxX - bounds.minX);
  const exprH = Math.max(1, bounds.maxY - bounds.minY);

  const usableW = targetWidth - padding * 2;
  const usableH = targetHeight - padding * 2;

  const scale = Math.min(usableW / exprW, usableH / exprH, 2.5);

  const drawW = exprW * scale;
  const drawH = exprH * scale;

  const offsetX = padding + (usableW - drawW) / 2;
  const offsetY = padding + (usableH - drawH) / 2;

  // Dark strokes with rounded caps
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(2.5, Math.min(5, 3.2 * scale));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const symbol of symbols) {
    const strokeList: { points?: { x: number; y: number }[] }[] =
      symbol.children && symbol.children.length > 0
        ? symbol.children
        : [symbol];

    for (const stroke of strokeList) {
      const pts = stroke.points;
      if (!pts || pts.length === 0) {
        continue;
      }

      ctx.beginPath();
      const startX = (pts[0].x - bounds.minX) * scale + offsetX;
      const startY = (pts[0].y - bounds.minY) * scale + offsetY;
      ctx.moveTo(startX, startY);

      for (let i = 1; i < pts.length; i++) {
        const px = (pts[i].x - bounds.minX) * scale + offsetX;
        const py = (pts[i].y - bounds.minY) * scale + offsetY;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  return canvas;
}
