import type { BoundingBox, Point, StrokeSymbol } from "./types";

/**
 * Normalizes an Excalidraw freedraw element into absolute coordinates
 */
export function normalizeElement(element: {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: readonly any[];
}): StrokeSymbol {
  const points: Point[] = (element.points || []).map((pt: any) => ({
    x: element.x + (Array.isArray(pt) ? pt[0] : pt.x || 0),
    y: element.y + (Array.isArray(pt) ? pt[1] : pt.y || 0),
  }));

  const bounds = getBounds(element, points);

  return {
    id: element.id,
    bounds,
    points,
    elementIds: [element.id],
  };
}

/**
 * Computes bounding box for an element or points array
 */
export function getBounds(
  element: { x: number; y: number; width?: number; height?: number },
  points?: Point[],
): BoundingBox {
  if (!points || points.length === 0) {
    return {
      minX: element.x,
      minY: element.y,
      maxX: element.x + (element.width ?? 0),
      maxY: element.y + (element.height ?? 0),
    };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.x < minX) {
      minX = pt.x;
    }
    if (pt.x > maxX) {
      maxX = pt.x;
    }
    if (pt.y < minY) {
      minY = pt.y;
    }
    if (pt.y > maxY) {
      maxY = pt.y;
    }
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Groups raw symbols based on proximity (backwards compatibility with Drawculator)
 */
export function groupBounds(
  elements: StrokeSymbol[],
  threshold = 18,
): StrokeSymbol {
  if (elements.length === 0) {
    throw new Error("No elements to group");
  }

  let i = elements.length - 1;
  const thresholdY = Math.pow(threshold, 1.6);
  const latest = elements[i];

  const grouped: StrokeSymbol = {
    id: latest.id,
    points: latest.points ? [...latest.points] : [],
    bounds: { ...latest.bounds },
    children: [latest],
    elementIds: latest.elementIds ? [...latest.elementIds] : [latest.id],
  };

  while (i > 0) {
    const prev = elements[i - 1];

    const dx = Math.max(
      0,
      Math.max(
        grouped.bounds.minX - prev.bounds.maxX,
        prev.bounds.minX - grouped.bounds.maxX,
      ),
    );
    const dy = Math.max(
      0,
      Math.max(
        grouped.bounds.minY - prev.bounds.maxY,
        prev.bounds.minY - grouped.bounds.maxY,
      ),
    );

    if (dx <= threshold && dy <= thresholdY) {
      grouped.id = prev.id;
      if (prev.points) {
        grouped.points = grouped.points || [];
        grouped.points.push(...prev.points);
      }
      grouped.bounds = {
        minX: Math.min(grouped.bounds.minX, prev.bounds.minX),
        maxX: Math.max(grouped.bounds.maxX, prev.bounds.maxX),
        minY: Math.min(grouped.bounds.minY, prev.bounds.minY),
        maxY: Math.max(grouped.bounds.maxY, prev.bounds.maxY),
      };
      grouped.children = grouped.children || [];
      grouped.children.push(prev);
      if (prev.elementIds) {
        grouped.elementIds?.push(...prev.elementIds);
      }
      i--;
    } else {
      break;
    }
  }

  return grouped;
}

/**
 * Checks if a grouped symbol or pair of strokes is an equals sign (=)
 */
export function isEqualsSign(symbol: StrokeSymbol): boolean {
  if (symbol.prediction === "=" || symbol.prediction === "eq") {
    return true;
  }

  // Geometric check for two parallel horizontal strokes
  if (symbol.children && symbol.children.length === 2) {
    const [c1, c2] = symbol.children;
    const w1 = c1.bounds.maxX - c1.bounds.minX;
    const h1 = c1.bounds.maxY - c1.bounds.minY;
    const w2 = c2.bounds.maxX - c2.bounds.minX;
    const h2 = c2.bounds.maxY - c2.bounds.minY;

    // Both should be roughly horizontal
    const isH1 = w1 > Math.max(6, h1 * 1.15);
    const isH2 = w2 > Math.max(6, h2 * 1.15);

    // Check width similarity
    const widthRatio = Math.min(w1, w2) / Math.max(w1, w2);

    // Check horizontal overlap
    const overlapMinX = Math.max(c1.bounds.minX, c2.bounds.minX);
    const overlapMaxX = Math.min(c1.bounds.maxX, c2.bounds.maxX);
    const overlapWidth = Math.max(0, overlapMaxX - overlapMinX);
    const overlapRatio = overlapWidth / Math.max(w1, w2);

    // Vertical gap between the two bars
    const verticalGap = Math.abs(
      (c1.bounds.minY + c1.bounds.maxY) / 2 -
        (c2.bounds.minY + c2.bounds.maxY) / 2,
    );
    const maxBarWidth = Math.max(w1, w2);

    if (
      isH1 &&
      isH2 &&
      widthRatio > 0.3 &&
      overlapRatio > 0.35 &&
      verticalGap < maxBarWidth * 2.5 &&
      verticalGap >= 3
    ) {
      return true;
    }
  }

  // Also check if single stroke was drawn as a quick double-dash or zigzag
  const totalW = symbol.bounds.maxX - symbol.bounds.minX;
  const totalH = symbol.bounds.maxY - symbol.bounds.minY;
  if (
    totalW > 15 &&
    totalW < 140 &&
    totalH > 8 &&
    totalH < 90 &&
    totalW > totalH * 0.8
  ) {
    if (symbol.prediction === "=") {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a horizontal stroke is intersected or crossed by another stroke.
 * Horizontal bars of an equals sign must never have crossing lines (like '+', 'x', '4').
 */
function isStrokeCrossed(
  target: StrokeSymbol,
  allStrokes: StrokeSymbol[],
): boolean {
  const tw = target.bounds.maxX - target.bounds.minX;
  const th = target.bounds.maxY - target.bounds.minY;
  const tMidX = (target.bounds.minX + target.bounds.maxX) / 2;
  const tMidY = (target.bounds.minY + target.bounds.maxY) / 2;

  for (const other of allStrokes) {
    if (other.id === target.id) {
      continue;
    }
    const oh = other.bounds.maxY - other.bounds.minY;

    // A crossing stroke penetrates the horizontal bar near its center
    if (
      other.bounds.minX < tMidX + tw * 0.35 &&
      other.bounds.maxX > tMidX - tw * 0.35 &&
      other.bounds.minY <= tMidY + 4 &&
      other.bounds.maxY >= tMidY - 4
    ) {
      if (oh > th * 1.15) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Searches the scene for an equals sign (=) triggered by the user drawing.
 * CRITICAL RULE: The most recently drawn stroke MUST be part of the equals sign.
 * This guarantees the solver NEVER triggers prematurely while writing intermediate math.
 */
export function detectEqualsSign(
  rawSymbols: StrokeSymbol[],
  processedIds: Set<string> = new Set(),
): StrokeSymbol | null {
  const active = rawSymbols.filter(
    (s) =>
      !s.done && !processedIds.has(s.id) && s.points && s.points.length > 0,
  );
  if (active.length === 0) {
    return null;
  }

  // Check if active array ends with an explicit pre-grouped equals sign
  const lastStroke = active[active.length - 1];
  if (lastStroke.prediction === "=" || isEqualsSign(lastStroke)) {
    return lastStroke;
  }

  // The latest stroke MUST be horizontal and uncrossed
  const lw = lastStroke.bounds.maxX - lastStroke.bounds.minX;
  const lh = lastStroke.bounds.maxY - lastStroke.bounds.minY;
  const isLHoriz = lw >= 12 && lw >= Math.max(7, lh * 1.35);

  if (!isLHoriz || isStrokeCrossed(lastStroke, active)) {
    return null;
  }

  const lMidX = (lastStroke.bounds.minX + lastStroke.bounds.maxX) / 2;
  const lMidY = (lastStroke.bounds.minY + lastStroke.bounds.maxY) / 2;

  // Search backward through remaining strokes for a parallel partner bar
  for (let j = active.length - 2; j >= 0; j--) {
    const p = active[j];
    const pw = p.bounds.maxX - p.bounds.minX;
    const ph = p.bounds.maxY - p.bounds.minY;
    const isPHoriz = pw >= 12 && pw >= Math.max(7, ph * 1.35);

    if (!isPHoriz || isStrokeCrossed(p, active)) {
      continue;
    }

    const pMidX = (p.bounds.minX + p.bounds.maxX) / 2;
    const pMidY = (p.bounds.minY + p.bounds.maxY) / 2;
    const maxW = Math.max(lw, pw);

    // 1. Width similarity
    const widthRatio = Math.min(lw, pw) / maxW;
    if (widthRatio < 0.45) {
      continue;
    }

    // 2. Horizontal overlap
    const overlapMinX = Math.max(lastStroke.bounds.minX, p.bounds.minX);
    const overlapMaxX = Math.min(lastStroke.bounds.maxX, p.bounds.maxX);
    const overlapW = Math.max(0, overlapMaxX - overlapMinX);
    const overlapRatio = overlapW / maxW;
    if (overlapRatio < 0.5) {
      continue;
    }

    // 3. Center X alignment
    if (Math.abs(lMidX - pMidX) > maxW * 0.4) {
      continue;
    }

    // 4. Vertical gap between bars
    const vGap = Math.abs(lMidY - pMidY);
    if (vGap < 4 || vGap > maxW * 1.6) {
      continue;
    }

    // 5. Ensure nothing is sandwiched between the two bars
    const minY = Math.min(lMidY, pMidY);
    const maxY = Math.max(lMidY, pMidY);
    const hasInterfering = active.some(
      (s) =>
        s.id !== lastStroke.id &&
        s.id !== p.id &&
        s.bounds.minX < overlapMaxX &&
        s.bounds.maxX > overlapMinX &&
        s.bounds.minY > minY &&
        s.bounds.maxY < maxY,
    );
    if (hasInterfering) {
      continue;
    }

    const top = lMidY < pMidY ? lastStroke : p;
    const bottom = lMidY < pMidY ? p : lastStroke;

    return {
      id: `eq_${top.id}_${bottom.id}`,
      bounds: {
        minX: Math.min(top.bounds.minX, bottom.bounds.minX),
        maxX: Math.max(top.bounds.maxX, bottom.bounds.maxX),
        minY: Math.min(top.bounds.minY, bottom.bounds.minY),
        maxY: Math.max(top.bounds.maxY, bottom.bounds.maxY),
      },
      points: [...(top.points || []), ...(bottom.points || [])],
      children: [top, bottom],
      elementIds: [
        ...(top.elementIds || [top.id]),
        ...(bottom.elementIds || [bottom.id]),
      ],
      prediction: "=",
      confidence: 0.99,
    };
  }

  return null;
}

/**
 * Detects whether a stroke is a handwritten square root symbol (\sqrt)
 */
export function isSquareRoot(symbol: StrokeSymbol): boolean {
  if (
    symbol.prediction === "/" ||
    symbol.prediction === "\\div" ||
    symbol.prediction === "-"
  ) {
    return false;
  }

  const w = symbol.bounds.maxX - symbol.bounds.minX;
  const h = symbol.bounds.maxY - symbol.bounds.minY;
  const pts = symbol.points;
  if (!pts || pts.length < 5) {
    return false;
  }

  if (w < 20 || h < 16) {
    return false;
  }

  // If the symbol is formed from multiple children, reject if any child is a tiny dot (like division dots)
  if (symbol.children && symbol.children.length > 1) {
    const hasDotChild = symbol.children.some(
      (c) =>
        c.bounds.maxX - c.bounds.minX < 20 &&
        c.bounds.maxY - c.bounds.minY < 20,
    );
    if (hasDotChild) {
      return false;
    }
  }

  let lowestY = pts[0].y;
  let lowestIdx = 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].y > lowestY) {
      lowestY = pts[i].y;
      lowestIdx = i;
    }
  }

  // Can start with a down-hook (lowestIdx in first 65%) OR start directly at the bottom apex
  const startsNearBottom = pts[0].y >= symbol.bounds.maxY - h * 0.35;
  if (!startsNearBottom && (lowestIdx === 0 || lowestIdx > pts.length * 0.65)) {
    return false;
  }

  const afterDip = pts.slice(lowestIdx);
  if (afterDip.length < 3) {
    return false;
  }
  const highestAfterDip = Math.min(...afterDip.map((p) => p.y));
  const rise = lowestY - highestAfterDip;
  if (rise < h * 0.35) {
    return false;
  }

  // Roof should be in top portion of the bounding box and extend horizontally to the right
  const lastPts = pts.slice(-Math.max(3, Math.floor(pts.length * 0.25)));
  const roofY = Math.min(...lastPts.map((p) => p.y));
  const isNearTop = roofY <= symbol.bounds.minY + h * 0.5;
  const extendsRight =
    afterDip[afterDip.length - 1].x > symbol.bounds.minX + w * 0.45;

  return isNearTop && extendsRight;
}

/**
 * Checks if candidate stroke is located inside the radical's interior radicand region
 */
export function isInsideRadical(
  candidate: StrokeSymbol,
  radical: StrokeSymbol,
): boolean {
  const radW = radical.bounds.maxX - radical.bounds.minX;
  const radH = radical.bounds.maxY - radical.bounds.minY;

  // The radicand candidate must be situated to the right of the radical's initial hook
  const isHorizontallyInside =
    candidate.bounds.minX >= radical.bounds.minX + radW * 0.1 &&
    candidate.bounds.minX <= radical.bounds.maxX + 45;

  // The radicand must be below the radical roof line
  const isVerticallyInside =
    candidate.bounds.minY >= radical.bounds.minY - 20 &&
    candidate.bounds.minY <= radical.bounds.maxY + 20 &&
    candidate.bounds.maxY <= radical.bounds.maxY + Math.max(75, radH * 0.4);

  return isHorizontallyInside && isVerticallyInside;
}

/**
 * Detects standard division symbol (\div) consisting of a horizontal bar
 * with a dot above and a dot below, clustering them into a single symbol.
 */
export function clusterDivisionSymbols(
  rawStrokes: StrokeSymbol[],
): StrokeSymbol[] {
  const result: StrokeSymbol[] = [];
  const consumed = new Set<string>();

  for (let i = 0; i < rawStrokes.length; i++) {
    const bar = rawStrokes[i];
    if (consumed.has(bar.id)) {
      continue;
    }

    const barW = bar.bounds.maxX - bar.bounds.minX;
    const barH = bar.bounds.maxY - bar.bounds.minY;

    // Must be a horizontal bar
    if (barW >= 12 && barW > barH * 1.6) {
      const barMidX = (bar.bounds.minX + bar.bounds.maxX) / 2;

      // Find dot above
      const dotAbove = rawStrokes.find((other) => {
        if (other.id === bar.id || consumed.has(other.id)) {
          return false;
        }
        const w = other.bounds.maxX - other.bounds.minX;
        const h = other.bounds.maxY - other.bounds.minY;
        const midX = (other.bounds.minX + other.bounds.maxX) / 2;
        const isSmall = w <= 24 && h <= 24;
        const isAbove =
          other.bounds.maxY <= bar.bounds.minY + 6 &&
          bar.bounds.minY - other.bounds.maxY <= Math.max(45, barW * 1.5);
        const isHorizAligned =
          Math.abs(midX - barMidX) <= Math.max(18, barW * 0.55);
        return isSmall && isAbove && isHorizAligned;
      });

      // Find dot below
      const dotBelow = rawStrokes.find((other) => {
        if (
          other.id === bar.id ||
          consumed.has(other.id) ||
          (dotAbove && other.id === dotAbove.id)
        ) {
          return false;
        }
        const w = other.bounds.maxX - other.bounds.minX;
        const h = other.bounds.maxY - other.bounds.minY;
        const midX = (other.bounds.minX + other.bounds.maxX) / 2;
        const isSmall = w <= 24 && h <= 24;
        const isBelow =
          other.bounds.minY >= bar.bounds.maxY - 6 &&
          other.bounds.minY - bar.bounds.maxY <= Math.max(45, barW * 1.5);
        const isHorizAligned =
          Math.abs(midX - barMidX) <= Math.max(18, barW * 0.55);
        return isSmall && isBelow && isHorizAligned;
      });

      if (dotAbove && dotBelow) {
        consumed.add(bar.id);
        consumed.add(dotAbove.id);
        consumed.add(dotBelow.id);

        const combinedMinX = Math.min(
          bar.bounds.minX,
          dotAbove.bounds.minX,
          dotBelow.bounds.minX,
        );
        const combinedMaxX = Math.max(
          bar.bounds.maxX,
          dotAbove.bounds.maxX,
          dotBelow.bounds.maxX,
        );
        const combinedMinY = Math.min(
          bar.bounds.minY,
          dotAbove.bounds.minY,
          dotBelow.bounds.minY,
        );
        const combinedMaxY = Math.max(
          bar.bounds.maxY,
          dotAbove.bounds.maxY,
          dotBelow.bounds.maxY,
        );

        const divSymbol: StrokeSymbol = {
          id: `div_${bar.id}`,
          bounds: {
            minX: combinedMinX,
            maxX: combinedMaxX,
            minY: combinedMinY,
            maxY: combinedMaxY,
          },
          points: [
            ...(dotAbove.points || []),
            ...(bar.points || []),
            ...(dotBelow.points || []),
          ],
          children: [bar, dotAbove, dotBelow],
          elementIds: [
            ...(bar.elementIds || [bar.id]),
            ...(dotAbove.elementIds || [dotAbove.id]),
            ...(dotBelow.elementIds || [dotBelow.id]),
          ],
          prediction: "/",
          confidence: 0.98,
        };

        result.push(divSymbol);
        continue;
      }
    }

    result.push(bar);
  }

  return result.filter((s) => !consumed.has(s.id) || s.id.startsWith("div_"));
}

/**
 * Clusters an array of freedraw strokes into logical symbols (characters).
 * Strokes that overlap or intersect heavily (e.g. crossbars of '+', 'x', '4', dots)
 * are merged into a single multi-stroke StrokeSymbol.
 */
export function clusterStrokesIntoSymbols(
  rawStrokes: StrokeSymbol[],
  threshold = 16,
): StrokeSymbol[] {
  if (rawStrokes.length === 0) {
    return [];
  }

  // Pre-cluster division signs (\div: bar with dot above and dot below)
  const preGrouped = clusterDivisionSymbols(rawStrokes);

  const clusters: StrokeSymbol[] = preGrouped.map((s) => ({
    id: s.id,
    bounds: { ...s.bounds },
    points: s.points ? [...s.points] : [],
    children: s.children && s.children.length > 0 ? [...s.children] : [s],
    elementIds: s.elementIds ? [...s.elementIds] : [s.id],
    prediction: s.prediction,
    confidence: s.confidence,
  }));

  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const c1 = clusters[i];
        const c2 = clusters[j];

        // An already recognized division symbol (\div) should never merge with adjacent numbers
        if (c1.prediction === "/" || c2.prediction === "/") {
          continue;
        }

        const dx = Math.max(
          0,
          Math.max(
            c1.bounds.minX - c2.bounds.maxX,
            c2.bounds.minX - c1.bounds.maxX,
          ),
        );
        const dy = Math.max(
          0,
          Math.max(
            c1.bounds.minY - c2.bounds.maxY,
            c2.bounds.minY - c1.bounds.maxY,
          ),
        );

        // Check if bounding boxes overlap
        const overlaps =
          c1.bounds.minX <= c2.bounds.maxX &&
          c1.bounds.maxX >= c2.bounds.minX &&
          c1.bounds.minY <= c2.bounds.maxY &&
          c1.bounds.maxY >= c2.bounds.minY;

        // Two horizontal bars should NOT be merged here if both are flat bars
        const isH1 =
          c1.bounds.maxX - c1.bounds.minX >
          (c1.bounds.maxY - c1.bounds.minY) * 2;
        const isH2 =
          c2.bounds.maxX - c2.bounds.minX >
          (c2.bounds.maxY - c2.bounds.minY) * 2;
        const bothHorizontal = isH1 && isH2;

        // Fraction Bar Protection:
        // A horizontal bar (fraction bar) must NEVER merge vertically with elements sitting
        // strictly above it (numerator) or strictly below it (denominator).
        const isHBar1 = isH1 && c1.bounds.maxX - c1.bounds.minX >= 14;
        const isHBar2 = isH2 && c2.bounds.maxX - c2.bounds.minX >= 14;

        if (isHBar1) {
          const c2MidY = (c2.bounds.minY + c2.bounds.maxY) / 2;
          const horizontallyAligned =
            c2.bounds.maxX >= c1.bounds.minX - 25 &&
            c2.bounds.minX <= c1.bounds.maxX + 25;
          if (horizontallyAligned) {
            if (c2MidY < c1.bounds.minY || c2MidY > c1.bounds.maxY) {
              continue;
            }
          }
        }

        if (isHBar2) {
          const c1MidY = (c1.bounds.minY + c1.bounds.maxY) / 2;
          const horizontallyAligned =
            c1.bounds.maxX >= c2.bounds.minX - 25 &&
            c1.bounds.minX <= c2.bounds.maxX + 25;
          if (horizontallyAligned) {
            if (c1MidY < c2.bounds.minY || c1MidY > c2.bounds.maxY) {
              continue;
            }
          }
        }

        // Radical square root and its radicand contents must NOT be merged
        const c1IsSqrt = isSquareRoot(c1);
        const c2IsSqrt = isSquareRoot(c2);
        if (c1IsSqrt && isInsideRadical(c2, c1)) {
          continue;
        }
        if (c2IsSqrt && isInsideRadical(c1, c2)) {
          continue;
        }

        const isSmallDot1 =
          c1.bounds.maxX - c1.bounds.minX <= 18 &&
          c1.bounds.maxY - c1.bounds.minY <= 18;
        const isSmallDot2 =
          c2.bounds.maxX - c2.bounds.minX <= 18 &&
          c2.bounds.maxY - c2.bounds.minY <= 18;
        const isDotMerge =
          (isSmallDot1 || isSmallDot2) &&
          dx <= threshold &&
          dy <= threshold * 1.5;
        const isTouching = dx <= 8 && dy <= 8;

        if ((overlaps || isTouching || isDotMerge) && !bothHorizontal) {
          c1.bounds = {
            minX: Math.min(c1.bounds.minX, c2.bounds.minX),
            maxX: Math.max(c1.bounds.maxX, c2.bounds.maxX),
            minY: Math.min(c1.bounds.minY, c2.bounds.minY),
            maxY: Math.max(c1.bounds.maxY, c2.bounds.maxY),
          };
          c1.points = [...(c1.points || []), ...(c2.points || [])];
          c1.children = [...(c1.children || []), ...(c2.children || [])];
          c1.elementIds = [...(c1.elementIds || []), ...(c2.elementIds || [])];
          c1.prediction = undefined;
          c1.confidence = undefined;

          clusters.splice(j, 1);
          mergedAny = true;
          break;
        }
      }
      if (mergedAny) {
        break;
      }
    }
  }

  return clusters;
}

/**
 * Finds elements to the left of the given equals sign symbol
 * Returns symbols sorted left to right (natural reading order)
 */
export function findElementsLeft({
  elements,
  equalsSymbol,
  maxDistance = 1200,
  maxGap = 120,
}: {
  elements: Map<string, StrokeSymbol> | StrokeSymbol[];
  equalsSymbol: StrokeSymbol;
  maxDistance?: number;
  maxGap?: number;
}): StrokeSymbol[] {
  const eqBounds = equalsSymbol.bounds;
  const eqMidY = (eqBounds.minY + eqBounds.maxY) / 2;
  const eqHeight = Math.max(16, eqBounds.maxY - eqBounds.minY);

  // Corridor accommodates exponents (e.g. 3^2), radicals, and fractions (up to 75px),
  // while strictly excluding separate drawings on lines above or below (> 80px away).
  const corridorPadding = Math.max(75, eqHeight * 2.8);
  const corridorMinY = eqMidY - corridorPadding;
  const corridorMaxY = eqMidY + corridorPadding;

  const eqIds = new Set(equalsSymbol.elementIds || [equalsSymbol.id]);

  const candidateSymbols: StrokeSymbol[] = [];
  const list = Array.isArray(elements)
    ? elements
    : Array.from(elements.values());

  list.forEach((symbol) => {
    if (eqIds.has(symbol.id) || symbol.done) {
      return;
    }

    // Must be to the left of equals sign
    if (symbol.bounds.maxX <= eqBounds.minX + 15) {
      // Must intersect the vertical corridor
      if (
        symbol.bounds.minY <= corridorMaxY &&
        symbol.bounds.maxY >= corridorMinY
      ) {
        // Distance check from equals sign
        if (eqBounds.minX - symbol.bounds.maxX <= maxDistance) {
          candidateSymbols.push(symbol);
        }
      }
    }
  });

  if (candidateSymbols.length === 0) {
    return [];
  }

  // Sort candidate symbols by maxX descending (starting from closest to equals sign)
  candidateSymbols.sort((a, b) => b.bounds.maxX - a.bounds.maxX);

  const connectedSymbols: StrokeSymbol[] = [];
  let currentRight = eqBounds.minX;

  for (const candidate of candidateSymbols) {
    const gap = currentRight - candidate.bounds.maxX;
    if (gap > maxGap && connectedSymbols.length > 0) {
      break;
    }
    connectedSymbols.push(candidate);
    currentRight = Math.min(currentRight, candidate.bounds.minX);
  }

  // Sort final expression from left to right for natural math reading
  connectedSymbols.sort((a, b) => a.bounds.minX - b.bounds.minX);

  return connectedSymbols;
}

/**
 * Combines bounding boxes of an array of symbols
 */
export function getCombinedBounds(symbols: StrokeSymbol[]): BoundingBox {
  if (symbols.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = symbols[0].bounds.minX;
  let maxX = symbols[0].bounds.maxX;
  let minY = symbols[0].bounds.minY;
  let maxY = symbols[0].bounds.maxY;

  for (let i = 1; i < symbols.length; i++) {
    const b = symbols[i].bounds;
    if (b.minX < minX) {
      minX = b.minX;
    }
    if (b.maxX > maxX) {
      maxX = b.maxX;
    }
    if (b.minY < minY) {
      minY = b.minY;
    }
    if (b.maxY > maxY) {
      maxY = b.maxY;
    }
  }

  return { minX, minY, maxX, maxY };
}
