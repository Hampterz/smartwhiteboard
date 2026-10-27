import * as ort from "onnxruntime-web";

import { symbolToTensor } from "./rasterizer";

import { isSquareRoot, isInsideRadical } from "./strokeGrouping";

import type { RecognitionResult, StrokeSymbol } from "./types";

export { isSquareRoot, isInsideRadical } from "./strokeGrouping";

// Configure ONNX Runtime Web WASM binaries
ort.env.wasm.wasmPaths =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
ort.env.wasm.numThreads = 1;

let cachedSession: ort.InferenceSession | null = null;
let isInitializing = false;

const CNN_LABELS: Record<number, string> = {
  0: "0",
  1: "1",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "+",
  11: ")",
  12: ".",
  13: "/",
  14: "=",
  15: "*",
  16: "(",
  17: "-",
  18: "x",
  19: "y",
  20: "z",
};

/**
 * Initializes the ONNX inference session lazily
 */
export async function initOnnxModel(): Promise<ort.InferenceSession | null> {
  if (cachedSession) {
    return cachedSession;
  }
  if (isInitializing) {
    while (isInitializing) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return cachedSession;
  }

  isInitializing = true;
  try {
    ort.env.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
    ort.env.wasm.numThreads = 1;

    const modelUrl = "/models/cnn_single.onnx";
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch model from ${modelUrl}: HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      throw new Error(
        `Invalid model response MIME type: ${contentType} (expected binary)`,
      );
    }

    const buffer = await response.arrayBuffer();
    cachedSession = await ort.InferenceSession.create(buffer, {
      executionProviders: ["wasm"],
    });
  } catch (err) {
    console.error(
      "[Drawculator] Error loading local ONNX model, trying CDN:",
      err,
    );
    try {
      ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
      const remoteRes = await fetch(
        "https://huggingface.co/booogiee/math_cnn/resolve/main/cnn_single.onnx",
      );
      const buffer = await remoteRes.arrayBuffer();
      cachedSession = await ort.InferenceSession.create(buffer, {
        executionProviders: ["wasm"],
      });
    } catch (cdnErr) {
      console.error(
        "[Drawculator] Failed to load ONNX model from CDN as well:",
        cdnErr,
      );
    }
  } finally {
    isInitializing = false;
  }

  return cachedSession;
}

/**
 * Classifies a single symbol using the trained ONNX CNN model and geometric fallback
 */
