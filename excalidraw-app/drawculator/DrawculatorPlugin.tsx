import React, { useEffect, useRef, useState, useCallback } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  normalizeElement,
  detectEqualsSign,
  clusterStrokesIntoSymbols,
  findElementsLeft,
} from "./strokeGrouping";
import { initOnnxModel, parseExpressionToLatex } from "./recognizer";
import { solveMathExpression } from "./solver";
import { insertResultOnCanvas } from "./resultRenderer";
import { ConfidenceOverlay } from "./ConfidenceOverlay";

import "./drawculator.scss";

import type { StrokeSymbol, RecognitionResult } from "./types";

interface DrawculatorPluginProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  theme?: "light" | "dark";
}

export const DrawculatorPlugin: React.FC<DrawculatorPluginProps> = ({
  excalidrawAPI,
  theme = "light",
}) => {
  const [enabled, setEnabled] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [renderMode] = useState<"svg" | "text">("svg");
  const [autoSolveThreshold] = useState(0.78);

  // Correction overlay state
  const [pendingOverlay, setPendingOverlay] = useState<{
    recognition: RecognitionResult;
    equalsSymbol: StrokeSymbol;
    viewportPos: { x: number; y: number };
  } | null>(null);

  // Track processed equals stroke IDs to avoid re-triggering loops
  const processedEqualsIdsRef = useRef<Set<string>>(new Set());

  // Initialize ONNX model lazily
  useEffect(() => {
    initOnnxModel();
  }, []);

  // Convert scene coordinates to viewport pixel coordinates
  const sceneToViewport = useCallback(
    (sceneX: number, sceneY: number) => {
      if (!excalidrawAPI) {
        return { x: 200, y: 200 };
      }
      const appState = excalidrawAPI.getAppState();
      const zoom = appState.zoom.value;
      const x = (sceneX + appState.scrollX) * zoom + appState.offsetLeft;
      const y = (sceneY + appState.scrollY) * zoom + appState.offsetTop;
      return { x, y };
    },
    [excalidrawAPI],
  );

  // Solve and place result on canvas
  const handleSolveAndPlace = useCallback(
    async (
      latex: string,
      equalsSymbol: StrokeSymbol,
      expressionSymbols: StrokeSymbol[],
      showToastOnError = false,
    ): Promise<boolean> => {
      if (!excalidrawAPI) {
        return false;
      }
      setIsProcessing(true);

      try {
        const solved = await solveMathExpression(latex);
        if (solved.success) {
          await insertResultOnCanvas({
            api: excalidrawAPI,
            equalsSymbol,
            solvedLatex: solved.solvedLatex,
            displayLatex: solved.displayLatex,
            renderMode,
            theme,
          });

          // Mark elements as solved
          equalsSymbol.done = true;
          processedEqualsIdsRef.current.add(equalsSymbol.id);
          if (equalsSymbol.elementIds) {
            equalsSymbol.elementIds.forEach((id) =>
              processedEqualsIdsRef.current.add(id),
            );
          }
          expressionSymbols.forEach((s) => {
            s.done = true;
            if (s.elementIds) {
              s.elementIds.forEach((id) =>
                processedEqualsIdsRef.current.add(id),
              );
            }
          });
          setPendingOverlay(null);
          return true;
        }

        if (showToastOnError) {
          excalidrawAPI.setToast({
            message: `Could not solve: ${latex} (${
              solved.errorMessage || "unsupported"
            })`,
            closable: true,
            duration: 4000,
          });
        }
        return false;
      } catch (err: any) {
        console.error("[Drawculator] Solve error:", err);
        if (showToastOnError) {
          excalidrawAPI.setToast({
            message: `Error solving math: ${err?.message || "Unknown error"}`,
            closable: true,
            duration: 3500,
          });
        }
        return false;
      } finally {
        setIsProcessing(false);
      }
    },
    [excalidrawAPI, renderMode, theme],
  );

  // Core evaluator: inspects scene strokes and detects math expressions ending in '='
  const handleEvaluate = useCallback(async () => {
    if (!enabled || !excalidrawAPI || isProcessing) {
      return;
    }

    const elements = excalidrawAPI.getSceneElements();
    const freedrawElements = elements.filter(
      (el) => el.type === "freedraw" && !el.isDeleted,
    );

    if (freedrawElements.length === 0) {
      return;
    }

    const rawSymbols = freedrawElements.map((el) =>
      normalizeElement(el as any),
    );

    // 1. Detect if an equals sign is present
    const equalsSymbol = detectEqualsSign(
      rawSymbols,
      processedEqualsIdsRef.current,
    );
    if (!equalsSymbol) {
      return;
    }

    // Immediately register this equals symbol so it is never evaluated twice
    processedEqualsIdsRef.current.add(equalsSymbol.id);
    if (equalsSymbol.elementIds) {
      equalsSymbol.elementIds.forEach((id) =>
        processedEqualsIdsRef.current.add(id),
      );
    }

    // 2. Collect expression strokes to the left of the equals sign
    const eqElementIds = new Set(equalsSymbol.elementIds || [equalsSymbol.id]);
    const remainingStrokes = rawSymbols.filter(
      (s) =>
        !eqElementIds.has(s.id) &&
        !processedEqualsIdsRef.current.has(s.id) &&
        !s.done,
    );

    // Cluster multiple strokes of the same character (e.g. '+', 'x', '4')
    const clusteredSymbols = clusterStrokesIntoSymbols(remainingStrokes);

    const leftSymbols = findElementsLeft({
      elements: clusteredSymbols,
      equalsSymbol,
    });

    if (leftSymbols.length === 0) {
      // Equals sign drawn without left-hand expression yet
      return;
    }

    setIsProcessing(true);
    try {
      const session = await initOnnxModel();
      const recognition = await parseExpressionToLatex(leftSymbols, session);

      if (!recognition.latex || recognition.latex.trim() === "") {
        setIsProcessing(false);
        return;
      }

      const viewportPos = sceneToViewport(
        equalsSymbol.bounds.maxX + 35,
        equalsSymbol.bounds.minY - 50,
      );

      // Auto-solve if confidence is high, otherwise pop up correction overlay
      let autoSolved = false;
      if (recognition.confidence >= autoSolveThreshold) {
        autoSolved = await handleSolveAndPlace(
          recognition.latex,
          equalsSymbol,
          leftSymbols,
          false,
        );
      }

      if (!autoSolved) {
        setPendingOverlay({
          recognition,
          equalsSymbol,
          viewportPos,
        });
      }
    } catch (err) {
      console.error("[Drawculator] Error in recognition pipeline:", err);
    } finally {
      setIsProcessing(false);
    }
  }, [
    enabled,
    excalidrawAPI,
    isProcessing,
    autoSolveThreshold,
    sceneToViewport,
    handleSolveAndPlace,
  ]);

  // Hook into onPointerUp for responsive stroke handling
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    let pointerTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubPointer = excalidrawAPI.onPointerUp(() => {
      if (pointerTimer) {
        clearTimeout(pointerTimer);
      }
      pointerTimer = setTimeout(handleEvaluate, 100);
    });

    return () => {
      unsubPointer();
      if (pointerTimer) {
        clearTimeout(pointerTimer);
      }
    };
  }, [excalidrawAPI, handleEvaluate]);

  return (
    <>
      {/* Floating Status Pill in Top UI */}
      <div
        className={`drawculator-toolbar-pill ${enabled ? "active" : ""} ${
          isProcessing ? "processing" : ""
        }`}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
        }}
        onClick={() => setEnabled((prev) => !prev)}
        title={
          enabled
            ? "Math Solver Active (Draw '=' to solve). Click to pause."
            : "Math Solver Paused. Click to enable."
        }
      >
        <span className="drawculator-badge-dot" />
        <span>
          {isProcessing
            ? "Solving Math..."
            : enabled
            ? "Math Solver: Active (=)"
            : "Math Solver: Off"}
        </span>
      </div>

      {/* Confidence & Correction Overlay */}
      {pendingOverlay && (
        <ConfidenceOverlay
          initialLatex={pendingOverlay.recognition.latex}
          confidence={pendingOverlay.recognition.confidence}
          position={pendingOverlay.viewportPos}
          theme={theme}
          onConfirm={(correctedLatex) => {
            handleSolveAndPlace(
              correctedLatex,
              pendingOverlay.equalsSymbol,
              pendingOverlay.recognition.symbols,
              true,
            );
          }}
          onCancel={() => {
            processedEqualsIdsRef.current.add(pendingOverlay.equalsSymbol.id);
            if (pendingOverlay.equalsSymbol.elementIds) {
              pendingOverlay.equalsSymbol.elementIds.forEach((id) =>
                processedEqualsIdsRef.current.add(id),
              );
            }
            setPendingOverlay(null);
          }}
        />
      )}
    </>
  );
};
