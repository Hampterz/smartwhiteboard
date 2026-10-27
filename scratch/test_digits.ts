import path from "path";
import * as ort from "onnxruntime-web";
import { symbolToTensor } from "../excalidraw-app/drawculator/rasterizer";

const CNN_LABELS = {
  0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "+", 11: ")", 12: ".", 13: "/", 14: "=", 15: "*", 16: "(", 17: "-",
  18: "x", 19: "y", 20: "z",
};

async function test() {
  const modelPath = path.resolve("./public/models/cnn_single.onnx");
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["wasm"],
  });

  // Test 1: Digit '3'
  // Top curve, middle cusp, bottom curve
  const pts3 = [];
  // Top arc
  for (let t = -Math.PI / 2; t <= Math.PI / 2; t += 0.1) {
    pts3.push({ x: 50 + 20 * Math.cos(t), y: 35 + 15 * Math.sin(t) });
  }
  // Bottom arc
  for (let t = -Math.PI / 2; t <= Math.PI / 2; t += 0.1) {
    pts3.push({ x: 50 + 22 * Math.cos(t), y: 65 + 18 * Math.sin(t) });
  }

  const symbol3 = {
    id: "s3",
    bounds: { minX: 45, minY: 20, maxX: 75, maxY: 85 },
    points: pts3,
  };

  const tensor3 = symbolToTensor(symbol3);
  const input3 = new ort.Tensor("float32", tensor3, [1, 1, 32, 32]);
  const res3 = await session.run({ input: input3 });
  const out3 = Array.from(res3.output.data);
  const sorted3 = out3.map((val, idx) => ({ label: CNN_LABELS[idx], val, idx })).sort((a, b) => b.val - a.val);
  console.log("Top 5 for '3':", sorted3.slice(0, 5));
}

test();
