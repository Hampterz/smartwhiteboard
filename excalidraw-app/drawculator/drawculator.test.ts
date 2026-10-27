import { describe, it, expect } from "vitest";

import {
  isEqualsSign,
  detectEqualsSign,
  clusterStrokesIntoSymbols,
  findElementsLeft,
  isSquareRoot,
  isInsideRadical,
  clusterDivisionSymbols,
} from "./strokeGrouping";
import { postProcessLatex } from "./recognizer";
import { solveMathExpression } from "./solver";
import { renderLatexToSvgDataUrl } from "./resultRenderer";

import type { StrokeSymbol } from "./types";

describe("Drawculator Stroke Grouping & Equals Detection", () => {
  it("detects geometric equals sign from two parallel strokes", () => {
    // Top bar: [100, 100] to [160, 102]
    const topBar: StrokeSymbol = {
      id: "bar1",
      bounds: { minX: 100, minY: 100, maxX: 160, maxY: 104 },
      points: [
        { x: 100, y: 100 },
        { x: 160, y: 102 },
      ],
    };

    // Bottom bar: [102, 115] to [158, 117]
    const bottomBar: StrokeSymbol = {
      id: "bar2",
      bounds: { minX: 102, minY: 115, maxX: 158, maxY: 119 },
      points: [
        { x: 102, y: 115 },
        { x: 158, y: 117 },
      ],
    };

    const grouped: StrokeSymbol = {
      id: "eq_group",
      bounds: { minX: 100, minY: 100, maxX: 160, maxY: 119 },
      children: [topBar, bottomBar],
    };

    expect(isEqualsSign(grouped)).toBe(true);
  });

  it("detects equals sign directly from raw strokes in any drawing order", () => {
    const barTop: StrokeSymbol = {
      id: "barTop",
      bounds: { minX: 450, minY: 200, maxX: 550, maxY: 215 },
      points: [
        { x: 450, y: 205 },
        { x: 550, y: 208 },
      ],
    };

    const barBottom: StrokeSymbol = {
      id: "barBottom",
      bounds: { minX: 455, minY: 270, maxX: 545, maxY: 285 },
      points: [
        { x: 455, y: 275 },
        { x: 545, y: 278 },
      ],
    };

    const eq = detectEqualsSign([barTop, barBottom]);
    expect(eq).not.toBeNull();
    expect(eq?.prediction).toBe("=");
  });

  it("clusters crossing strokes into a single multi-stroke character like '+'", () => {
    const hBar: StrokeSymbol = {
      id: "h",
      bounds: { minX: 100, minY: 145, maxX: 150, maxY: 155 },
      points: [
        { x: 100, y: 150 },
        { x: 150, y: 150 },
      ],
    };
    const vBar: StrokeSymbol = {
      id: "v",
      bounds: { minX: 120, minY: 120, maxX: 130, maxY: 180 },
      points: [
        { x: 125, y: 120 },
        { x: 125, y: 180 },
      ],
    };

    const clustered = clusterStrokesIntoSymbols([hBar, vBar]);
    expect(clustered.length).toBe(1);
    expect(clustered[0].children?.length).toBe(2);
    expect(clustered[0].prediction).toBeUndefined();
  });

  it("clusters a 2-stroke digit '4' into a single symbol without forcing '+'", () => {
    // Stroke 1: L-angle of 4
    const angleStroke: StrokeSymbol = {
      id: "s1",
      bounds: { minX: 100, minY: 100, maxX: 140, maxY: 150 },
      points: [
        { x: 130, y: 100 },
        { x: 100, y: 140 },
        { x: 140, y: 140 },
      ],
    };
    // Stroke 2: vertical stem of 4
    const stemStroke: StrokeSymbol = {
      id: "s2",
      bounds: { minX: 128, minY: 110, maxX: 134, maxY: 170 },
      points: [
        { x: 130, y: 110 },
        { x: 132, y: 170 },
      ],
    };

    const clustered = clusterStrokesIntoSymbols([angleStroke, stemStroke]);
    expect(clustered.length).toBe(1);
    expect(clustered[0].children?.length).toBe(2);
    expect(clustered[0].prediction).toBeUndefined();
  });

  it("detects square root symbol and does NOT merge it with radicand inside", () => {
    // Radical stroke: checkmark + rise + roof
    const radical: StrokeSymbol = {
      id: "rad",
      bounds: { minX: 100, minY: 80, maxX: 220, maxY: 180 },
      points: [
        { x: 105, y: 130 },
        { x: 120, y: 175 }, // apex
        { x: 135, y: 82 }, // top of rise
        { x: 170, y: 84 },
        { x: 218, y: 85 }, // roof right end
      ],
    };

    expect(isSquareRoot(radical)).toBe(true);

    // Digit 4 inside the radical
    const radicand4: StrokeSymbol = {
      id: "radicand",
      bounds: { minX: 140, minY: 100, maxX: 180, maxY: 165 },
      points: [
        { x: 150, y: 100 },
        { x: 140, y: 135 },
        { x: 180, y: 135 },
        { x: 165, y: 110 },
        { x: 165, y: 165 },
      ],
    };

    expect(isInsideRadical(radicand4, radical)).toBe(true);

    // clusterStrokesIntoSymbols must keep radical and radicand SEPARATE
    const clustered = clusterStrokesIntoSymbols([radical, radicand4]);
    expect(clustered.length).toBe(2);
    expect(clustered.map((c) => c.id)).toContain("rad");
    expect(clustered.map((c) => c.id)).toContain("radicand");
  });

  it("detects and clusters standard division symbol (÷) from bar and two dots", () => {
    const bar: StrokeSymbol = {
      id: "div_bar",
      bounds: { minX: 100, minY: 148, maxX: 140, maxY: 152 },
      points: [
        { x: 100, y: 150 },
        { x: 140, y: 150 },
      ],
    };
    const dotAbove: StrokeSymbol = {
      id: "dot_above",
      bounds: { minX: 118, minY: 130, maxX: 122, maxY: 134 },
      points: [{ x: 120, y: 132 }],
    };
    const dotBelow: StrokeSymbol = {
      id: "dot_below",
      bounds: { minX: 118, minY: 166, maxX: 122, maxY: 170 },
      points: [{ x: 120, y: 168 }],
    };

    const clustered = clusterDivisionSymbols([bar, dotAbove, dotBelow]);
    expect(clustered.length).toBe(1);
    expect(clustered[0].prediction).toBe("/");
    expect(clustered[0].confidence).toBe(0.98);
  });

  it("prevents fraction bar from merging with numerator above or denominator below", () => {
    // Numerator '9' above the fraction bar
    const num9: StrokeSymbol = {
      id: "num9",
      bounds: { minX: 100, minY: 80, maxX: 140, maxY: 138 },
      points: [
        { x: 120, y: 80 },
        { x: 100, y: 100 },
        { x: 140, y: 100 },
        { x: 135, y: 138 },
      ],
    };
    // Horizontal fraction bar
    const fracBar: StrokeSymbol = {
      id: "frac_bar",
      bounds: { minX: 95, minY: 145, maxX: 150, maxY: 150 },
      points: [
        { x: 95, y: 148 },
        { x: 150, y: 148 },
      ],
    };
    // Denominator '3' below the fraction bar
    const den3: StrokeSymbol = {
      id: "den3",
      bounds: { minX: 105, minY: 158, maxX: 145, maxY: 215 },
      points: [
        { x: 110, y: 160 },
        { x: 140, y: 175 },
        { x: 120, y: 185 },
        { x: 145, y: 200 },
        { x: 110, y: 215 },
      ],
    };

    const clustered = clusterStrokesIntoSymbols([num9, fracBar, den3]);
    // Crucial check: Must remain 3 distinct symbols, NOT collapsed into '8'!
    expect(clustered.length).toBe(3);
    expect(clustered.map((c) => c.id)).toContain("num9");
    expect(clustered.map((c) => c.id)).toContain("frac_bar");
    expect(clustered.map((c) => c.id)).toContain("den3");
  });

  it("identifies strokes strictly to the left of the equals sign", () => {
    const eq: StrokeSymbol = {
      id: "eq",
      bounds: { minX: 300, minY: 100, maxX: 350, maxY: 120 },
      prediction: "=",
    };

    const num1: StrokeSymbol = {
      id: "num1",
      bounds: { minX: 100, minY: 95, maxX: 130, maxY: 125 },
      prediction: "2",
    };

    const op: StrokeSymbol = {
      id: "op",
      bounds: { minX: 145, minY: 100, maxX: 165, maxY: 120 },
      prediction: "+",
    };

    const num2: StrokeSymbol = {
      id: "num2",
      bounds: { minX: 180, minY: 95, maxX: 210, maxY: 125 },
      prediction: "2",
    };

    const map = new Map<string, StrokeSymbol>([
      ["num1", num1],
      ["op", op],
      ["num2", num2],
      ["eq", eq],
    ]);

    const left = findElementsLeft({ elements: map, equalsSymbol: eq });
    expect(left.map((s) => s.id)).toEqual(["num1", "op", "num2"]);
  });

  it("does NOT trigger equals sign prematurely while user is writing '2 + 4'", () => {
    // Stroke 1: '2'
    const s2: StrokeSymbol = {
      id: "stroke_2",
      bounds: { minX: 50, minY: 100, maxX: 75, maxY: 140 },
      points: [
        { x: 50, y: 110 },
        { x: 70, y: 105 },
        { x: 55, y: 140 },
        { x: 75, y: 140 },
      ],
    };

    // Stroke 2: '+' vertical bar
    const sPlusV: StrokeSymbol = {
      id: "stroke_plus_v",
      bounds: { minX: 100, minY: 105, maxX: 105, maxY: 135 },
      points: [
        { x: 102, y: 105 },
        { x: 102, y: 135 },
      ],
    };

    // Stroke 3: '+' horizontal bar (crossed by vertical bar)
    const sPlusH: StrokeSymbol = {
      id: "stroke_plus_h",
      bounds: { minX: 88, minY: 118, maxX: 118, maxY: 122 },
      points: [
        { x: 88, y: 120 },
        { x: 118, y: 120 },
      ],
    };

    // When '+' is being drawn, neither bar should trigger an equals sign
    expect(detectEqualsSign([s2, sPlusV])).toBeNull();
    expect(detectEqualsSign([s2, sPlusV, sPlusH])).toBeNull();

    // Stroke 4: '4' down and horizontal
    const s4_1: StrokeSymbol = {
      id: "stroke_4_1",
      bounds: { minX: 135, minY: 105, maxX: 155, maxY: 130 },
      points: [
        { x: 145, y: 105 },
        { x: 135, y: 125 },
        { x: 155, y: 125 },
      ],
    };
    // Stroke 5: '4' vertical stem
    const s4_2: StrokeSymbol = {
      id: "stroke_4_2",
      bounds: { minX: 150, minY: 108, maxX: 153, maxY: 138 },
      points: [
        { x: 151, y: 108 },
        { x: 151, y: 138 },
      ],
    };

    // Whole expression '2 + 4' without '=' must NEVER trigger equals sign
    expect(detectEqualsSign([s2, sPlusV, sPlusH, s4_1, s4_2])).toBeNull();
  });

  it("strictly isolates equation corridor so drawings on lines above/below are ignored", () => {
    // An abandoned drawing from a line above: '10' at Y=10
    const oldAbove: StrokeSymbol = {
      id: "old_above",
      bounds: { minX: 80, minY: 10, maxX: 120, maxY: 35 },
      prediction: "10",
    };

    // Target equation at Y=120: '3 + 2 ='
    const eq: StrokeSymbol = {
      id: "eq",
      bounds: { minX: 250, minY: 115, maxX: 290, maxY: 135 },
      prediction: "=",
    };
    const sym3: StrokeSymbol = {
      id: "sym3",
      bounds: { minX: 100, minY: 110, maxX: 130, maxY: 140 },
      prediction: "3",
    };
    const symPlus: StrokeSymbol = {
      id: "symPlus",
      bounds: { minX: 145, minY: 115, maxX: 170, maxY: 135 },
      prediction: "+",
    };
    const sym2: StrokeSymbol = {
      id: "sym2",
      bounds: { minX: 185, minY: 110, maxX: 215, maxY: 140 },
      prediction: "2",
    };

    const elements = [oldAbove, sym3, symPlus, sym2, eq];
    const left = findElementsLeft({ elements, equalsSymbol: eq });

    // Must ONLY include '3', '+', '2' and NOT 'old_above'
    expect(left.map((s) => s.id)).toEqual(["sym3", "symPlus", "sym2"]);
  });
});

