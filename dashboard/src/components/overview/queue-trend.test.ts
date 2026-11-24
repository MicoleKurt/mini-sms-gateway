import { describe, expect, it } from "vitest";
import { depthChange, pushSample, type DepthSample } from "./queue-trend";

const sample = (second: number, depth: number): DepthSample => ({ at: second * 1_000, depth });

describe("pushSample", () => {
  it("keeps at most the capacity, dropping the oldest", () => {
    let samples: DepthSample[] = [];
    for (let second = 0; second < 5; second++)
      samples = pushSample(samples, sample(second, second), 3);
    expect(samples.map((s) => s.depth)).toEqual([2, 3, 4]);
  });

  it("replaces a sample of the same second", () => {
    const samples = pushSample([sample(1, 10)], { at: 1_400, depth: 12 });
    expect(samples).toEqual([{ at: 1_400, depth: 12 }]);
  });

  it("ignores a sample older than the newest", () => {
    expect(pushSample([sample(5, 10)], sample(4, 99))).toEqual([sample(5, 10)]);
  });
});

describe("depthChange", () => {
  it("is the difference between the newest and the oldest sample", () => {
    const minute = Array.from({ length: 60 }, (_, second) => sample(second, 6_468 - second * 22));
    expect(depthChange(minute)).toEqual({ change: -1_298, seconds: 59 });
  });

  it("needs ten samples before it is a trend", () => {
    expect(depthChange([])).toBeNull();
    const nine = Array.from({ length: 9 }, (_, second) => sample(second, 100));
    expect(depthChange(nine)).toBeNull();
    expect(depthChange([...nine, sample(9, 80)])).toEqual({ change: -20, seconds: 9 });
  });
});
