import { 
  Node, 
  Event, 
  Shipment, 
  ShipmentLocation, 
  Batch, 
  EventType 
} from '@/types/dataModels';

export interface TimelineData {
  nodes: Node[];
  events: Event[];
  shipments: Shipment[];
  shipmentLocations: ShipmentLocation[];
  batches: Batch[];
}

// Generate realistic road-like route with waypoints
function generateRoadRoute(
  from: [number, number], // [lon, lat]
  to: [number, number]
): [number, number][] {
  const waypoints: [number, number][] = [];
  
  // Calculate midpoint and add curvature
  const midLon = (from[0] + to[0]) / 2;
  const midLat = (from[1] + to[1]) / 2;
  
  // Add perpendicular offset for curvature (simulating road curves)
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Perpendicular vector for curve
  const perpLon = -dy / dist * (dist * 0.15); // 15% offset
  const perpLat = dx / dist * (dist * 0.15);
  
  // Create waypoints with curve
  waypoints.push(from);
  
  // Intermediate waypoints (1-2 waypoints depending on distance)
  if (dist > 5) {
    // Long route - add 2 waypoints
    waypoints.push([
      midLon - perpLon * 0.7,
      midLat - perpLat * 0.7
    ]);
    waypoints.push([
      midLon + perpLon * 0.3,
      midLat + perpLat * 0.3
    ]);
  } else {
    // Shorter route - add 1 waypoint
    waypoints.push([
      midLon - perpLon * 0.5,
      midLat - perpLat * 0.5
    ]);
  }
  
  waypoints.push(to);
  
  return waypoints;
}

// Interpolate along a route with waypoints (creates smooth curved path)
function getPointAlongRoute(
  waypoints: [number, number][],
  progress: number // 0 to 1
): [number, number] {
  if (waypoints.length < 2) {
    return waypoints[0] || [0, 0];
  }
  
  if (progress <= 0) return waypoints[0];
  if (progress >= 1) return waypoints[waypoints.length - 1];
  
  // Use Bezier-like interpolation for smooth curves
  const segmentCount = waypoints.length - 1;
  const segmentIndex = Math.floor(progress * segmentCount);
  const segmentProgress = (progress * segmentCount) % 1;
  
  const p0 = waypoints[Math.max(0, segmentIndex - 1)];
  const p1 = waypoints[segmentIndex];
  const p2 = waypoints[Math.min(waypoints.length - 1, segmentIndex + 1)];
  const p3 = waypoints[Math.min(waypoints.length - 1, segmentIndex + 2)];
  
  // Cubic Bezier interpolation for smooth curves
  const t = segmentProgress;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  
  const lon = mt2 * mt * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t2 * t * p3[0];
  const lat = mt2 * mt * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t2 * t * p3[1];
  
  return [lon, lat];
}

// Generate nodes across different regions
export const generateNodes = (): Node[] => {
  return [
    // Farms
    {
      nodeId: 'farm_001',
      type: 'farm',
      name: 'Green Valley Farm',
      regionId: 'region_west',
      location: { type: 'Point', coordinates: [-118.2437, 34.0522] }, // Los Angeles
      capacity_kg: 10000,
      contact: 'contact@greenvalleyfarm.com',
    },
    {
      nodeId: 'farm_002',
      type: 'farm',
      name: 'Sunrise Organic Farm',
      regionId: 'region_east',
      location: { type: 'Point', coordinates: [-74.0060, 40.7128] }, // New York
      capacity_kg: 8000,
    },
    {
      nodeId: 'farm_003',
      type: 'farm',
      name: 'Mountain View Farm',
      regionId: 'region_central',
      location: { type: 'Point', coordinates: [-87.6298, 41.8781] }, // Chicago
      capacity_kg: 12000,
    },
    // Processing Centers
    {
      nodeId: 'processing_001',
      type: 'processing',
      name: 'Central Processing Plant',
      regionId: 'region_central',
      location: { type: 'Point', coordinates: [-96.7970, 32.7767] }, // Dallas
      capacity_kg: 50000,
    },
    // Warehouses
    {
      nodeId: 'warehouse_001',
      type: 'warehouse',
      name: 'Main Distribution Warehouse',
      regionId: 'region_west',
      location: { type: 'Point', coordinates: [-122.4194, 37.7749] }, // San Francisco
      capacity_kg: 80000,
    },
    {
      nodeId: 'warehouse_002',
      type: 'warehouse',
      name: 'East Coast Hub',
      regionId: 'region_east',
      location: { type: 'Point', coordinates: [-75.1652, 39.9526] }, // Philadelphia
      capacity_kg: 70000,
    },
    // NGOs
    {
      nodeId: 'ngo_001',
      type: 'ngo',
      name: 'Community Food Bank',
      regionId: 'region_south',
      location: { type: 'Point', coordinates: [-95.3698, 29.7604] }, // Houston
      capacity_kg: 30000,
    },
    {
      nodeId: 'ngo_002',
      type: 'ngo',
      name: 'Hope Food Distribution',
      regionId: 'region_west',
      location: { type: 'Point', coordinates: [-122.3321, 47.6062] }, // Seattle
      capacity_kg: 25000,
    },
  ];
};

