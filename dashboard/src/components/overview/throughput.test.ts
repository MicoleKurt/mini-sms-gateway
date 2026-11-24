import { describe, expect, it } from "vitest";
import type { ThroughputPoint } from "@/lib/api/schemas";
import {
  linearScale,
  spreadLabels,
  summarizeThroughput,
  timeTicks,
  placeInWindow,
} from "./throughput";

const at = (second: number, submitted = 0, finalized = 0): ThroughputPoint => ({
  t: `2026-11-24T15:55:${String(second).padStart(2, "0")}Z`,
  submitted,
  finalized,
});

describe("summarizeThroughput", () => {
  it("gives the mean, the last sample and the range", () => {
    const summary = summarizeThroughput([at(0, 44, 40), at(1, 48, 38), at(2, 50, 49)], 50);
    expect(summary.seconds).toBe(3);
    expect(summary.submitted).toEqual({ mean: 142 / 3, last: 50, min: 44, max: 50, total: 142 });
    expect(summary.finalized.last).toBe(49);
    expect(summary.secondsAtLimit).toBe(1);
  });

  it("is all zeros without points", () => {
    expect(summarizeThroughput([], 50).submitted).toEqual({
      mean: 0,
      last: 0,
      min: 0,
      max: 0,
      total: 0,
    });
  });
});

describe("linearScale", () => {
  it("maps a domain onto a range, inverted for SVG y", () => {
    const y = linearScale([0, 50], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(0);
    expect(y(25)).toBe(100);
  });
});

describe("placeInWindow", () => {
  it("puts the last point in slot 59 and leaves missing seconds empty", () => {
    expect(placeInWindow([at(0), at(1), at(3)]).map((placed) => placed.slot)).toEqual([56, 57, 59]);
  });

  it("leaves out points older than the window", () => {
    const points = [{ ...at(0), t: "2026-11-24T15:54:58Z" }, at(0), at(59)];
    expect(placeInWindow(points).map((placed) => placed.slot)).toEqual([0, 59]);
  });
});

describe("spreadLabels", () => {
  it("leaves labels that do not touch where they are", () => {
    expect(spreadLabels([10, 50, 90], 14, 0, 100)).toEqual([10, 50, 90]);
  });

  it("pushes close labels apart, in their order", () => {
    expect(spreadLabels([20, 24, 30], 14, 0, 100)).toEqual([20, 34, 48]);
  });

  it("keeps the order of the input, not of the positions", () => {
    expect(spreadLabels([24, 20], 14, 0, 100)).toEqual([34, 20]);
  });

  it("pushes back up when the last label would leave the bottom", () => {
    expect(spreadLabels([90, 96, 98], 14, 0, 100)).toEqual([72, 86, 100]);
  });

  it("holds the top edge when there is no room", () => {
    expect(spreadLabels([0, 2], 14, 4, 10)).toEqual([4, 18]);
  });
});

describe("timeTicks", () => {
  it("labels both ends in full and the quarter minutes between", () => {
    const points = Array.from({ length: 60 }, (_, second) => at(second));
    expect(timeTicks(points)).toEqual([
      { slot: 0, label: "15:55:00", anchor: "start" },
      { slot: 15, label: ":15", anchor: "middle" },
      { slot: 30, label: ":30", anchor: "middle" },
      { slot: 45, label: ":45", anchor: "middle" },
      { slot: 59, label: "15:55:59 UTC", anchor: "end" },
    ]);
  });

  it("drops a middle tick that would crowd an end", () => {
    const points = Array.from({ length: 30 }, (_, second) => at(second + 30));
    expect(timeTicks(points).map((tick) => tick.label)).toEqual([
      "15:55:30",
      ":45",
      "15:55:59 UTC",
    ]);
    const late = Array.from({ length: 20 }, (_, second) => at(second + 40));
    expect(timeTicks(late).map((tick) => tick.label)).toEqual(["15:55:40", "15:55:59 UTC"]);
  });

  it("labels only the latest time when the chart is narrow", () => {
    const points = Array.from({ length: 60 }, (_, second) => at(second));
    expect(timeTicks(points, 24).map((tick) => tick.label)).toEqual(["15:55:59 UTC"]);
  });

  it("has nothing without points", () => {
    expect(timeTicks([])).toEqual([]);
  });
});
