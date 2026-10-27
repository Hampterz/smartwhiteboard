import path from "path";
import * as ort from "onnxruntime-web";
import { symbolToTensor } from "../excalidraw-app/drawculator/rasterizer";

const CNN_LABELS = {
  0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "+", 11: ")", 12: ".", 13: "/", 14: "=", 15: "*", 16: "(", 17: "-",
  18: "x", 19: "y", 20: "z",
};

async function run() {
  const modelPath = path.resolve("./excalidraw-app/public/models/cnn_single.onnx");
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["wasm"],
  });

  // Test: Digit '2' stroke points from top arch down to base
  // A curved top, smooth curve down, flat base
  const pts2 = [];
  // Top curve
  pts2.push({ x: 30, y: 35 });
  pts2.push({ x: 40, y: 25 });
  pts2.push({ x: 55, y: 25 });
  pts2.push({ x: 65, y: 35 });
  pts2.push({ x: 65, y: 45 });
  pts2.push({ x: 55, y: 60 });
  pts2.push({ x: 40, y: 75 });
  pts2.push({ x: 30, y: 90 });
  // Base
  pts2.push({ x: 35, y: 90 });
  pts2.push({ x: 50, y: 90 });
  pts2.push({ x: 65, y: 90 });
  pts2.push({ x: 75, y: 90 });

  const symbol2 = {
    id: "s2",
    bounds: { minX: 30, minY: 25, maxX: 75, maxY: 90 },
    points: pts2,
  };

  const tensor2 = symbolToTensor(symbol2);
  const input2 = new ort.Tensor("float32", tensor2, [1, 1, 32, 32]);
  const res2 = await session.run({ input: input2 });
  const out2 = Array.from(res2.output.data);
  const sorted = out2.map((val, idx) => ({ label: CNN_LABELS[idx], val, idx })).sort((a, b) => b.val - a.val);
  console.log("Top 5 for '2':", sorted.slice(0, 5));
}

run();
