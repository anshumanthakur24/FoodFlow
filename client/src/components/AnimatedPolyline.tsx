"use client";

import { useEffect, useRef } from "react";
import { Polyline } from "react-leaflet";
import L from "leaflet";

interface AnimatedPolylineProps {
  positions: [number, number][];
  color?: string;
  weight?: number;
  opacity?: number;
  dashArray?: string;
  animated?: boolean;
}

export default function AnimatedPolyline({
  positions,
  color = "#3b82f6",
  weight = 4,
  opacity = 0.7,
  dashArray = "10, 10",
  animated = true,
}: AnimatedPolylineProps) {
  const polylineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    const polyline = polylineRef.current;
    if (!polyline) return;

    let rafId: number | null = null;
    let cancelled = false;

    if (!animated) {
      polyline.setStyle({ dashArray });
      return;
    }

    let offset = 0;
    const tick = () => {
      if (cancelled) return;
      offset = (offset + 0.5) % 20;
      const newDashArray = `${10 + offset}, ${10 - offset}`;
      polyline.setStyle({ dashArray: newDashArray });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [animated, dashArray]);

  return (
    <Polyline
      ref={(ref) => {
        if (ref) polylineRef.current = ref;
      }}
      positions={positions}
      pathOptions={{
        color,
        weight,
        opacity,
        dashArray: animated ? "10, 10" : dashArray,
      }}
    />
  );
}
