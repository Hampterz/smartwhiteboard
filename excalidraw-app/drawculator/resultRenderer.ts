import katex from "katex";

import { newImageElement, newTextElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import type { StrokeSymbol } from "./types";

/**
 * Renders LaTeX into an SVG Data URL using KaTeX
 */
export function renderLatexToSvgDataUrl(
  latex: string,
  fontSize = 24,
  textColor = "#1e1e1e",
): { dataUrl: string; width: number; height: number } {
  const html = katex.renderToString(latex, {
    displayMode: false,
    throwOnError: false,
    output: "html",
  });

  // Calculate approximate bounds based on latex length and font size
  const approxChars = Math.max(3, latex.replace(/\\[a-zA-Z]+/g, "X").length);
  const width = Math.max(
    60,
    Math.min(600, approxChars * (fontSize * 0.75) + 30),
  );
  const height = Math.max(40, fontSize * 2.2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
      .katex-mathml { display: none !important; }
      .katex { font-size: ${fontSize}px; color: ${textColor}; line-height: 1.2; font-family: KaTeX_Main, 'Times New Roman', serif; }
      .katex-html { display: inline-block; white-space: nowrap; }
    </style>
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;height:100%;padding:4px 8px;">
        ${html}
      </div>
    </foreignObject>
  </svg>`;

  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return { dataUrl, width, height };
}

/**
 * Inserts the solved mathematical result next to the equals sign on the Excalidraw canvas
 */
export async function insertResultOnCanvas({
  api,
  equalsSymbol,
  solvedLatex,
  displayLatex,
  renderMode = "svg",
  theme = "light",
}: {
  api: ExcalidrawImperativeAPI;
  equalsSymbol: StrokeSymbol;
  solvedLatex: string;
  displayLatex: string;
  renderMode?: "svg" | "text";
  theme?: "light" | "dark";
}): Promise<ExcalidrawElement> {
  const eqBounds = equalsSymbol.bounds;
  const eqWidth = eqBounds.maxX - eqBounds.minX;
  const eqHeight = eqBounds.maxY - eqBounds.minY;
  const eqMidY = (eqBounds.minY + eqBounds.maxY) / 2;

  // Position immediately to the right of the equals sign with appropriate spacing
  const gap = Math.max(16, eqWidth * 0.4);
  const targetX = eqBounds.maxX + gap;

  const textColor = theme === "dark" ? "#f1f3f5" : "#1e1e1e";
  const fontSize = Math.max(20, Math.min(48, eqHeight * 1.3));

  if (renderMode === "svg") {
    try {
      const { dataUrl, width, height } = renderLatexToSvgDataUrl(
        displayLatex || solvedLatex,
        fontSize,
        textColor,
      );

      const fileId = `math_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 7)}` as FileId;

      // Add image file to Excalidraw's file store
      api.addFiles([
        {
          id: fileId,
          dataURL: dataUrl as any,
          mimeType: "image/svg+xml",
          created: Date.now(),
        },
      ]);

      const targetY = eqMidY - height / 2;

      const imageElement = newImageElement({
        type: "image",
        fileId,
        x: targetX,
        y: targetY,
        width,
        height,
        status: "saved",
      });

      const currentElements = api.getSceneElements();
      api.updateScene({
        elements: [...currentElements, imageElement],
      });

      return imageElement;
    } catch (err) {
      console.warn(
        "[Drawculator] SVG rendering failed, falling back to text:",
        err,
      );
    }
  }

  // Fallback to native Excalidraw Text Element
  // Clean up LaTeX markup into readable plain text / unicode math for text element
  const plainText = (displayLatex || solvedLatex)
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
    .replace(/\\int/g, "∫")
    .replace(/\\sum/g, "∑")
    .replace(/\\lim/g, "lim")
    .replace(/\\pi/g, "π")
    .replace(/\\theta/g, "θ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\infty/g, "∞")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "");

  const targetY = eqMidY - fontSize * 0.6;

  const textElement = newTextElement({
    text: plainText,
    x: targetX,
    y: targetY,
    fontSize,
    strokeColor: textColor,
  });

  const currentElements = api.getSceneElements();
  api.updateScene({
    elements: [...currentElements, textElement],
  });

  return textElement;
}