export const generateFoodTimelineData = (): TimelineData => {
  const nodes = generateNodes();
  const farms = nodes.filter(n => n.type === 'farm');
  const processing = nodes.filter(n => n.type === 'processing');
  const warehouses = nodes.filter(n => n.type === 'warehouse');
  const ngos = nodes.filter(n => n.type === 'ngo');

  const now = new Date();
  const animationDuration = 20000; // 20 seconds
  const startTime = new Date(now.getTime() - animationDuration);

  const events: Event[] = [];
  const shipments: Shipment[] = [];
  const shipmentLocations: ShipmentLocation[] = [];
  const batches: Batch[] = [];

  let eventCounter = 1;
  let batchCounter = 1;
  let shipmentCounter = 1;
  const foodTypes = ['Tomatoes', 'Lettuce', 'Bread', 'Dairy', 'Grain', 'Vegetables'];

  // Step 1: Generate farm production events (0-4s)
  const createdBatches: { batchId: string; farm: Node; quantity: number; foodType: string; time: Date }[] = [];
  
  for (let i = 0; i < 8; i++) {
    const timeOffset = (i / 8) * 4000;
    const time = new Date(startTime.getTime() + timeOffset);
    const farm = farms[Math.floor(Math.random() * farms.length)];
    const quantity = 500 + Math.random() * 1500;
    const foodType = foodTypes[Math.floor(Math.random() * foodTypes.length)];
    const batchId = `batch_${batchCounter++}`;

    createdBatches.push({ batchId, farm, quantity, foodType, time });

    // Create farm_production event
    events.push({
      eventId: `event_${eventCounter++}`,
      time,
      type: 'farm_production',
      location: farm.location,
      payload: {
        nodeId: farm.nodeId,
        batchId,
        foodType,
        quantity_kg: quantity,
        farm_name: farm.name,
      },
    });

    // Create batch
    batches.push({
      batchId,
      parentBatchId: null,
      foodType,
      quantity_kg: quantity,
      original_quantity_kg: quantity,
      originNode: farm.nodeId,
      currentNode: farm.nodeId,
      status: 'stored',
      shelf_life_hours: 168,
      manufacture_date: time,
      expiry_iso: new Date(time.getTime() + 168 * 60 * 60 * 1000),
      freshnessPct: 100,
      history: [{
        time,
        action: 'produced',
        from: null,
        to: farm.nodeId,
        note: `Produced at ${farm.name}`,
      }],
    });
  }

  // Step 2: Create shipments from farms to processing (4-8s)
  createdBatches.forEach((batch, idx) => {
    const departureTime = new Date(startTime.getTime() + 4000 + (idx / createdBatches.length) * 4000);
    const arrivalTime = new Date(departureTime.getTime() + 4000); // 4 second travel time
    const shipmentId = `shipment_${shipmentCounter++}`;
    const processingNode = processing[0];
    const fromCoords = batch.farm.location.coordinates;
    const toCoords = processingNode.location.coordinates;

    // Generate realistic road route
    const roadRoute = generateRoadRoute(fromCoords, toCoords);

    // Create shipment_created event
    events.push({
      eventId: `event_${eventCounter++}`,
      time: departureTime,
      type: 'shipment_created',
      location: batch.farm.location,
      payload: {
        shipmentId,
        batchId: batch.batchId,
        fromNode: batch.farm.nodeId,
        toNode: processingNode.nodeId,
        quantity_kg: batch.quantity,
      },
    });

    // Update batch status to in_transit
    const batchIdx = batches.findIndex(b => b.batchId === batch.batchId);
    if (batchIdx >= 0) {
      batches[batchIdx].status = 'in_transit';
      batches[batchIdx].history.push({
        time: departureTime,
        action: 'departed',
        from: batch.farm.nodeId,
        to: processingNode.nodeId,
        note: 'Batch in transit',
      });
    }

    // Create shipment
    shipments.push({
      shipmentId,
      batchIds: [batch.batchId],
      fromNode: batch.farm.nodeId,
      toNode: processingNode.nodeId,
      start_iso: departureTime,
      eta_iso: arrivalTime,
      arrived_iso: null,
      status: 'in_transit',
      vehicleId: `vehicle_${shipmentCounter}`,
      travel_time_minutes: 4 * 60,
      breaks: [],
      createdBy: 'system',
      latest_location: {
        coordinates: fromCoords,
        timestamp: departureTime,
      },
    });

    // Generate location snapshots at 1-hour intervals (scaled: every 0.8 seconds = ~5 snapshots)
    const travelDuration = arrivalTime.getTime() - departureTime.getTime();
    const intervalMs = travelDuration / 5; // 5 snapshots = equivalent to 5 hours
    const numSnapshots = 5;
    
    for (let s = 0; s <= numSnapshots; s++) {
      const snapshotTime = new Date(departureTime.getTime() + s * intervalMs);
      const progress = s / numSnapshots;
      
      // Use realistic road route
      const coordinates = getPointAlongRoute(roadRoute, progress);
      
      // Calculate speed (varies along route)
      const baseSpeed = 65 + Math.random() * 15;
      const speedVariation = Math.sin(progress * Math.PI) * 10;
      const speed_kmh = Math.max(55, Math.min(85, baseSpeed + speedVariation));
      
      shipmentLocations.push({
        shipmentId,
        timestamp: snapshotTime,
        coordinates,
        speed_kmh,
        eta_iso: arrivalTime,
      });

      // Create shipment_location_update event for each snapshot
      events.push({
        eventId: `event_${eventCounter++}`,
        time: snapshotTime,
        type: 'shipment_location_update',
        location: { type: 'Point', coordinates },
        payload: {
          shipmentId,
          batchId: batch.batchId,
          coordinates,
          speed_kmh,
          timestamp: snapshotTime.toISOString(),
        },
      });
    }

    // Create shipment_arrived event
    events.push({
      eventId: `event_${eventCounter++}`,
      time: arrivalTime,
      type: 'shipment_arrived',
      location: processingNode.location,
      payload: {
        shipmentId,
        batchId: batch.batchId,
        nodeId: processingNode.nodeId,
        arrived_at: arrivalTime.toISOString(),
      },
    });

    // Update batch status
    const arrivalBatchIdx = batches.findIndex(b => b.batchId === batch.batchId);
    if (arrivalBatchIdx >= 0) {
      batches[arrivalBatchIdx].currentNode = processingNode.nodeId;
      batches[arrivalBatchIdx].status = 'stored';
      batches[arrivalBatchIdx].quantity_kg *= 0.95;
      batches[arrivalBatchIdx].history.push({
        time: arrivalTime,
        action: 'arrived',
        from: batch.farm.nodeId,
        to: processingNode.nodeId,
        note: 'Arrived at processing plant',
      });
    }

    // Update shipment
    const shipmentIdx = shipments.findIndex(s => s.shipmentId === shipmentId);
    if (shipmentIdx >= 0) {
      shipments[shipmentIdx].arrived_iso = arrivalTime;
      shipments[shipmentIdx].status = 'arrived';
    }
  });

  // Step 3: Create shipments from processing to warehouses (12-16s)
  const processedBatches = createdBatches.slice(0, Math.min(2, warehouses.length));
  
  processedBatches.forEach((originalBatch, idx) => {
    const departureTime = new Date(startTime.getTime() + 12000 + idx * 2000);
    const arrivalTime = new Date(departureTime.getTime() + 2000);
    const shipmentId = `shipment_${shipmentCounter++}`;
    const warehouse = warehouses[idx % warehouses.length];
    const processingNode = processing[0];
    const fromCoords = processingNode.location.coordinates;
    const toCoords = warehouse.location.coordinates;

    // Generate realistic road route
    const roadRoute = generateRoadRoute(fromCoords, toCoords);

    // Create shipment_created event
    events.push({
      eventId: `event_${eventCounter++}`,
      time: departureTime,
      type: 'shipment_created',
      location: processingNode.location,
      payload: {
        shipmentId,
        batchId: originalBatch.batchId,
        fromNode: processingNode.nodeId,
        toNode: warehouse.nodeId,
      },
    });

    // Update batch status to in_transit
    const transitBatchIdx = batches.findIndex(b => b.batchId === originalBatch.batchId);
    if (transitBatchIdx >= 0) {
      batches[transitBatchIdx].status = 'in_transit';
      batches[transitBatchIdx].history.push({
        time: departureTime,
        action: 'departed',
        from: processingNode.nodeId,
        to: warehouse.nodeId,
        note: 'Batch in transit to warehouse',
      });
    }

    // Create shipment
    shipments.push({
      shipmentId,
      batchIds: [originalBatch.batchId],
      fromNode: processingNode.nodeId,
      toNode: warehouse.nodeId,
      start_iso: departureTime,
      eta_iso: arrivalTime,
      arrived_iso: null,
      status: 'in_transit',
      vehicleId: `vehicle_${shipmentCounter}`,
      travel_time_minutes: 2 * 60,
      breaks: [],
      createdBy: 'system',
      latest_location: {
        coordinates: fromCoords,
        timestamp: departureTime,
      },
    });

    // Generate location snapshots
    const travelDuration = arrivalTime.getTime() - departureTime.getTime();
    const intervalMs = travelDuration / 4;
    const numSnapshots = 4;
    
    for (let s = 0; s <= numSnapshots; s++) {
      const snapshotTime = new Date(departureTime.getTime() + s * intervalMs);
      const progress = s / numSnapshots;
      const coordinates = getPointAlongRoute(roadRoute, progress);
      
      const baseSpeed = 70 + Math.random() * 15;
      const speedVariation = Math.sin(progress * Math.PI) * 8;
      const speed_kmh = Math.max(60, Math.min(90, baseSpeed + speedVariation));
      
      shipmentLocations.push({
        shipmentId,
        timestamp: snapshotTime,
        coordinates,
        speed_kmh,
        eta_iso: arrivalTime,
      });

      // Create shipment_location_update event
      events.push({
        eventId: `event_${eventCounter++}`,
        time: snapshotTime,
        type: 'shipment_location_update',
        location: { type: 'Point', coordinates },
        payload: {
          shipmentId,
          batchId: originalBatch.batchId,
          coordinates,
          speed_kmh,
          timestamp: snapshotTime.toISOString(),
        },
      });
    }

    // Create shipment_arrived event
    events.push({
      eventId: `event_${eventCounter++}`,
      time: arrivalTime,
      type: 'shipment_arrived',
      location: warehouse.location,
      payload: {
        shipmentId,
        batchId: originalBatch.batchId,
        nodeId: warehouse.nodeId,
      },
    });

    // Update batch and shipment
    const finalBatchIdx = batches.findIndex(b => b.batchId === originalBatch.batchId);
    if (finalBatchIdx >= 0) {
      batches[finalBatchIdx].currentNode = warehouse.nodeId;
      batches[finalBatchIdx].status = 'stored';
      batches[finalBatchIdx].history.push({
        time: arrivalTime,
        action: 'arrived',
        from: processingNode.nodeId,
        to: warehouse.nodeId,
        note: 'Arrived at warehouse',
      });
    }

    const finalShipmentIdx = shipments.findIndex(s => s.shipmentId === shipmentId);
    if (finalShipmentIdx >= 0) {
      shipments[finalShipmentIdx].arrived_iso = arrivalTime;
      shipments[finalShipmentIdx].status = 'arrived';
    }
  });

  // Step 4: Generate NGO requests (16-18s)
  for (let i = 0; i < 2; i++) {
    const time = new Date(startTime.getTime() + 16000 + i * 1000);
    const ngo = ngos[i % ngos.length];

    events.push({
      eventId: `event_${eventCounter++}`,
      time,
      type: 'ngo_request',
      location: ngo.location,
      payload: {
        nodeId: ngo.nodeId,
        requestId: `request_${i + 1}`,
        required_food_types: foodTypes.slice(0, 2),
        required_kg: 500 + Math.random() * 1000,
      },
    });
  }

  // Sort all by time
  events.sort((a, b) => a.time.getTime() - b.time.getTime());
  shipmentLocations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    nodes,
    events,
    shipments,
    shipmentLocations,
    batches,
  };
};