describe("Drawculator Math Recognizer LaTeX Processing", () => {
  it("cleans and formats function names and operators", () => {
    expect(postProcessLatex("sin(x)")).toContain("\\sin");
    expect(postProcessLatex("cos(x)")).toContain("\\cos");
    expect(postProcessLatex("lim x to 0")).toContain("\\lim");
  });

  it("formats arithmetic multiplication 'x' between numbers to '*'", () => {
    expect(postProcessLatex("4 x 2")).toBe("4 * 2");
    expect(postProcessLatex("4x2")).toBe("4 * 2");
    expect(postProcessLatex("3 x 5")).toBe("3 * 5");
    // Does NOT corrupt algebraic variables like 2x + 4
    expect(postProcessLatex("2x + 4")).toBe("2x + 4");
  });
});

describe("Drawculator Symbolic Math Solver", () => {
  it("solves basic arithmetic expressions", async () => {
    const result = await solveMathExpression("2 + 2");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("4");
  });

  it("solves exponents/powers like 3^2 + 4", async () => {
    const result = await solveMathExpression("3^{2} + 4");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("13");
  });

  it("evaluates square root expressions like \\sqrt{4}", async () => {
    const result = await solveMathExpression("\\sqrt{4}");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("2");
  });

  it("evaluates multiplication expressions like 3 * 6", async () => {
    const result = await solveMathExpression("3 * 6");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("18");
  });

  it("evaluates addition expressions like 4 + 8", async () => {
    const result = await solveMathExpression("4 + 8");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("12");
  });

  it("evaluates simple division expressions like 2 / 1 and 9 / 3", async () => {
    const result1 = await solveMathExpression("2 / 1");
    expect(result1.success).toBe(true);
    expect(result1.solvedLatex).toBe("2");

    const result2 = await solveMathExpression("9 / 3");
    expect(result2.success).toBe(true);
    expect(result2.solvedLatex).toBe("3");
  });

  it("evaluates fraction division like \\frac{9}{3} = 3", async () => {
    const result = await solveMathExpression("\\frac{9}{3}");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("3");
  });

  it("evaluates multiplication expressions like 3 * 2 = 6", async () => {
    const result = await solveMathExpression("3 * 2");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("6");
  });

  it("evaluates complex arithmetic with parentheses and division", async () => {
    const result = await solveMathExpression("\\frac{12 + 8}{4}");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("5");
  });

  it("solves polynomial algebraic equations", async () => {
    const result = await solveMathExpression("2x + 4 = 10");
    expect(result.success).toBe(true);
    expect(result.displayLatex).toContain("x = 3");
  });

  it("differentiates polynomials", async () => {
    const result = await solveMathExpression("\\frac{d}{dx} x^2");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toContain("2x");
  });

  it("computes indefinite integrals", async () => {
    const result = await solveMathExpression("\\int x^2 dx");
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toMatch(/x\^\{?3\}?/);
    expect(result.solvedLatex).toContain("C");
  });

  it("computes standard calculus limits", async () => {
    const result = await solveMathExpression(
      "\\lim_{x \\to 0} \\frac{\\sin(x)}{x}",
    );
    expect(result.success).toBe(true);
    expect(result.solvedLatex).toBe("1");
  });
});

describe("Drawculator Result Renderer", () => {
  it("renders KaTeX SVG data URL cleanly without duplicated MathML output", () => {
    const { dataUrl, width, height } = renderLatexToSvgDataUrl("6", 24);
    expect(dataUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    const decodedSvg = decodeURIComponent(dataUrl);
    // Confirm no mathml markup is included which previously caused duplicate numbers
    expect(decodedSvg).not.toContain("<math");
    expect(decodedSvg).not.toContain('class="katex-mathml"');
  });
});
