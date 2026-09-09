import { describe, expect, it } from "vitest";
import { splitTargetHours } from "../splitTargetHours";

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

describe("splitTargetHours – Vollzeit", () => {
  it("summiert immer exakt auf das Ziel", () => {
    for (let h = 3; h <= 200; h++) {
      const parts = splitTargetHours(h, "VOLLZEIT");
      expect(sum(parts)).toBe(h);
      for (const p of parts) expect(p).toBeGreaterThanOrEqual(3);
      for (const p of parts) expect(p).toBeLessThanOrEqual(6);
    }
  });

  it("bevorzugt kurze Dienste (max 6 h) mit möglichst wenigen Diensten", () => {
    // 90 = 15×6
    expect(splitTargetHours(90, "VOLLZEIT")).toEqual([...Array(15).fill(6)]);
    // Jedes Ziel wird mit der kleinstmöglichen Schichtzahl abgedeckt:
    // aufgerundet targetHours/6 Dienste.
    for (const h of [115, 120, 128, 90]) {
      const parts = splitTargetHours(h, "VOLLZEIT");
      expect(sum(parts)).toBe(h);
      expect(parts.length).toBe(Math.ceil(h / 6));
      expect(Math.max(...parts)).toBeLessThanOrEqual(6);
    }
  });
});

describe("splitTargetHours – Teilzeit", () => {
  it("summiert exakt und vermeidet 7/8-h-Schichten wo möglich", () => {
    for (const h of [40, 55, 79, 80]) {
      const parts = splitTargetHours(h, "TEILZEIT");
      expect(sum(parts)).toBe(h);
      // keine 7/8-h-Schichten bei diesen Zielen
      expect(parts.every((p) => p <= 6)).toBe(true);
    }
  });

  it("55 = 11×5, 80 = 16×5, 79 = 11×5 + 4×6", () => {
    expect(splitTargetHours(55, "TEILZEIT")).toEqual(Array(11).fill(5));
    expect(splitTargetHours(80, "TEILZEIT")).toEqual(Array(16).fill(5));
    // 79: wenige Dienste sind billiger (Basiskosten je Dienst) => 11×5 + 4×6.
    const s79 = splitTargetHours(79, "TEILZEIT").slice().sort((a, b) => a - b);
    expect(s79).toEqual([...Array(11).fill(5), ...Array(4).fill(6)].sort((a, b) => a - b));
  });
});

describe("splitTargetHours – Fehlerfälle", () => {
  it("wirft bei nicht darstellbaren Zielen (1 und 2 h)", () => {
    expect(() => splitTargetHours(1, "VOLLZEIT")).toThrow();
    expect(() => splitTargetHours(2, "TEILZEIT")).toThrow();
    // 3 h ist jetzt darstellbar (eine 3-h-Schicht).
    expect(splitTargetHours(3, "TEILZEIT")).toEqual([3]);
  });
  it("0 => leere Liste", () => {
    expect(splitTargetHours(0, "VOLLZEIT")).toEqual([]);
  });
});
