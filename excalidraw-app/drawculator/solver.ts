import { ComputeEngine } from "@cortex-js/compute-engine";

import type { SolvedResult } from "./types";

let ceInstance: ComputeEngine | null = null;

function getComputeEngine(): ComputeEngine {
  if (!ceInstance) {
    ceInstance = new ComputeEngine();
  }
  return ceInstance;
}

/**
 * Clean up LaTeX string from ComputeEngine (removing non-standard MathJSON artifacts)
 */
export function cleanLatexOutput(latex: string): string {
  if (!latex) {
    return "";
  }

  return latex
    .replace(/\\(imaginaryI|ComplexI)/g, "i")
    .replace(/\\exponentialE/g, "e")
    .replace(/\\doubleStruckCapitalR/g, "\\mathbb{R}")
    .replace(/\\doubleStruckCapitalC/g, "\\mathbb{C}")
    .replace(/\\doubleStruckCapitalZ/g, "\\mathbb{Z}")
    .replace(/\\doubleStruckCapitalI/g, "\\infty")
    .replace(/\\Element/g, "\\in")
    .replace(/\\NotEqual/g, "\\neq")
    .replace(/\\differentialD/g, "d")
    .replace(/\\left\(/g, "(")
    .replace(/\\right\)/g, ")")
    .trim();
}

/**
 * Solves a mathematical expression or equation represented as LaTeX.
 * Supports:
 * - Arithmetic and algebraic simplification
 * - Polynomial equations (e.g. x^2 - 4 = 0)
 * - Symbolic differentiation (\frac{d}{dx}(x^3 + 2x))
 * - Indefinite and definite integrals (\int x^2 dx, \int_{0}^{2} x dx)
 * - Limits (\lim_{x \to 0} \frac{\sin x}{x})
 * - Trigonometry, exponents, logs
 */
