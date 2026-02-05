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

    // Prefer a CSS-based SVG dash animation (much cheaper than per-frame JS updates).
    // Leaflet renders polylines as SVG paths; getElement() returns that path.
    let el: SVGPathElement | null = null;
    let raf: number | null = null;

    const apply = () => {
      const element = polyline.getElement() as SVGPathElement | null;
      if (!element) return;
      el = element;

      if (!animated) {
        el.classList.remove("leaflet-animated-dash");
        el.style.removeProperty("animation");
        el.style.strokeDasharray = dashArray;
        el.style.strokeDashoffset = "0";
        return;
      }

      el.style.strokeDasharray = dashArray;
      el.classList.add("leaflet-animated-dash");
    };

    raf = requestAnimationFrame(apply);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      if (el) {
        el.classList.remove("leaflet-animated-dash");
        el.style.removeProperty("animation");
        el.style.removeProperty("stroke-dasharray");
        el.style.removeProperty("stroke-dashoffset");
      }
    };
  }, [animated, dashArray]);

  return (
    <>
      <Polyline
        ref={(ref) => {
          if (ref) polylineRef.current = ref;
        }}
        positions={positions}
        pathOptions={{
          color,
          weight,
          opacity,
          dashArray,
        }}
      />
      <style jsx global>{`
        @keyframes leafletDashOffset {
          to {
            stroke-dashoffset: -40;
          }
        }

        .leaflet-animated-dash {
          animation: leafletDashOffset 1.2s linear infinite;
        }
      `}</style>
    </>
  );
}