export async function classifySymbol(
  symbol: StrokeSymbol,
  session: ort.InferenceSession | null,
): Promise<{ prediction: string; confidence: number }> {
  const w = symbol.bounds.maxX - symbol.bounds.minX;
  const h = symbol.bounds.maxY - symbol.bounds.minY;

  // If already tagged by clusterStrokesIntoSymbols (e.g. crossbars of '+', '*', division '/')
  if (symbol.prediction === "+") {
    return { prediction: "+", confidence: symbol.confidence ?? 0.98 };
  }
  if (symbol.prediction === "*" || symbol.prediction === "\\times") {
    return { prediction: "*", confidence: symbol.confidence ?? 0.98 };
  }
  if (symbol.prediction === "/" || symbol.prediction === "\\div") {
    return { prediction: "/", confidence: symbol.confidence ?? 0.98 };
  }

  // 1. Check obvious pure geometric non-CNN shapes:
  // Square root symbol (\sqrt): Checkmark dip + rise + horizontal roof
  if (isSquareRoot(symbol)) {
    symbol.prediction = "\\sqrt";
    symbol.confidence = 0.95;
    return { prediction: "\\sqrt", confidence: 0.95 };
  }

  // Minus bar (flat, wide line)
  if (w > 18 && h < 14 && w > h * 2.2) {
    symbol.prediction = "-";
    symbol.confidence = 0.96;
    return { prediction: "-", confidence: 0.96 };
  }

  // Decimal point dot
  if (w < 12 && h < 12 && (!symbol.points || symbol.points.length <= 8)) {
    symbol.prediction = ".";
    symbol.confidence = 0.92;
    return { prediction: ".", confidence: 0.92 };
  }

  // Tall S-curve integral sign (must have genuine upper/lower S-curve hooks, NOT a straight line)
  if (
    h > w * 2.2 &&
    h > 45 &&
    w > 12 &&
    w < 65 &&
    symbol.points &&
    symbol.points.length >= 8
  ) {
    const pts = symbol.points;
    const midX = (symbol.bounds.minX + symbol.bounds.maxX) / 2;
    const topPts = pts.slice(0, Math.floor(pts.length * 0.25));
    const bottomPts = pts.slice(Math.floor(pts.length * 0.75));
    const topAvgX = topPts.reduce((sum, p) => sum + p.x, 0) / topPts.length;
    const bottomAvgX =
      bottomPts.reduce((sum, p) => sum + p.x, 0) / bottomPts.length;
    if (topAvgX > midX + 2 && bottomAvgX < midX - 2) {
      symbol.prediction = "\\int";
      symbol.confidence = 0.92;
      return { prediction: "\\int", confidence: 0.92 };
    }
  }

  // 2. Primary Path: Run the ONNX CNN classifier
  const tensorData = symbolToTensor(symbol);
  if (session && tensorData) {
    try {
      const inputTensor = new ort.Tensor("float32", tensorData, [1, 1, 32, 32]);
      const results = await session.run({ input: inputTensor });
      const output = results.output?.data as Float32Array;

      if (output && output.length > 0) {
        let maxIdx = 0;
        let maxVal = output[0];
        for (let i = 1; i < output.length; i++) {
          if (output[i] > maxVal) {
            maxVal = output[i];
            maxIdx = i;
          }
        }

        // Softmax confidence
        let sumExp = 0;
        for (let i = 0; i < output.length; i++) {
          sumExp += Math.exp(output[i] - maxVal);
        }
        const confidence = Math.min(1.0, Math.max(0.1, 1 / sumExp));
        let prediction = CNN_LABELS[maxIdx] || "?";

        // Dot vs minus bar disambiguation
        if (
          w > h * 2.2 &&
          h < 20 &&
          (prediction === "." || prediction === "/")
        ) {
          prediction = "-";
        }

        // Plus ('+') vs Multiply ('*' / 'x') disambiguation based on stroke orientation
        if (
          (prediction === "+" || prediction === "*" || prediction === "x") &&
          symbol.children &&
          symbol.children.length === 2
        ) {
          const [c1, c2] = symbol.children;
          const w1 = c1.bounds.maxX - c1.bounds.minX;
          const h1 = c1.bounds.maxY - c1.bounds.minY;
          const w2 = c2.bounds.maxX - c2.bounds.minX;
          const h2 = c2.bounds.maxY - c2.bounds.minY;

          const isH1 = w1 > h1 * 1.8;
          const isV1 = h1 > w1 * 1.8;
          const isH2 = w2 > h2 * 1.8;
          const isV2 = h2 > w2 * 1.8;

          const isPlusBars = (isH1 && isV2) || (isV1 && isH2);
          const isDiagonalX = !isH1 && !isH2 && !isV1 && !isV2;

          if (isPlusBars) {
            prediction = "+";
          } else if (isDiagonalX) {
            prediction = "*";
          }
        }

        // 'z' vs '2' disambiguation:
        // Index 2 is '2', index 20 is 'z'
        if (prediction === "z" && output[2] !== undefined) {
          const pts = symbol.points || [];
          if (pts.length > 5) {
            const topSlice = pts.slice(0, Math.floor(pts.length * 0.45));
            const minY = Math.min(...topSlice.map((p) => p.y));
            // A '2' starts below the arch top and rises
            const hasArch = pts[0].y > minY + 2;
            if (hasArch || output[2] > output[20] - 2.5) {
              prediction = "2";
            }
          } else if (output[2] > output[20] - 2.5) {
            prediction = "2";
          }
        }

        symbol.prediction = prediction;
        symbol.confidence = confidence;
        return { prediction, confidence };
      }
    } catch (err) {
      console.error("[Drawculator] CNN inference failed:", err);
    }
  }

  // 3. Fallback: Geometric classifier for symbols outside CNN vocabulary
  const geo = classifyGeometricSymbol(symbol);
  if (geo) {
    symbol.prediction = geo.prediction;
    symbol.confidence = geo.confidence;
    return geo;
  }

  return { prediction: "?", confidence: 0.2 };
}

/**
 * Geometric shape classifier for advanced mathematical symbols
 * (e.g. radical square root, derivative prime tick)
 */

/**
 * Geometric shape classifier for advanced mathematical symbols
 * (e.g. radical square root, derivative prime tick)
 */
