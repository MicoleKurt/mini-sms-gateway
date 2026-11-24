"use client";

import { useState } from "react";
import { useLiveEvent } from "@/lib/live/live-provider";
import { pushSample, type DepthSample } from "./queue-trend";

/**
 * The queue depth of the last minute, one sample per "stats" event, kept in
 * the browser only while the Overview is open. The gateway has no history of
 * its queue, so the trend starts when the page does.
 */
export function useQueueTrend(): DepthSample[] {
  const [samples, setSamples] = useState<DepthSample[]>([]);
  useLiveEvent("stats", (stats) => {
    setSamples((held) => pushSample(held, { at: Date.parse(stats.at), depth: stats.queue.depth }));
  });
  return samples;
}