export async function solveMathExpression(
  rawLatex: string,
): Promise<SolvedResult> {
  const trimmed = rawLatex.trim();
  if (!trimmed) {
    return {
      originalLatex: "",
      solvedLatex: "",
      displayLatex: "",
      success: false,
      source: "error",
      errorMessage: "Empty expression",
    };
  }

  const ce = getComputeEngine();

  try {
    // 1. Check if expression is an equation to solve (e.g. "2x + 4 = 10" or "x^2 - 9 = 0")
    if (trimmed.includes("=") && !trimmed.endsWith("=")) {
      const parts = trimmed.split("=");
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
        const leftExpr = ce.parse(parts[0].trim());
        const rightExpr = ce.parse(parts[1].trim());

        // Rearrange to LHS - RHS = 0
        const diffExpr = ce.box(["Subtract", leftExpr, rightExpr]);
        const unknowns = diffExpr.unknowns;
        const targetVar = unknowns.length > 0 ? unknowns[0] : "x";

        try {
          const solutions = diffExpr.solve(targetVar) as any;
          if (Array.isArray(solutions) && solutions.length > 0) {
            const solStrings = solutions.map((s: any) =>
              cleanLatexOutput(s?.latex || String(s)),
            );
            const display = `${targetVar} = ${solStrings.join(", ")}`;
            return {
              originalLatex: trimmed,
              solvedLatex: solStrings.join(", "),
              displayLatex: display,
              plainText: `${targetVar} = ${solStrings.join(", ")}`,
              success: true,
              source: "compute-engine",
            };
          }
        } catch {
          // fallback to standard evaluation
        }
      }
    }

    // Strip trailing equals sign if present (e.g. "2 + 2 =")
    const exprLatex = trimmed.endsWith("=")
      ? trimmed.slice(0, -1).trim()
      : trimmed;

    // Check for explicit calculus operators:
    // A. Derivative: \frac{d}{dx} expr or \frac{d}{dx}(expr)
    const diffMatch = exprLatex.match(
      /\\frac\{d\}\{d([a-zA-Z])\}\s*(?:\(([^)]+)\)|\{([^}]+)\}|([a-zA-Z0-9^+\-*/]+))/,
    );
    if (diffMatch) {
      const v = diffMatch[1];
      const target = diffMatch[2] || diffMatch[3] || diffMatch[4];
      try {
        const res = ce.box(["D", ce.parse(target), v]).evaluate();
        const diffLatex = cleanLatexOutput(res.latex);
        if (diffLatex && !diffLatex.includes("\\frac{d}")) {
          return {
            originalLatex: trimmed,
            solvedLatex: diffLatex,
            displayLatex: diffLatex,
            plainText: diffLatex,
            success: true,
            source: "compute-engine",
          };
        }
      } catch {
        // fallback to general engine
      }
    }

    // B. Definite integral: \int_{lower}^{upper} expr dx
    const defIntMatch = exprLatex.match(
      /\\int_\{([^}]+)\}\^\{([^}]+)\}\s*(.+?)\s*d([a-zA-Z])/,
    );
    if (defIntMatch) {
      const lower = defIntMatch[1];
      const upper = defIntMatch[2];
      const integrand = defIntMatch[3];
      const v = defIntMatch[4];
      try {
        const res = ce
          .box([
            "Integrate",
            ce.parse(integrand),
            ["Tuple", v, ce.parse(lower), ce.parse(upper)],
          ])
          .evaluate();
        const intLatex = cleanLatexOutput(res.latex);
        if (intLatex && !intLatex.includes("\\int")) {
          return {
            originalLatex: trimmed,
            solvedLatex: intLatex,
            displayLatex: intLatex,
            plainText: intLatex,
            success: true,
            source: "compute-engine",
          };
        }
      } catch {
        // fallback
      }
    }

    // C. Indefinite integral: \int expr dx
    const indefIntMatch = exprLatex.match(/\\int\s*(.+?)\s*d([a-zA-Z])/);
    if (indefIntMatch) {
      const integrand = indefIntMatch[1];
      const v = indefIntMatch[2];
      try {
        const res = ce.box(["Integrate", ce.parse(integrand), v]).evaluate();
        let intLatex = cleanLatexOutput(res.latex);
        if (intLatex && !intLatex.includes("\\int")) {
          if (!intLatex.includes("C")) {
            intLatex = `${intLatex} + C`;
          }
          return {
            originalLatex: trimmed,
            solvedLatex: intLatex,
            displayLatex: intLatex,
            plainText: intLatex,
            success: true,
            source: "compute-engine",
          };
        }
      } catch {
        // fallback
      }
    }

    // 2. Parse with ComputeEngine
    const parsed = ce.parse(exprLatex);

    // 3. Try simplification first
    const simplified = parsed.simplify();
    let resultLatex = cleanLatexOutput(simplified.latex);

    // 4. Try numerical evaluation if simplification is trivial or numeric
    const evaluated = parsed.evaluate();
    const evaluatedLatex = cleanLatexOutput(evaluated.latex);

    // If evaluated is different and simpler (or evaluated is a clean number), prefer evaluated
    if (
      evaluatedLatex &&
      evaluatedLatex !== resultLatex &&
      !evaluatedLatex.includes("undefined") &&
      !evaluatedLatex.includes("NaN")
    ) {
      // If result was symbolic (e.g. sqrt(4)), prefer evaluated 2
      if (!isNaN(Number(evaluatedLatex))) {
        resultLatex = evaluatedLatex;
      }
    }

    // 5. Check if it's an indefinite integral: append + C if applicable
    if (
      exprLatex.includes("\\int") &&
      !exprLatex.includes("_") &&
      !resultLatex.includes("C")
    ) {
      if (resultLatex && !resultLatex.endsWith("+ C")) {
        resultLatex = `${resultLatex} + C`;
      }
    }

    // If result is empty or identical to unevaluated integral/derivative, try fallback
    if (!resultLatex || resultLatex === exprLatex) {
      const fallback = tryBasicCalculusSolver(exprLatex);
      if (fallback) {
        return {
          originalLatex: trimmed,
          solvedLatex: fallback,
          displayLatex: fallback,
          plainText: fallback,
          success: true,
          source: "arithmetic",
        };
      }
    }

    // Check if ComputeEngine produced an error expression
    if (
      !resultLatex ||
      resultLatex.includes("\\error") ||
      resultLatex.includes("syntax-error")
    ) {
      return {
        originalLatex: trimmed,
        solvedLatex: "",
        displayLatex: "",
        plainText: "",
        success: false,
        source: "error",
        errorMessage: "Could not evaluate expression",
      };
    }

    return {
      originalLatex: trimmed,
      solvedLatex: resultLatex,
      displayLatex: resultLatex,
      plainText: resultLatex,
      success: true,
      source: "compute-engine",
    };
  } catch (err: any) {
    console.warn(
      "[Drawculator] ComputeEngine failed, trying fallback solver:",
      err,
    );

    const fallback = tryBasicCalculusSolver(trimmed);
    if (fallback) {
      return {
        originalLatex: trimmed,
        solvedLatex: fallback,
        displayLatex: fallback,
        plainText: fallback,
        success: true,
        source: "arithmetic",
      };
    }

    return {
      originalLatex: trimmed,
      solvedLatex: "",
      displayLatex: "",
      success: false,
      source: "error",
      errorMessage: err?.message || "Computation error",
    };
  }
}

