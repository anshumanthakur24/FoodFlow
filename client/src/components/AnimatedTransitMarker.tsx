"use client";

import { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";

interface AnimatedTransitMarkerProps {
  startPos: [number, number];
  endPos: [number, number];
  startTime: Date;
  endTime: Date;
  currentTime: Date;
  foodItem: string;
  shipmentId: string;
  animate?: boolean;
  sizePx?: number;
}

export default function AnimatedTransitMarker({
  startPos,
  endPos,
  startTime,
  endTime,
  currentTime,
  foodItem,
  shipmentId,
  animate = true,
  sizePx = 40,
}: AnimatedTransitMarkerProps) {
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const currentMs = currentTime.getTime();

  const isInTransit =
    endMs > startMs && currentMs >= startMs && currentMs < endMs;

  const currentPos = useMemo<[number, number]>(() => {
    if (currentMs < startMs) return startPos;
    if (currentMs >= endMs) return endPos;
    if (endMs <= startMs) return endPos;

    const clampedProgress = Math.min(
      1,
      Math.max(0, (currentMs - startMs) / (endMs - startMs)),
    );
    const lat = startPos[0] + (endPos[0] - startPos[0]) * clampedProgress;
    const lng = startPos[1] + (endPos[1] - startPos[1]) * clampedProgress;
    return [lat, lng];
  }, [currentMs, endMs, endPos, startMs, startPos]);

  const progress = useMemo(() => {
    if (endMs <= startMs) return 100;
    return Math.round(
      Math.min(1, Math.max(0, (currentMs - startMs) / (endMs - startMs))) * 100,
    );
  }, [currentMs, endMs, startMs]);

  const icon = useMemo(() => {
    const rotation =
      Math.atan2(endPos[0] - startPos[0], endPos[1] - startPos[1]) *
      (180 / Math.PI);

    const gradientId = `truckGradient-${shipmentId.replace(/[^a-zA-Z0-9]/g, "")}`;

    const svgSize = Math.max(24, Math.min(48, sizePx));
    const bounceStyle = animate
      ? "animation: bounce 2s ease-in-out infinite;"
      : "";
    const bounceCss = animate
      ? `
        <style>
          @keyframes bounce {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-3px); }
          }
        </style>
      `
      : "";

    return L.divIcon({
      className: "animated-truck-marker",
      html: `
        <div style="
          position: relative;
          transform: rotate(${rotation}deg);
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));
        ">
          <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 40 40" style="
            ${bounceStyle}
          ">
            <defs>
              <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#f59e0b;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#d97706;stop-opacity:1" />
              </linearGradient>
            </defs>

            <rect x="8" y="16" width="20" height="12" rx="2" fill="url(#${gradientId})" stroke="white" stroke-width="2"/>
            <rect x="28" y="18" width="6" height="8" rx="1" fill="url(#${gradientId})" stroke="white" stroke-width="2"/>

            <rect x="29" y="19.5" width="4" height="3" rx="0.5" fill="#87ceeb" opacity="0.8"/>
            <rect x="10" y="18" width="5" height="4" rx="0.5" fill="#87ceeb" opacity="0.6"/>

            <circle cx="12" cy="30" r="4" fill="#1f2937" stroke="white" stroke-width="1.5"/>
            <circle cx="12" cy="30" r="2.5" fill="#4b5563"/>
            <circle cx="28" cy="30" r="4" fill="#1f2937" stroke="white" stroke-width="1.5"/>
            <circle cx="28" cy="30" r="2.5" fill="#4b5563"/>

            <circle cx="13" cy="29" r="1" fill="#9ca3af" opacity="0.6"/>
            <circle cx="29" cy="29" r="1" fill="#9ca3af" opacity="0.6"/>

            <line x1="4" y1="20" x2="8" y2="20" stroke="#f59e0b" stroke-width="2" opacity="0.6" stroke-dasharray="2,2"/>
            <line x1="4" y1="24" x2="8" y2="24" stroke="#f59e0b" stroke-width="2" opacity="0.6" stroke-dasharray="2,2"/>
          </svg>
        </div>
        ${bounceCss}
      `,
      iconSize: [svgSize, svgSize],
      iconAnchor: [svgSize / 2, svgSize / 2],
      popupAnchor: [0, -svgSize / 2],
    });
  }, [animate, endPos, sizePx, startPos, shipmentId]);

  if (!isInTransit) return null;

  return (
    <Marker position={currentPos} icon={icon}>
      <Popup>
        <div className="p-3 min-w-[220px]">
          <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
            <span className="text-xl">🚚</span>
            <span>In Transit</span>
          </h3>
          <div className="space-y-2">
            <div>
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Shipment:</span>{" "}
                <span className="font-mono text-gray-800">{shipmentId}</span>
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-700">
                <span className="font-semibold">Food Item:</span>{" "}
                <span className="text-gray-800">{foodItem}</span>
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-700">
                  Progress:
                </span>
                <span className="text-sm font-bold text-orange-600">
                  {progress}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-gradient-to-r from-orange-400 to-orange-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-2 pt-2 border-t">
              <p>
                ETA:{" "}
                {endTime.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
