"use client";

import { useEffect, useState, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import AnimatedPolyline from "./AnimatedPolyline";
import AnimatedTransitMarker from "./AnimatedTransitMarker";
import type { Node, Shipment, Event } from "@/data/sampleFoodData";

// Fix for default marker icons in Next.js
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

interface MapTimelineProps {
  nodes: Node[];
  events: Event[];
  shipments: Shipment[];
  shipmentLocationUpdates: unknown[];
  currentTime: Date;
  startTime: Date;
  endTime: Date;
  performanceMode?: boolean;
  maxMarkers?: number;
  maxAnimatedPolylines?: number;
  maxEventMarkers?: number;
}

// Component to update map view when bounds change
function MapUpdater({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [100, 100] });
    }
  }, [map, bounds]);

  return null;
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvents({
    zoomend: (ev) => {
      onZoom(ev.target.getZoom());
    },
  });
  return null;
}

type NodeCluster = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  byType: Record<string, number>;
  bounds: L.LatLngBounds;
};

function gridClusterNodes(nodes: Node[], cellSizeDeg: number): NodeCluster[] {
  const buckets = new Map<
    string,
    {
      sumLat: number;
      sumLng: number;
      count: number;
      byType: Record<string, number>;
      points: [number, number][];
    }
  >();
  for (const n of nodes) {
    const latKey = Math.floor(n.lat / cellSizeDeg);
    const lngKey = Math.floor(n.lng / cellSizeDeg);
    const key = `${latKey}:${lngKey}`;
    const bucket = buckets.get(key) || {
      sumLat: 0,
      sumLng: 0,
      count: 0,
      byType: {},
      points: [],
    };
    bucket.sumLat += n.lat;
    bucket.sumLng += n.lng;
    bucket.count += 1;
    bucket.byType[n.type] = (bucket.byType[n.type] || 0) + 1;
    bucket.points.push([n.lat, n.lng]);
    buckets.set(key, bucket);
  }

  const clusters: NodeCluster[] = [];
  for (const [key, b] of buckets.entries()) {
    const lat = b.sumLat / b.count;
    const lng = b.sumLng / b.count;
    clusters.push({
      key,
      lat,
      lng,
      count: b.count,
      byType: b.byType,
      bounds: L.latLngBounds(b.points),
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

export default function MapTimeline({
  nodes,
  events,
  shipments,
  currentTime,
  performanceMode,
  maxMarkers = 500,
  maxAnimatedPolylines = 50,
  maxEventMarkers = 250,
}: MapTimelineProps) {
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
  const [zoom, setZoom] = useState<number>(5);

  const perf =
    (performanceMode ?? nodes.length > 250) ||
    shipments.length > 200 ||
    events.length > 400;

  // Filter events visible at current time
  const visibleEvents = useMemo(() => {
    return events.filter((event) => event.time <= currentTime);
  }, [events, currentTime]);

  // Filter shipments that are active (started but not arrived yet)
  const activeShipments = useMemo(() => {
    return shipments.filter((shipment) => {
      const endTime = shipment.arrivedTime || shipment.etaTime;
      return (
        currentTime >= shipment.startTime && (!endTime || currentTime < endTime)
      );
    });
  }, [shipments, currentTime]);

  // Filter shipments that should show path (started or completed)
  const visibleShipments = useMemo(() => {
    return shipments.filter((shipment) => shipment.startTime <= currentTime);
  }, [shipments, currentTime]);

  const cellSizeDeg = useMemo(() => {
    if (zoom <= 5) return 2.0;
    if (zoom === 6) return 1.2;
    if (zoom === 7) return 0.7;
    if (zoom === 8) return 0.35;
    return 0.2;
  }, [zoom]);

  const shouldClusterNodes = perf && nodes.length > 200 && zoom <= 7;

  const clusteredNodes = useMemo(() => {
    if (!shouldClusterNodes) return [] as NodeCluster[];
    return gridClusterNodes(nodes, cellSizeDeg);
  }, [cellSizeDeg, nodes, shouldClusterNodes]);

  // Calculate bounds using useMemo to avoid effect issues
  const calculatedBounds = useMemo(() => {
    if (nodes.length === 0 && events.length === 0) return null;

    const allPoints: [number, number][] = [];
    nodes.forEach((node) => {
      allPoints.push([node.lat, node.lng]);
    });
    events.forEach((event) => {
      allPoints.push([event.lat, event.lng]);
    });

    if (allPoints.length > 0) {
      return L.latLngBounds(allPoints);
    }
    return null;
  }, [nodes, events]);

  // Update bounds state when calculated bounds change
  useEffect(() => {
    if (calculatedBounds && (!bounds || !bounds.equals(calculatedBounds))) {
      setBounds(calculatedBounds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedBounds]);

  // Get node type color and emoji
  const getNodeStyle = (type: string) => {
    const styles: Record<string, { color: string; emoji: string }> = {
      farm: { color: "#22c55e", emoji: "🌾" },
      processing: { color: "#3b82f6", emoji: "🏭" },
      warehouse: { color: "#f59e0b", emoji: "📦" },
      ngo: { color: "#ef4444", emoji: "❤️" },
    };
    return styles[type] || { color: "#6b7280", emoji: "📍" };
  };

  // Get event type color
  const getEventColor = (type: string) => {
    const colors: Record<string, string> = {
      farm_production: "#22c55e",
      shipment_created: "#3b82f6",
      shipment_location_update: "#f59e0b",
      shipment_arrived: "#10b981",
      ngo_request: "#ef4444",
      batch_spoiled: "#dc2626",
      prediction_made: "#8b5cf6",
    };
    return colors[type] || "#6b7280";
  };

  // Create node icon with improved styling
  const createNodeIcon = (type: string) => {
    const style = getNodeStyle(type);
    const base = zoom <= 5 ? 22 : zoom === 6 ? 24 : zoom === 7 ? 26 : 28;
    const size = perf ? Math.max(18, base - 4) : base + 6;

    if (perf) {
      return L.divIcon({
        className: "node-marker",
        html: `
          <div style="
            background: ${style.color};
            width: ${size}px;
            height: ${size}px;
            border-radius: 9999px;
            border: 2px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: ${Math.max(12, Math.round(size * 0.55))}px;
          ">
            <span>${style.emoji}</span>
          </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
      });
    }

    return L.divIcon({
      className: "node-marker",
      html: `
        <div style="
          position: relative;
          background: linear-gradient(135deg, ${style.color} 0%, ${style.color}dd 100%);
          width: 40px;
          height: 40px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 2px ${style.color}33;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          transition: all 0.3s ease;
        ">
          <span style="transform: rotate(45deg); display: block;">${style.emoji}</span>
        </div>
        <div style="
          position: absolute;
          bottom: -5px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 8px solid ${style.color};
        "></div>
      `,
      iconSize: [40, 45],
      iconAnchor: [20, 45],
      popupAnchor: [0, -45],
    });
  };

  const createClusterIcon = (cluster: NodeCluster) => {
    const size = zoom <= 5 ? 34 : zoom === 6 ? 36 : 38;
    const countText =
      cluster.count >= 1000
        ? `${Math.round(cluster.count / 100) / 10}k`
        : String(cluster.count);
    return L.divIcon({
      className: "cluster-marker",
      html: `
        <div style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 9999px;
          background: rgba(37, 99, 235, 0.95);
          border: 2px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 700;
          font-size: 12px;
        ">${countText}</div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  };

  // Create event icon with improved styling
  const createEventIcon = (type: string) => {
    const color = getEventColor(type);
    return L.divIcon({
      className: "event-marker",
      html: `
        <div style="
          position: relative;
          background: radial-gradient(circle at 30% 30%, ${color}ff, ${color}cc);
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 3px 10px rgba(0,0,0,0.4), 0 0 0 2px ${color}44;
          animation: pulse 2s infinite;
        ">
          <div style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 8px;
            height: 8px;
            background: white;
            border-radius: 50%;
            opacity: 0.9;
          "></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  };

  if (typeof window === "undefined") {
    return (
      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
        Loading map...
      </div>
    );
  }

  const defaultCenter: [number, number] = [20.5937, 78.9629]; // India Center
  const defaultZoom = 5;

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: "100%", width: "100%", zIndex: 1 }}
        className="rounded-lg"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {bounds && <MapUpdater bounds={bounds} />}
        <ZoomTracker onZoom={setZoom} />

        {/* Render shipment paths (limit in perf mode) */}
        {(perf
          ? visibleShipments.filter((s) =>
              activeShipments.some((a) => a.id === s.id),
            )
          : visibleShipments
        ).map((shipment, idx) => {
          const path: [number, number][] = [
            [shipment.fromLat, shipment.fromLng],
            [shipment.toLat, shipment.toLng],
          ];
          const isActive = activeShipments.some((s) => s.id === shipment.id);
          const shouldAnimate =
            isActive && (!perf || idx < maxAnimatedPolylines);

          return (
            <AnimatedPolyline
              key={shipment.id}
              positions={path}
              color={isActive ? "#f59e0b" : "#94a3b8"}
              weight={isActive ? 4 : 2}
              opacity={isActive ? 0.8 : 0.4}
              animated={shouldAnimate}
            />
          );
        })}

        {/* Render nodes */}
        {shouldClusterNodes
          ? clusteredNodes.slice(0, maxMarkers).map((cluster) => (
              <Marker
                key={`cluster-${cluster.key}`}
                position={[cluster.lat, cluster.lng]}
                icon={createClusterIcon(cluster)}
                eventHandlers={{
                  click: (ev) => {
                    const map = ev.target._map as L.Map | undefined;
                    if (map)
                      map.fitBounds(cluster.bounds, { padding: [80, 80] });
                  },
                }}
              >
                <Popup>
                  <div className="p-3 min-w-[220px]">
                    <h3 className="font-semibold text-sm text-gray-900">
                      Cluster ({cluster.count} nodes)
                    </h3>
                    <div className="text-xs text-gray-600 mt-2 space-y-1">
                      {Object.entries(cluster.byType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div
                            key={type}
                            className="flex items-center justify-between"
                          >
                            <span className="capitalize">{type}</span>
                            <span className="font-medium">{count}</span>
                          </div>
                        ))}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-2">
                      Tip: click cluster to zoom.
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))
          : nodes.slice(0, maxMarkers).map((node) => (
              <Marker
                key={node.id}
                position={[node.lat, node.lng]}
                icon={createNodeIcon(node.type)}
              >
                <Popup>
                  <div className="p-3 min-w-[200px]">
                    <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                      <span className="text-xl">
                        {getNodeStyle(node.type).emoji}
                      </span>
                      <span>{node.name}</span>
                    </h3>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-700">
                        <span className="font-semibold">Type:</span>{" "}
                        <span className="capitalize text-gray-800">
                          {node.type}
                        </span>
                      </p>
                      <p className="text-sm text-gray-700">
                        <span className="font-semibold">Node ID:</span>{" "}
                        <span className="font-mono text-gray-800">
                          {node.nodeId}
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        📍 {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
                      </p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

        {/* Render events (hide/limit in perf mode) */}
        {(perf ? visibleEvents.slice(-maxEventMarkers) : visibleEvents).map(
          (event) => {
            // Skip location updates as they're shown by transit markers
            if (event.type === "shipment_location_update") return null;

            if (perf && visibleEvents.length > maxEventMarkers * 2) {
              // In perf mode with many events, only show key events.
              if (
                event.type !== "shipment_created" &&
                event.type !== "shipment_arrived"
              )
                return null;
            }

            return (
              <Marker
                key={event.id}
                position={[event.lat, event.lng]}
                icon={createEventIcon(event.type)}
              >
                <Popup>
                  <div className="p-3 min-w-[200px]">
                    <h3 className="font-bold text-base mb-2 capitalize">
                      {event.type.replace(/_/g, " ")}
                    </h3>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-700">
                        <span className="font-semibold">Date:</span>{" "}
                        <span className="text-gray-800">
                          {event.time.toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </p>
                      <p className="text-sm text-gray-700">
                        <span className="font-semibold">Event ID:</span>{" "}
                        <span className="font-mono text-gray-800">
                          {event.eventId}
                        </span>
                      </p>
                      {event.payload && (
                        <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
                          <span className="font-semibold block mb-1">
                            Details:
                          </span>
                          <pre className="whitespace-pre-wrap text-xs">
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          },
        )}

        {/* Render animated transit markers */}
        {activeShipments
          .slice(0, perf ? maxAnimatedPolylines : activeShipments.length)
          .map((shipment) => (
            <AnimatedTransitMarker
              key={shipment.id}
              startPos={[shipment.fromLat, shipment.fromLng]}
              endPos={[shipment.toLat, shipment.toLng]}
              startTime={shipment.startTime}
              endTime={shipment.etaTime || shipment.arrivedTime || new Date()}
              currentTime={currentTime}
              foodItem={shipment.foodItem}
              shipmentId={shipment.shipmentId}
              animate={!perf}
              sizePx={perf ? 28 : 40}
            />
          ))}
      </MapContainer>

      <style jsx global>{`
        .node-marker,
        .event-marker {
          background: transparent;
          border: none;
        }

        .animated-truck-marker {
          background: transparent;
          border: none;
        }

        @keyframes pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 1;
            box-shadow:
              0 3px 10px rgba(0, 0, 0, 0.4),
              0 0 0 2px currentColor;
          }
          50% {
            transform: scale(1.15);
            opacity: 0.9;
            box-shadow:
              0 4px 15px rgba(0, 0, 0, 0.5),
              0 0 0 4px currentColor;
          }
        }

        .cluster-marker {
          background: transparent;
          border: none;
        }

        .leaflet-marker-icon {
          transition: transform 0.2s ease;
        }

        .leaflet-marker-icon:hover {
          transform: scale(1.1);
          z-index: 1000;
        }

        .leaflet-popup-content-wrapper {
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
