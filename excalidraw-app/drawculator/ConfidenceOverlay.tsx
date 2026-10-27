import React, { useState, useEffect, useRef } from "react";
import katex from "katex";

interface ConfidenceOverlayProps {
  initialLatex: string;
  confidence: number;
  position: { x: number; y: number };
  onConfirm: (correctedLatex: string) => void;
  onCancel: () => void;
  theme?: "light" | "dark";
}

const QUICK_SYMBOLS = [
  { label: "+", insert: " + " },
  { label: "−", insert: " - " },
  { label: "×", insert: " \\times " },
  { label: "÷", insert: " \\div " },
  { label: "a/b", insert: "\\frac{1}{2}" },
  { label: "x²", insert: "^2" },
  { label: "√x", insert: "\\sqrt{x}" },
  { label: "∫ dx", insert: "\\int x dx" },
  { label: "∫ₐᵇ", insert: "\\int_{0}^{1} x dx" },
  { label: "d/dx", insert: "\\frac{d}{dx}" },
  { label: "lim", insert: "\\lim_{x \\to 0} " },
  { label: "π", insert: "\\pi" },
  { label: "θ", insert: "\\theta" },
  { label: "sin", insert: "\\sin(x)" },
  { label: "cos", insert: "\\cos(x)" },
  { label: "ln", insert: "\\ln(x)" },
];

export const ConfidenceOverlay: React.FC<ConfidenceOverlayProps> = ({
  initialLatex,
  confidence,
  position,
  onConfirm,
  onCancel,
  theme = "light",
}) => {
  const [latexInput, setLatexInput] = useState(initialLatex);
  const [previewHtml, setPreviewHtml] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLatexInput(initialLatex);
  }, [initialLatex]);

  // Update KaTeX preview on input change
  useEffect(() => {
    try {
      const html = katex.renderToString(latexInput || "\\dots", {
        displayMode: true,
        throwOnError: false,
      });
      setPreviewHtml(html);
    } catch {
      setPreviewHtml("<em>Invalid LaTeX syntax</em>");
    }
  }, [latexInput]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleInsertSymbol = (sym: string) => {
    if (!inputRef.current) {
      setLatexInput((prev) => prev + sym);
      return;
    }
    const start = inputRef.current.selectionStart || latexInput.length;
    const end = inputRef.current.selectionEnd || latexInput.length;
    const next =
      latexInput.substring(0, start) + sym + latexInput.substring(end);
    setLatexInput(next);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(
        start + sym.length,
        start + sym.length,
      );
    }, 10);
  };

  const confidencePct = Math.round(confidence * 100);
  const isLowConfidence = confidence < 0.8;

  return (
    <div
      className={`drawculator-overlay ${theme}`}
      style={{
        left: Math.max(20, Math.min(window.innerWidth - 440, position.x)),
        top: Math.max(70, Math.min(window.innerHeight - 380, position.y)),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="drawculator-overlay-header">
        <div className="drawculator-overlay-title">
          <span className="drawculator-magic-icon">✨</span>
          <span>Math Recognition</span>
        </div>
        <div
          className={`drawculator-confidence-tag ${
            isLowConfidence ? "low" : "high"
          }`}
        >
          {confidencePct}% Confidence
        </div>
      </div>

      <div className="drawculator-preview-box">
        <div
          className="drawculator-katex-render"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>

      <div className="drawculator-input-group">
        <label htmlFor="drawculator-latex-input">Edit LaTeX Formula:</label>
        <input
          id="drawculator-latex-input"
          ref={inputRef}
          type="text"
          value={latexInput}
          onChange={(e) => setLatexInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onConfirm(latexInput);
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder="e.g. \int x^2 dx or 2x + 5 = 15"
        />
      </div>

      <div className="drawculator-quick-symbols">
        {QUICK_SYMBOLS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="drawculator-sym-btn"
            onClick={() => handleInsertSymbol(s.insert)}
            title={`Insert ${s.insert}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="drawculator-actions">
        <button
          type="button"
          className="drawculator-btn-cancel"
          onClick={onCancel}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="drawculator-btn-solve"
          onClick={() => onConfirm(latexInput)}
        >
          Solve &amp; Place Result
        </button>
      </div>
    </div>
  );
};