/**
 * Fast local rule-based solver for standard calculus formulas
 * when symbolic engines encounter syntax variations.
 */
function tryBasicCalculusSolver(latex: string): string | null {
  const clean = latex.replace(/\s+/g, "");

  // Integral of x^n dx -> x^(n+1)/(n+1) + C
  const powerIntMatch = clean.match(/^\\intx\^(\d+)dx$/);
  if (powerIntMatch) {
    const n = parseInt(powerIntMatch[1], 10);
    const newN = n + 1;
    return `\\frac{x^{${newN}}}{${newN}} + C`;
  }

  // Integral of x dx -> x^2 / 2 + C
  if (clean === "\\intxdx") {
    return "\\frac{x^2}{2} + C";
  }

  // Integral of e^x dx -> e^x + C
  if (clean === "\\inte^xdx" || clean === "\\inte^{x}dx") {
    return "e^x + C";
  }

  // Integral of 1/x dx -> \ln|x| + C
  if (clean === "\\int\\frac{1}{x}dx" || clean === "\\int1/xdx") {
    return "\\ln|x| + C";
  }

  // Derivative \frac{d}{dx} x^n -> n x^(n-1)
  const powerDiffMatch = clean.match(/^\\frac\{d\}\{dx\}x\^(\d+)$/);
  if (powerDiffMatch) {
    const n = parseInt(powerDiffMatch[1], 10);
    if (n === 2) {
      return "2x";
    }
    return `${n}x^{${n - 1}}`;
  }

  // Derivative of trig
  if (clean.includes("\\frac{d}{dx}\\sin")) {
    return "\\cos(x)";
  }
  if (clean.includes("\\frac{d}{dx}\\cos")) {
    return "-\\sin(x)";
  }
  if (clean.includes("\\frac{d}{dx}\\tan")) {
    return "\\sec^2(x)";
  }
  if (clean.includes("\\frac{d}{dx}e^x")) {
    return "e^x";
  }
  if (clean.includes("\\frac{d}{dx}\\ln")) {
    return "\\frac{1}{x}";
  }

  // Limits
  if (clean.includes("\\lim") && clean.includes("\\sin(x)/x")) {
    return "1";
  }
  if (clean.includes("\\lim") && clean.includes("\\frac{\\sin(x)}{x}")) {
    return "1";
  }

  // Simple arithmetic evaluation e.g. "3 + 5" or "10 / 2"
  try {
    const sanitized = clean.replace(
      /\\frac\{([^}]+)\}\{([^}]+)\}/g,
      "($1)/($2)",
    );
    if (/^[0-9+\-*/().\s]+$/.test(sanitized)) {
      // Safe arithmetic evaluator
      // eslint-disable-next-line no-new-func
      const val = Function(`'use strict'; return (${sanitized})`)();
      if (typeof val === "number" && !isNaN(val)) {
        return Number.isInteger(val)
          ? val.toString()
          : val.toFixed(4).replace(/\.?0+$/, "");
      }
    }
  } catch {
    // Ignore
  }

  return null;
}
