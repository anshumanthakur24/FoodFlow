'use client';

import { useEffect, useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

interface AnimatedTransitMarkerProps {
  startPos: [number, number];
  endPos: [number, number];
  startTime: Date;
  endTime: Date;
  currentTime: Date;
  foodItem: string;
  shipmentId: string;
}

export default function AnimatedTransitMarker({
  startPos,
  endPos,
  startTime,
  endTime,
  currentTime,
  foodItem,
  shipmentId,
}: AnimatedTransitMarkerProps) {
  const [currentPos, setCurrentPos] = useState<[number, number]>(startPos);

  useEffect(() => {
    const start = startTime.getTime();
    const end = endTime.getTime();
    const current = currentTime.getTime();

    if (current < start) {
      setCurrentPos(startPos);
      return;
    }

    if (current >= end) {
      setCurrentPos(endPos);
      return;
    }

    // Calculate progress (0 to 1)
    const progress = (current - start) / (end - start);

    // Interpolate position
    const lat = startPos[0] + (endPos[0] - startPos[0]) * progress;
    const lng = startPos[1] + (endPos[1] - startPos[1]) * progress;

    setCurrentPos([lat, lng]);
  }, [startPos, endPos, startTime, endTime, currentTime]);

  // Don't render if shipment hasn't started or has completed
  if (currentTime < startTime || currentTime >= endTime) {
    return null;
  }

  // Create animated truck icon
  const createTruckIcon = () => {
    return L.divIcon({
      className: 'animated-truck-marker',
      html: `
        <div style="
          position: relative;
          transform: rotate(${Math.atan2(
            endPos[0] - startPos[0],
            endPos[1] - startPos[1]
          ) * (180 / Math.PI)}deg);
        ">
          <svg width="32" height="32" viewBox="0 0 32 32">
            <path d="M8 20 L16 20 L16 16 L24 16 L24 20 L28 20 L28 24 L24 24 L24 28 L20 28 L20 24 L12 24 L12 28 L8 28 L8 24 L4 24 L4 20 Z" 
                  fill="#f59e0b" stroke="white" stroke-width="2"/>
            <circle cx="10" cy="26" r="3" fill="#333"/>
            <circle cx="22" cy="26" r="3" fill="#333"/>
          </svg>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  return (
    <Marker position={currentPos} icon={createTruckIcon()}>
      <Popup>
        <div className="p-2">
          <h3 className="font-semibold text-lg mb-1">🚚 In Transit</h3>
          <p className="text-sm text-gray-600 mb-1">
            <span className="font-medium">Shipment:</span> {shipmentId}
          </p>
          <p className="text-sm text-gray-600 mb-1">
            <span className="font-medium">Food:</span> {foodItem}
          </p>
          <p className="text-sm text-gray-600 mb-1">
            <span className="font-medium">Progress:</span>{' '}
            {Math.round(
              ((currentTime.getTime() - startTime.getTime()) /
                (endTime.getTime() - startTime.getTime())) *
                100
            )}%
          </p>
        </div>
      </Popup>
    </Marker>
  );
}

