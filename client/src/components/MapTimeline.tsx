'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Node, Event, Shipment, ShipmentLocation, Batch } from '@/types/dataModels';

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
  shipmentLocations: ShipmentLocation[];
  batches: Batch[];
  currentTime: Date;
  startTime: Date;
  endTime: Date;
}

function MapUpdater({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [100, 100] });
    }
  }, [map, bounds]);

  return null;
}

// Component to smoothly animate marker position
function SmoothMarker({ position, icon, popupContent }: { 
  position: [number, number]; 
  icon: L.DivIcon;
  popupContent: React.ReactNode;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const popupRef = useRef<L.Popup | null>(null);

  useEffect(() => {
    if (!markerRef.current) {
      markerRef.current = L.marker(position, { icon }).addTo(map);
      if (popupContent) {
        popupRef.current = L.popup().setContent(popupContent as any);
        markerRef.current.bindPopup(popupRef.current);
      }
    } else {
      // Smooth animation with shorter duration for responsiveness
      markerRef.current.setLatLng(position, { 
        animate: true, 
        duration: 0.2, // Faster animation for smoother feel
        easeLinearity: 0.25
      });
    }
  }, [position[0], position[1], icon, map, popupContent]);

  useEffect(() => {
    return () => {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
      }
    };
  }, [map]);

  return null;
}

