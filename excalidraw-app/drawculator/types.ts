export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface StrokeSymbol {
  id: string;
  bounds: BoundingBox;
  points?: Point[];
  children?: StrokeSymbol[];
  elementIds?: string[];
  prediction?: string;
  confidence?: number;
  done?: boolean;
}

export interface RecognitionResult {
  latex: string;
  confidence: number;
  symbols: StrokeSymbol[];
  bounds: BoundingBox;
  equalsSymbol?: StrokeSymbol;
}

export interface SolvedResult {
  originalLatex: string;
  solvedLatex: string;
  displayLatex: string;
  plainText?: string;
  success: boolean;
  source: "compute-engine" | "sympy" | "arithmetic" | "error";
  errorMessage?: string;
}

export interface DrawculatorConfig {
  enabled: boolean;
  autoSolve: boolean;
  autoSolveThreshold: number; // 0.0 - 1.0 (default 0.8)
  showPreview: boolean;
  renderMode: "svg" | "text";
  fontSize: number;
  textColor: string;
}
