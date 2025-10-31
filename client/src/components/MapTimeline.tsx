'use client';

import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import AnimatedPolyline from './AnimatedPolyline';
import AnimatedTransitMarker from './AnimatedTransitMarker';
import { Node, Shipment, Event } from '@/data/sampleFoodData';

// Fix for default marker icons in Next.js
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

interface MapTimelineProps {
  nodes: Node[];
  events: Event[];
  shipments: Shipment[];
  shipmentLocationUpdates: any[];
  currentTime: Date;
  startTime: Date;
  endTime: Date;
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

export default function MapTimeline({
  nodes,
  events,
  shipments,
  shipmentLocationUpdates,
  currentTime,
  startTime,
  endTime,
}: MapTimelineProps) {
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);

  // Filter events visible at current time
  const visibleEvents = useMemo(() => {
    return events.filter((event) => event.time <= currentTime);
  }, [events, currentTime]);

  // Filter shipments that are active (started but not arrived yet)
  const activeShipments = useMemo(() => {
    return shipments.filter((shipment) => {
      return (
        currentTime >= shipment.startTime &&
        (!shipment.arrivedTime || currentTime < shipment.arrivedTime)
      );
    });
  }, [shipments, currentTime]);

  // Filter shipments that should show path (started or completed)
  const visibleShipments = useMemo(() => {
    return shipments.filter((shipment) => shipment.startTime <= currentTime);
  }, [shipments, currentTime]);

  // Calculate bounds
  useEffect(() => {
    const allPoints: [number, number][] = [];
    nodes.forEach((node) => {
      allPoints.push([node.lat, node.lng]);
    });
    events.forEach((event) => {
      allPoints.push([event.lat, event.lng]);
    });

    if (allPoints.length > 0) {
      const newBounds = L.latLngBounds(allPoints);
      setBounds(newBounds);
    }
  }, [nodes, events]);

  // Get node type color and emoji
  const getNodeStyle = (type: string) => {
    const styles: Record<string, { color: string; emoji: string }> = {
      farm: { color: '#22c55e', emoji: '🌾' },
      processing: { color: '#3b82f6', emoji: '🏭' },
      warehouse: { color: '#f59e0b', emoji: '📦' },
      ngo: { color: '#ef4444', emoji: '❤️' },
    };
    return styles[type] || { color: '#6b7280', emoji: '📍' };
  };

  // Get event type color
  const getEventColor = (type: string) => {
    const colors: Record<string, string> = {
      farm_production: '#22c55e',
      shipment_created: '#3b82f6',
      shipment_location_update: '#f59e0b',
      shipment_arrived: '#10b981',
      ngo_request: '#ef4444',
      batch_spoiled: '#dc2626',
      prediction_made: '#8b5cf6',
    };
    return colors[type] || '#6b7280';
  };

  // Create node icon
  const createNodeIcon = (type: string) => {
    const style = getNodeStyle(type);
    return L.divIcon({
      className: 'node-marker',
      html: `
        <div style="
          background-color: ${style.color};
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        ">${style.emoji}</div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  // Create event icon
  const createEventIcon = (type: string) => {
    const color = getEventColor(type);
    return L.divIcon({
      className: 'event-marker',
      html: `
        <div style="
          background-color: ${color};
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          animation: pulse 2s infinite;
        "></div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  };

  if (typeof window === 'undefined') {
    return <div className="w-full h-full bg-gray-100 flex items-center justify-center">Loading map...</div>;
  }

  const defaultCenter: [number, number] = [39.8283, -98.5795]; // US Center
  const defaultZoom = 4;

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: '100%', width: '100%', zIndex: 1 }}
        className="rounded-lg"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {bounds && <MapUpdater bounds={bounds} />}

        {/* Render shipment paths */}
        {visibleShipments.map((shipment) => {
          const path: [number, number][] = [
            [shipment.fromLat, shipment.fromLng],
            [shipment.toLat, shipment.toLng],
          ];
          const isActive = activeShipments.some((s) => s.id === shipment.id);

          return (
            <AnimatedPolyline
              key={shipment.id}
              positions={path}
              color={isActive ? '#f59e0b' : '#94a3b8'}
              weight={isActive ? 4 : 2}
              opacity={isActive ? 0.8 : 0.4}
              animated={isActive}
            />
          );
        })}

        {/* Render nodes */}
        {nodes.map((node) => (
          <Marker
            key={node.id}
            position={[node.lat, node.lng]}
            icon={createNodeIcon(node.type)}
          >
            <Popup>
              <div className="p-2">
                <h3 className="font-semibold text-lg mb-1">
                  {getNodeStyle(node.type).emoji} {node.name}
                </h3>
                <p className="text-sm text-gray-600 mb-1">
                  <span className="font-medium">Type:</span> {node.type}
                </p>
                <p className="text-sm text-gray-600 mb-1">
                  <span className="font-medium">Node ID:</span> {node.nodeId}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Render events */}
        {visibleEvents.map((event) => {
          // Skip location updates as they're shown by transit markers
          if (event.type === 'shipment_location_update') return null;

          return (
            <Marker
              key={event.id}
              position={[event.lat, event.lng]}
              icon={createEventIcon(event.type)}
            >
              <Popup>
                <div className="p-2">
                  <h3 className="font-semibold text-lg mb-1">
                    Event: {event.type.replace(/_/g, ' ').toUpperCase()}
                  </h3>
                  <p className="text-sm text-gray-600 mb-1">
                    <span className="font-medium">Time:</span>{' '}
                    {event.time.toLocaleTimeString()}
                  </p>
                  <p className="text-sm text-gray-600 mb-1">
                    <span className="font-medium">Event ID:</span> {event.eventId}
                  </p>
                  {event.payload && (
                    <div className="text-xs text-gray-500 mt-2">
                      {JSON.stringify(event.payload, null, 2)}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Render animated transit markers */}
        {activeShipments.map((shipment) => (
          <AnimatedTransitMarker
            key={shipment.id}
            startPos={[shipment.fromLat, shipment.fromLng]}
            endPos={[shipment.toLat, shipment.toLng]}
            startTime={shipment.startTime}
            endTime={shipment.etaTime || shipment.arrivedTime || new Date()}
            currentTime={currentTime}
            foodItem={shipment.foodItem}
            shipmentId={shipment.shipmentId}
          />
        ))}
      </MapContainer>

      {/* Stats overlay */}
      <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 z-[1000] border border-gray-200">
        <div className="text-sm space-y-2">
          <div>
            <div className="font-semibold text-gray-900 mb-1">Active Shipments</div>
            <div className="text-2xl font-bold text-amber-600">{activeShipments.length}</div>
            <div className="text-xs text-gray-500 mt-1">of {shipments.length} total</div>
          </div>
          <div className="pt-2 border-t border-gray-200">
            <div className="font-semibold text-gray-900 mb-1">Events</div>
            <div className="text-2xl font-bold text-blue-600">{visibleEvents.length}</div>
            <div className="text-xs text-gray-500 mt-1">of {events.length} total</div>
          </div>
        </div>
      </div>

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
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
        }

        .leaflet-popup-content-wrapper {
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