function classifyGeometricSymbol(
  symbol: StrokeSymbol,
): { prediction: string; confidence: number } | null {
  const w = symbol.bounds.maxX - symbol.bounds.minX;
  const h = symbol.bounds.maxY - symbol.bounds.minY;
  const pts = symbol.points;

  if (!pts || pts.length < 5) {
    return null;
  }

  // Prime tick (derivative) "'"
  if (h < 25 && w < 12 && h > w * 1.5) {
    return { prediction: "'", confidence: 0.85 };
  }

  if (isSquareRoot(symbol)) {
    return { prediction: "\\sqrt", confidence: 0.95 };
  }

  return null;
}

/**
 * 2D Spatial Layout Parser: Assembles classified symbols into LaTeX.
 * Handles:
 * - Fractions (\frac{numerator}{denominator})
 * - Exponents / superscripts (e.g. x^2, e^{-x})
 * - Subscripts (e.g. x_0)
 * - Square roots (\sqrt{x})
 * - Integrals (\int x^2 dx, \int_{a}^{b} f(x) dx)
 * - Multi-character numbers & expressions
 */
export async function parseExpressionToLatex(
  symbols: StrokeSymbol[],
  session: ort.InferenceSession | null,
): Promise<RecognitionResult> {
  if (symbols.length === 0) {
    return {
      latex: "",
      confidence: 0,
      symbols: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  // Step 1: Classify all individual symbols
  let totalConfidence = 0;
  for (const s of symbols) {
    if (!s.prediction) {
      const res = await classifySymbol(s, session);
      s.prediction = res.prediction;
      s.confidence = res.confidence;
    }
    totalConfidence += s.confidence ?? 0.7;
  }
  const avgConfidence = totalConfidence / symbols.length;

  // Step 2: Detect fractions
  // A fraction bar is a horizontal line with items strictly above and below it
  const consumed = new Set<string>();
  const fractionBars: {
    bar: StrokeSymbol;
    numerator: StrokeSymbol[];
    denominator: StrokeSymbol[];
  }[] = [];

  for (const s of symbols) {
    if (s.prediction === "-" || s.prediction === "/" || s.prediction === "=") {
      const barW = s.bounds.maxX - s.bounds.minX;
      const barH = s.bounds.maxY - s.bounds.minY;

      if (barW > 18 && barW > barH * 2.0) {
        const hPad = Math.max(25, barW * 0.4);
        const vPad = Math.max(70, barW * 1.5);
        const xMin = s.bounds.minX - hPad;
        const xMax = s.bounds.maxX + hPad;

        const num = symbols.filter(
          (other) =>
            other.id !== s.id &&
            !consumed.has(other.id) &&
            (other.bounds.minY + other.bounds.maxY) / 2 < s.bounds.minY &&
            other.bounds.minY < s.bounds.minY &&
            s.bounds.minY - other.bounds.maxY <= vPad &&
            other.bounds.maxX >= xMin &&
            other.bounds.minX <= xMax,
        );

        const den = symbols.filter(
          (other) =>
            other.id !== s.id &&
            !consumed.has(other.id) &&
            (other.bounds.minY + other.bounds.maxY) / 2 > s.bounds.maxY &&
            other.bounds.maxY > s.bounds.maxY &&
            other.bounds.minY - s.bounds.maxY <= vPad &&
            other.bounds.maxX >= xMin &&
            other.bounds.minX <= xMax,
        );

        if (num.length > 0 && den.length > 0) {
          fractionBars.push({
            bar: s,
            numerator: num.sort((a, b) => a.bounds.minX - b.bounds.minX),
            denominator: den.sort((a, b) => a.bounds.minX - b.bounds.minX),
          });
          consumed.add(s.id);
          num.forEach((el) => consumed.add(el.id));
          den.forEach((el) => consumed.add(el.id));
        }
      }
    }
  }

  // Step 3: Detect Square Roots
  const radicalRoots: {
    root: StrokeSymbol;
    radicand: StrokeSymbol[];
  }[] = [];

  for (const s of symbols) {
    if (s.prediction === "\\sqrt" && !consumed.has(s.id)) {
      const radW = s.bounds.maxX - s.bounds.minX;

      let inside = symbols.filter(
        (other) =>
          other.id !== s.id &&
          !consumed.has(other.id) &&
          isInsideRadical(other, s),
      );

      // If no symbol was strictly under the roof, take the immediately following symbol
      if (inside.length === 0) {
        const nextSym = symbols.find(
          (other) =>
            other.id !== s.id &&
            !consumed.has(other.id) &&
            other.bounds.minX >= s.bounds.minX + radW * 0.2 &&
            other.bounds.minX <= s.bounds.maxX + 70,
        );
        if (nextSym) {
          inside = [nextSym];
        }
      }

      if (inside.length > 0) {
        radicalRoots.push({
          root: s,
          radicand: inside.sort((a, b) => a.bounds.minX - b.bounds.minX),
        });
        consumed.add(s.id);
        inside.forEach((el) => consumed.add(el.id));
      }
    }
  }

  // Step 4: Detect Integrals with Bounds
  const integrals: {
    intSymbol: StrokeSymbol;
    lowerBound?: StrokeSymbol[];
    upperBound?: StrokeSymbol[];
  }[] = [];

  for (const s of symbols) {
    if (s.prediction === "\\int" && !consumed.has(s.id)) {
      const intH = s.bounds.maxY - s.bounds.minY;
      const lower = symbols.filter(
        (other) =>
          other.id !== s.id &&
          !consumed.has(other.id) &&
          other.bounds.minX >= s.bounds.minX - 10 &&
          other.bounds.maxX <= s.bounds.maxX + 35 &&
          other.bounds.minY >= s.bounds.maxY - intH * 0.4 &&
          other.bounds.maxY <= s.bounds.maxY + 35,
      );

      const upper = symbols.filter(
        (other) =>
          other.id !== s.id &&
          !consumed.has(other.id) &&
          other.bounds.minX >= s.bounds.minX &&
          other.bounds.maxX <= s.bounds.maxX + 45 &&
          other.bounds.minY >= s.bounds.minY - 35 &&
          other.bounds.maxY <= s.bounds.minY + intH * 0.4,
      );

      integrals.push({
        intSymbol: s,
        lowerBound:
          lower.length > 0
            ? lower.sort((a, b) => a.bounds.minX - b.bounds.minX)
            : undefined,
        upperBound:
          upper.length > 0
            ? upper.sort((a, b) => a.bounds.minX - b.bounds.minX)
            : undefined,
      });

      consumed.add(s.id);
      lower.forEach((el) => consumed.add(el.id));
      upper.forEach((el) => consumed.add(el.id));
    }
  }

  // Helper to stringify a sequence of symbols with exponents/subscripts
  function stringifySequence(seq: StrokeSymbol[]): string {
    if (seq.length === 0) {
      return "";
    }
    let result = "";

    for (let i = 0; i < seq.length; i++) {
      const cur = seq[i];
      const prev = i > 0 ? seq[i - 1] : null;

      const token = cur.prediction || "";

      // Check if this symbol is an exponent of the previous symbol
      if (prev && isSuperscript(cur, prev)) {
        result += `^{${token}}`;
        continue;
      }

      // Check if this symbol is a subscript of previous symbol
      if (prev && isSubscript(cur, prev)) {
        result += `_{${token}}`;
        continue;
      }

      result += token;
    }

    return result;
  }

  // Step 5: Assemble the full expression in left-to-right reading order
  const elementsToProcess = symbols.filter((s) => !consumed.has(s.id));
  const tokens: { x: number; str: string }[] = [];

  // Add regular symbols
  for (let i = 0; i < elementsToProcess.length; i++) {
    const cur = elementsToProcess[i];
    const prev = i > 0 ? elementsToProcess[i - 1] : null;

    const token = cur.prediction || "";

    if (prev && isSuperscript(cur, prev)) {
      tokens.push({ x: cur.bounds.minX, str: `^{${token}}` });
    } else if (prev && isSubscript(cur, prev)) {
      tokens.push({ x: cur.bounds.minX, str: `_{${token}}` });
    } else {
      tokens.push({ x: cur.bounds.minX, str: token });
    }
  }

  // Add fraction bars
  for (const frac of fractionBars) {
    const numStr = stringifySequence(frac.numerator);
    const denStr = stringifySequence(frac.denominator);
    tokens.push({
      x: frac.bar.bounds.minX,
      str: `\\frac{${numStr || "1"}}{${denStr || "1"}}`,
    });
  }

  // Add radicals
  for (const rad of radicalRoots) {
    const innerStr = stringifySequence(rad.radicand);
    tokens.push({
      x: rad.root.bounds.minX,
      str: `\\sqrt{${innerStr || "x"}}`,
    });
  }

  // Add integrals
  for (const item of integrals) {
    let intStr = "\\int";
    if (item.lowerBound && item.upperBound) {
      intStr += `_{${stringifySequence(item.lowerBound)}}^{${stringifySequence(
        item.upperBound,
      )}}`;
    } else if (item.lowerBound) {
      intStr += `_{${stringifySequence(item.lowerBound)}}`;
    } else if (item.upperBound) {
      intStr += `^{${stringifySequence(item.upperBound)}}`;
    }
    tokens.push({
      x: item.intSymbol.bounds.minX,
      str: `${intStr} `,
    });
  }

  // Sort tokens horizontally
  tokens.sort((a, b) => a.x - b.x);

  let rawLatex = tokens.map((t) => t.str).join("");

  // Step 6: Post-processing & cleanup
  rawLatex = postProcessLatex(rawLatex);

  const minX = Math.min(...symbols.map((s) => s.bounds.minX));
  const maxX = Math.max(...symbols.map((s) => s.bounds.maxX));
  const minY = Math.min(...symbols.map((s) => s.bounds.minY));
  const maxY = Math.max(...symbols.map((s) => s.bounds.maxY));

  return {
    latex: rawLatex,
    confidence: Math.round(avgConfidence * 100) / 100,
    symbols,
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * Checks if candidate is elevated in the superscript quadrant relative to base
 */
function isSuperscript(candidate: StrokeSymbol, base: StrokeSymbol): boolean {
  const nonSuper = ["+", "-", "*", "/", "=", ")", "(", "."];
  if (candidate.prediction && nonSuper.includes(candidate.prediction)) {
    return false;
  }
  if (base.prediction && nonSuper.includes(base.prediction)) {
    return false;
  }

  const baseMidY = (base.bounds.minY + base.bounds.maxY) / 2;
  const candMidY = (candidate.bounds.minY + candidate.bounds.maxY) / 2;
  const candH = candidate.bounds.maxY - candidate.bounds.minY;
  const baseH = base.bounds.maxY - base.bounds.minY;

  return (
    candMidY < baseMidY - baseH * 0.25 &&
    candidate.bounds.minY < base.bounds.minY + baseH * 0.35 &&
    candidate.bounds.minX >= base.bounds.minX + 5 &&
    candidate.bounds.minX <= base.bounds.maxX + 55 &&
    candH <= baseH * 0.95
  );
}

/**
 * Checks if candidate is situated in subscript quadrant
 */
function isSubscript(candidate: StrokeSymbol, base: StrokeSymbol): boolean {
  const nonSub = ["+", "-", "*", "/", "=", ")", "(", "."];
  if (candidate.prediction && nonSub.includes(candidate.prediction)) {
    return false;
  }
  if (base.prediction && nonSub.includes(base.prediction)) {
    return false;
  }

  const baseMidY = (base.bounds.minY + base.bounds.maxY) / 2;
  const candMidY = (candidate.bounds.minY + candidate.bounds.maxY) / 2;
  const candH = candidate.bounds.maxY - candidate.bounds.minY;
  const baseH = base.bounds.maxY - base.bounds.minY;

  return (
    candMidY > baseMidY + baseH * 0.25 &&
    candidate.bounds.maxY > base.bounds.maxY - baseH * 0.35 &&
    candidate.bounds.minX >= base.bounds.minX + 5 &&
    candidate.bounds.minX <= base.bounds.maxX + 55 &&
    candH <= baseH * 0.95
  );
}

/**
 * Normalizes recognized LaTeX tokens into standard LaTeX
 */
export function postProcessLatex(latex: string): string {
  if (!latex) {
    return "";
  }

  const cleaned = latex
    // Function keywords
    .replace(/sin/g, "\\sin ")
    .replace(/cos/g, "\\cos ")
    .replace(/tan/g, "\\tan ")
    .replace(/lim/g, "\\lim ")
    .replace(/ln/g, "\\ln ")
    .replace(/log/g, "\\log ")
    // Operators
    .replace(/\\div/g, " / ")
    .replace(/\\times/g, " * ")
    // Convert 'x' between numbers into multiplication (e.g. "4 x 2" -> "4 * 2", "4x2" -> "4 * 2")
    .replace(/(\d)\s*x\s*(\d)/g, "$1 * $2")
    // Differential d formatting
    .replace(/d([xyzrstuvw])/g, " d$1")
    // Fix multiple operators
    .replace(/\+\+/g, "+")
    .replace(/--/g, "+")
    .replace(/\+-/g, "-")
    .replace(/-\+/g, "-")
    .trim();

  return cleaned;
}