function AnimatedShipmentMarker({
  shipment,
  locationSnapshots,
  currentTime,
  nodes,
}: {
  shipment: Shipment;
  locationSnapshots: ShipmentLocation[];
  currentTime: Date;
  nodes: Node[];
}) {
  // Easing function for smooth interpolation (ease-in-out)
  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  const getCurrentPosition = (): [number, number] => {
    const fromNode = nodes.find(n => n.nodeId === shipment.fromNode);
    const toNode = nodes.find(n => n.nodeId === shipment.toNode);
    
    // Always have a fallback position (starting node)
    const defaultPosition: [number, number] = fromNode 
      ? [fromNode.location.coordinates[1], fromNode.location.coordinates[0]]
      : [0, 0];

    if (locationSnapshots.length === 0) {
      return defaultPosition;
    }

    // Get all snapshots sorted by time
    const sortedSnapshots = [...locationSnapshots].sort((a, b) => 
      a.timestamp.getTime() - b.timestamp.getTime()
    );

    const validSnapshots = sortedSnapshots.filter(s => s.timestamp <= currentTime);
    
    // Before any snapshot, show at starting position
    if (validSnapshots.length === 0) {
      return defaultPosition;
    }

    const latestSnapshot = validSnapshots[validSnapshots.length - 1];
    
    // Find next snapshot for interpolation
    const nextIndex = sortedSnapshots.findIndex(s => s.timestamp > currentTime);
    
    if (nextIndex >= 0 && nextIndex < sortedSnapshots.length) {
      const nextSnapshot = sortedSnapshots[nextIndex];
      const prevSnapshot = sortedSnapshots[nextIndex - 1] || latestSnapshot;
      
      const timeSpan = nextSnapshot.timestamp.getTime() - prevSnapshot.timestamp.getTime();
      if (timeSpan <= 0) {
        return [latestSnapshot.coordinates[1], latestSnapshot.coordinates[0]];
      }
      
      const elapsed = currentTime.getTime() - prevSnapshot.timestamp.getTime();
      let progress = Math.max(0, Math.min(1, elapsed / timeSpan));
      
      // Apply easing for smoother movement
      progress = easeInOutCubic(progress);

      const prevLat = prevSnapshot.coordinates[1];
      const prevLng = prevSnapshot.coordinates[0];
      const nextLat = nextSnapshot.coordinates[1];
      const nextLng = nextSnapshot.coordinates[0];

      const lat = prevLat + (nextLat - prevLat) * progress;
      const lng = prevLng + (nextLng - prevLng) * progress;
      
      return [lat, lng];
    }

    // Past last snapshot, show final position
    return [latestSnapshot.coordinates[1], latestSnapshot.coordinates[0]];
  };

  const position = useMemo(() => getCurrentPosition(), [
    currentTime.getTime(),
    locationSnapshots.length,
    shipment.shipmentId
  ]);
  
  // Don't render if shipment hasn't started
  if (shipment.start_iso > currentTime) return null;

  const icon = L.divIcon({
    className: 'animated-shipment-marker',
    html: `
      <div style="
        background-color: #f59e0b;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        animation: pulse-shipment 1s infinite;
        transition: transform 0.2s ease-out;
      "></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  const fromNode = nodes.find(n => n.nodeId === shipment.fromNode);
  const toNode = nodes.find(n => n.nodeId === shipment.toNode);

  const popupContent = (
    <div className="p-2">
      <h4 className="font-semibold text-sm mb-1">Shipment in Transit</h4>
      <p className="text-xs text-gray-600">ID: {shipment.shipmentId}</p>
      <p className="text-xs text-gray-600">From: {fromNode?.name || shipment.fromNode}</p>
      <p className="text-xs text-gray-600">To: {toNode?.name || shipment.toNode}</p>
      <p className="text-xs text-amber-600 mt-1">Status: {shipment.status}</p>
      {locationSnapshots.length > 0 && (
        <p className="text-xs text-gray-500 mt-1">
          Speed: {locationSnapshots[locationSnapshots.length - 1].speed_kmh?.toFixed(0)} km/h
        </p>
      )}
    </div>
  );

  return <SmoothMarker position={position} icon={icon} popupContent={popupContent} />;
}

export default function MapTimeline({
  nodes,
  events,
  shipments,
  shipmentLocations,
  batches,
  currentTime,
  startTime,
  endTime,
}: MapTimelineProps) {
  const [visibleEvents, setVisibleEvents] = useState<Event[]>([]);
  const [activeShipments, setActiveShipments] = useState<Shipment[]>([]);
  const [completedShipments, setCompletedShipments] = useState<Shipment[]>([]);
  const [activeReservations, setActiveReservations] = useState<Batch[]>([]);
  const [visibleBatches, setVisibleBatches] = useState<Batch[]>([]);
  const [nodeInventory, setNodeInventory] = useState<Map<string, number>>(new Map());
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);

  useEffect(() => {
    const visible = events.filter((event) => event.time <= currentTime);
    setVisibleEvents(visible);

    // Active shipments (in transit)
    const active = shipments.filter((shipment) => {
      return (
        shipment.start_iso <= currentTime &&
        (!shipment.arrived_iso || shipment.arrived_iso > currentTime)
      );
    });
    setActiveShipments(active);

    // Completed shipments (arrived, but show their route)
    const completed = shipments.filter((shipment) => {
      return (
        shipment.start_iso <= currentTime &&
        shipment.arrived_iso !== null &&
        shipment.arrived_iso <= currentTime
      );
    });
    setCompletedShipments(completed);

    // Visible batches (show where batches are located - only stored/reserved at nodes)
    const visibleBatchesList = batches.filter((batch) => {
      // Only show batches that are stored or reserved at nodes (not in transit)
      if ((batch.status === 'stored' || batch.status === 'reserved') && batch.currentNode !== null) {
        return true;
      }
      return false;
    });
    setVisibleBatches(visibleBatchesList);

    const reserved = batches.filter(
      (batch) => batch.status === 'reserved' && 
      batch.history.some(h => h.action === 'reserved' && h.time <= currentTime)
    );
    setActiveReservations(reserved);

    const inventory = new Map<string, number>();
    batches.forEach((batch) => {
      if (batch.currentNode && batch.status === 'stored') {
        const current = inventory.get(batch.currentNode) || 0;
        inventory.set(batch.currentNode, current + batch.quantity_kg);
      }
    });
    setNodeInventory(inventory);

    if (nodes.length > 0) {
      const latlngs = nodes.map((node) => [
        node.location.coordinates[1],
        node.location.coordinates[0],
      ] as [number, number]);
      const newBounds = L.latLngBounds(latlngs);
      setBounds(newBounds);
    }
  }, [events, shipments, batches, currentTime, nodes]);

  const getNodeStyle = (nodeType: string) => {
    const styles: Record<string, { color: string; emoji: string }> = {
      farm: { color: '#22c55e', emoji: '🌾' },
      processing: { color: '#3b82f6', emoji: '🏭' },
      warehouse: { color: '#f59e0b', emoji: '📦' },
      ngo: { color: '#ef4444', emoji: '❤️' },
    };
    return styles[nodeType] || { color: '#6b7280', emoji: '📍' };
  };

  const createNodeIcon = (node: Node, inventory: number) => {
    const style = getNodeStyle(node.type);
    const size = inventory > 0 ? 32 : 24;
    return L.divIcon({
      className: 'node-marker',
      html: `
        <div style="
          background-color: ${style.color};
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: ${size * 0.5}px;
          animation: ${inventory > 0 ? 'pulse-node 2s infinite' : 'none'};
        ">${style.emoji}</div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  };

  const getShipmentRoute = (shipmentId: string, isCompleted: boolean = false): { route: [number, number][]; opacity: number } => {
    const shipment = shipments.find(s => s.shipmentId === shipmentId);
    if (!shipment) return { route: [], opacity: 0 };

    const from = nodes.find(n => n.nodeId === shipment.fromNode);
    const to = nodes.find(n => n.nodeId === shipment.toNode);
    
    if (!from || !to) return { route: [], opacity: 0 };

    // Get all snapshots - if completed, show all snapshots, otherwise up to current time
    const allSnapshots = shipmentLocations
      .filter(s => s.shipmentId === shipmentId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const snapshots = isCompleted 
      ? allSnapshots // Show complete route for completed shipments
      : allSnapshots.filter(s => s.timestamp <= currentTime); // Show partial route for active shipments

    // If no snapshots yet, check if shipment has started
    if (snapshots.length === 0) {
      if (shipment.start_iso <= currentTime) {
        // Show at least starting point
        return {
          route: [[from.location.coordinates[1], from.location.coordinates[0]]],
          opacity: 0.3
        };
      }
      return { route: [], opacity: 0 };
    }

    // Build route from snapshots
    let route: [number, number][] = snapshots.map(s => [s.coordinates[1], s.coordinates[0]]);
    
    // If completed, ensure we include destination
    if (isCompleted && route.length > 0) {
      const lastPoint = route[route.length - 1];
      const destPoint: [number, number] = [to.location.coordinates[1], to.location.coordinates[0]];
      // Only add destination if it's different from last point
      const dist = Math.sqrt(
        Math.pow(lastPoint[0] - destPoint[0], 2) + 
        Math.pow(lastPoint[1] - destPoint[1], 2)
      );
      if (dist > 0.001) {
        route.push(destPoint);
      }
    }
    
    // Opacity: completed routes stay fully visible, active routes fade in
    const opacity = isCompleted 
      ? 0.7 // Full opacity for completed routes
      : Math.min(0.8, 0.4 + (snapshots.length / Math.max(1, allSnapshots.length)) * 0.4);

    return { route, opacity };
  };

  const getReservationRoute = (batch: Batch): [number, number][] | null => {
    const lastReservation = batch.history
      .filter(h => h.action === 'reserved' && h.time <= currentTime)
      .sort((a, b) => b.time.getTime() - a.time.getTime())[0];

    if (!lastReservation || !lastReservation.from || !lastReservation.to) return null;

    const from = nodes.find(n => n.nodeId === lastReservation.from);
    const to = nodes.find(n => n.nodeId === lastReservation.to);
    if (!from || !to) return null;

    return [
      [from.location.coordinates[1], from.location.coordinates[0]],
      [to.location.coordinates[1], to.location.coordinates[0]],
    ];
  };

  if (typeof window === 'undefined') {
    return <div className="w-full h-full bg-gray-100 flex items-center justify-center">Loading map...</div>;
  }

  const defaultCenter: [number, number] = [39.8283, -98.5795];
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

        {/* Active shipment routes (in transit) */}
        {activeShipments.map((shipment) => {
          const { route, opacity } = getShipmentRoute(shipment.shipmentId, false);
          if (route.length < 1) return null;

          return (
            <Polyline
              key={`route-active-${shipment.shipmentId}`}
              positions={route}
              color="#f59e0b"
              weight={3}
              opacity={opacity}
              dashArray={route.length >= 2 ? "10, 5" : undefined}
              pathOptions={{
                smoothFactor: 1.5,
                fill: false,
              }}
            />
          );
        })}

        {/* Completed shipment routes (keep visible) */}
        {completedShipments.map((shipment) => {
          const { route, opacity } = getShipmentRoute(shipment.shipmentId, true);
          if (route.length < 2) return null;

          return (
            <Polyline
              key={`route-completed-${shipment.shipmentId}`}
              positions={route}
              color="#f59e0b"
              weight={2}
              opacity={opacity}
              dashArray="5, 5"
              pathOptions={{
                smoothFactor: 1.5,
                fill: false,
              }}
            />
          );
        })}

        {activeReservations.map((batch, idx) => {
          const route = getReservationRoute(batch);
          if (!route) return null;

          return (
            <Polyline
              key={`reservation-${batch.batchId}-${idx}`}
              positions={route}
              color="#8b5cf6"
              weight={2}
              opacity={0.4}
              dashArray="5, 5"
            />
          );
        })}

        {nodes.map((node) => {
          const inventory = nodeInventory.get(node.nodeId) || 0;
          return (
            <Marker
              key={node.nodeId}
              position={[node.location.coordinates[1], node.location.coordinates[0]]}
              icon={createNodeIcon(node, inventory)}
            >
              <Popup>
                <div className="p-2 min-w-[200px]">
                  <h3 className="font-semibold text-lg mb-1">{node.name}</h3>
                  <p className="text-sm text-gray-600 mb-1">
                    <span className="font-medium">Type:</span> {node.type}
                  </p>
                  <p className="text-sm text-gray-600 mb-1">
                    <span className="font-medium">Region:</span> {node.regionId}
                  </p>
                  <p className="text-sm font-medium text-blue-600 mb-1">
                    <span>Inventory:</span> {inventory.toFixed(0)} kg
                  </p>
                  <p className="text-sm text-gray-500">
                    <span>Capacity:</span> {node.capacity_kg} kg
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Batch markers - show where batches are located */}
        {visibleBatches.map((batch) => {
          if (!batch.currentNode) return null;
          
          const node = nodes.find(n => n.nodeId === batch.currentNode);
          if (!node) return null;

          // Create batch icon based on status
          const getBatchColor = () => {
            if (batch.status === 'in_transit') return '#f59e0b'; // amber
            if (batch.status === 'reserved') return '#8b5cf6'; // purple
            return '#3b82f6'; // blue for stored
          };

          const batchIcon = L.divIcon({
            className: 'batch-marker',
            html: `
              <div style="
                background-color: ${getBatchColor()};
                width: 14px;
                height: 14px;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                animation: pulse-batch 2s infinite;
              "></div>
            `,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });

          return (
            <Marker
              key={`batch-${batch.batchId}`}
              position={[node.location.coordinates[1], node.location.coordinates[0]]}
              icon={batchIcon}
            >
              <Popup>
                <div className="p-2">
                  <h4 className="font-semibold text-sm mb-1">Batch: {batch.foodType}</h4>
                  <p className="text-xs text-gray-600">ID: {batch.batchId}</p>
                  <p className="text-xs text-gray-600">Location: {node.name}</p>
                  <p className="text-xs text-gray-600">Quantity: {batch.quantity_kg.toFixed(0)} kg</p>
                  <p className="text-xs text-gray-600">
                    Status: <span className="font-medium">{batch.status}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Freshness: {batch.freshnessPct.toFixed(0)}%
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {visibleEvents
          .filter(e => e.type === 'farm_production' || e.type === 'ngo_request')
          .map((event) => {
            const icon = L.divIcon({
              className: 'event-marker',
              html: `
                <div style="
                  background-color: ${event.type === 'farm_production' ? '#22c55e' : '#ef4444'};
                  width: 12px;
                  height: 12px;
                  border-radius: 50%;
                  border: 2px solid white;
                  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                  animation: pulse-event 1.5s infinite;
                "></div>
              `,
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            });

            return (
              <Marker
                key={event.eventId}
                position={[event.location.coordinates[1], event.location.coordinates[0]]}
                icon={icon}
              >
                <Popup>
                  <div className="p-2">
                    <h4 className="font-semibold text-xs mb-1">{event.type.replace('_', ' ').toUpperCase()}</h4>
                    <p className="text-xs text-gray-600">
                      {new Date(event.time).toLocaleTimeString()}
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}

        {activeShipments.map((shipment) => {
          const snapshots = shipmentLocations
            .filter(s => s.shipmentId === shipment.shipmentId)
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

          return (
            <AnimatedShipmentMarker
              key={shipment.shipmentId}
              shipment={shipment}
              locationSnapshots={snapshots}
              currentTime={currentTime}
              nodes={nodes}
            />
          );
        })}
      </MapContainer>

      <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-4 z-[1000] border border-gray-200 min-w-[180px]">
        <div className="text-sm space-y-2">
          <div>
            <div className="font-semibold text-gray-900 mb-1">Active Shipments</div>
            <div className="text-2xl font-bold text-amber-600">{activeShipments.length}</div>
          </div>
          <div>
            <div className="font-semibold text-gray-900 mb-1">Reserved Batches</div>
            <div className="text-2xl font-bold text-purple-600">{activeReservations.length}</div>
          </div>
          <div>
            <div className="font-semibold text-gray-900 mb-1">Events</div>
            <div className="text-lg font-bold text-blue-600">{visibleEvents.length}</div>
          </div>
          <div>
            <div className="font-semibold text-gray-900 mb-1">Total Nodes</div>
            <div className="text-lg font-bold text-blue-600">{nodes.length}</div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .node-marker {
          background: transparent;
          border: none;
        }

        .animated-shipment-marker {
          background: transparent;
          border: none;
        }

        .event-marker {
          background: transparent;
          border: none;
        }

        @keyframes pulse-node {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.15);
            opacity: 0.9;
          }
        }

        @keyframes pulse-shipment {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.3);
            opacity: 0.7;
          }
        }

        @keyframes pulse-event {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.8;
          }
        }

        @keyframes pulse-batch {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.25);
            opacity: 0.85;
          }
        }

        .batch-marker {
          background: transparent;
          border: none;
        }

        .leaflet-popup-content-wrapper {
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}

