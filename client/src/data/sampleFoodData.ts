export interface FoodDataPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  timestamp: Date;
  category: string;
  description?: string;
  value?: number;
}

export interface Node {
  id: string;
  nodeId: string;
  name: string;
  type: 'farm' | 'warehouse' | 'ngo' | 'processing';
  lat: number;
  lng: number;
}

export interface Shipment {
  id: string;
  shipmentId: string;
  fromNodeId: string;
  toNodeId: string;
  startTime: Date;
  etaTime?: Date;
  arrivedTime?: Date;
  status: 'in_transit' | 'arrived' | 'delayed' | 'cancelled';
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  foodItem: string;
  value: number;
}

export interface ShipmentLocationUpdate {
  id: string;
  shipmentId: string;
  lat: number;
  lng: number;
  timestamp: Date;
}

export interface Event {
  id: string;
  eventId: string;
  time: Date;
  type: 'farm_production' | 'ngo_request' | 'shipment_created' | 'shipment_arrived' | 'shipment_location_update' | 'batch_spoiled' | 'prediction_made';
  lat: number;
  lng: number;
  payload: any;
  shipmentId?: string;
}

// Generate complete food supply chain data with shipments and events
export const generateFoodTimelineData = () => {
  const now = new Date();
  const animationDuration = 20000; // 20 seconds in milliseconds
  const startTime = new Date(now.getTime() - animationDuration);

  // Create nodes (locations)
  const nodes: Node[] = [
    { id: 'node-1', nodeId: 'N001', name: 'Farm Alpha', type: 'farm', lat: 40.7128, lng: -74.0060 },
    { id: 'node-2', nodeId: 'N002', name: 'Farm Beta', type: 'farm', lat: 34.0522, lng: -118.2437 },
    { id: 'node-3', nodeId: 'N003', name: 'Farm Gamma', type: 'farm', lat: 41.8781, lng: -87.6298 },
    { id: 'node-4', nodeId: 'N004', name: 'Processing Plant A', type: 'processing', lat: 39.9526, lng: -75.1652 },
    { id: 'node-5', nodeId: 'N005', name: 'Processing Plant B', type: 'processing', lat: 32.7767, lng: -96.7970 },
    { id: 'node-6', nodeId: 'N006', name: 'Warehouse Central', type: 'warehouse', lat: 37.7749, lng: -122.4194 },
    { id: 'node-7', nodeId: 'N007', name: 'Warehouse East', type: 'warehouse', lat: 25.7617, lng: -80.1918 },
    { id: 'node-8', nodeId: 'N008', name: 'NGO Food Bank', type: 'ngo', lat: 47.6062, lng: -122.3321 },
    { id: 'node-9', nodeId: 'N009', name: 'Community Center', type: 'ngo', lat: 39.7392, lng: -104.9903 },
  ];

  const foodItems = [
    { name: 'Organic Tomatoes', value: 500 },
    { name: 'Fresh Lettuce', value: 300 },
    { name: 'Wheat Harvest', value: 1000 },
    { name: 'Dairy Products', value: 800 },
    { name: 'Bread Production', value: 600 },
    { name: 'Canned Goods', value: 400 },
  ];

  const shipments: Shipment[] = [];
  const events: Event[] = [];
  const shipmentLocationUpdates: ShipmentLocationUpdate[] = [];
  let shipmentCounter = 1;
  let eventCounter = 1;

  // Create shipments between nodes
  // Farm -> Processing (0-5s)
  const farms = nodes.filter(n => n.type === 'farm');
  const processing = nodes.filter(n => n.type === 'processing');
  const warehouses = nodes.filter(n => n.type === 'warehouse');
  const ngos = nodes.filter(n => n.type === 'ngo');

  // Shipment 1: Farm to Processing (starts at 1s, duration 3s)
  if (farms.length > 0 && processing.length > 0) {
    const farm = farms[0];
    const plant = processing[0];
    const foodItem = foodItems[0];
    const shipmentStart = new Date(startTime.getTime() + 1000);
    const shipmentDuration = 3000;
    const shipmentEnd = new Date(shipmentStart.getTime() + shipmentDuration);
    
    const shipment: Shipment = {
      id: `shipment-${shipmentCounter++}`,
      shipmentId: `SH${String(shipmentCounter - 1).padStart(3, '0')}`,
      fromNodeId: farm.id,
      toNodeId: plant.id,
      startTime: shipmentStart,
      etaTime: shipmentEnd,
      status: 'in_transit',
      fromLat: farm.lat,
      fromLng: farm.lng,
      toLat: plant.lat,
      toLng: plant.lng,
      foodItem: foodItem.name,
      value: foodItem.value,
    };
    shipments.push(shipment);

    // Create shipment_created event
    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: shipmentStart,
      type: 'shipment_created',
      lat: farm.lat,
      lng: farm.lng,
      payload: { shipmentId: shipment.shipmentId, fromNode: farm.name, toNode: plant.name },
      shipmentId: shipment.id,
    });

    // Create farm_production event
    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: new Date(startTime.getTime() + 500),
      type: 'farm_production',
      lat: farm.lat,
      lng: farm.lng,
      payload: { foodItem: foodItem.name, quantity: foodItem.value },
    });

    // Generate location updates along the path (5 updates during transit)
    const numUpdates = 5;
    for (let i = 1; i <= numUpdates; i++) {
      const updateTime = new Date(shipmentStart.getTime() + (shipmentDuration * i) / (numUpdates + 1));
      const progress = i / (numUpdates + 1);
      const lat = farm.lat + (plant.lat - farm.lat) * progress;
      const lng = farm.lng + (plant.lng - farm.lng) * progress;

      shipmentLocationUpdates.push({
        id: `update-${shipmentLocationUpdates.length + 1}`,
        shipmentId: shipment.id,
        lat,
        lng,
        timestamp: updateTime,
      });

      events.push({
        id: `event-${eventCounter++}`,
        eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
        time: updateTime,
        type: 'shipment_location_update',
        lat,
        lng,
        payload: { shipmentId: shipment.shipmentId, progress: Math.round(progress * 100) },
        shipmentId: shipment.id,
      });
    }

    // Create shipment_arrived event
    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: shipmentEnd,
      type: 'shipment_arrived',
      lat: plant.lat,
      lng: plant.lng,
      payload: { shipmentId: shipment.shipmentId },
      shipmentId: shipment.id,
    });
    shipment.arrivedTime = shipmentEnd;
    shipment.status = 'arrived';
  }

  // Shipment 2: Processing to Warehouse (starts at 5s, duration 4s)
  if (processing.length > 0 && warehouses.length > 0) {
    const plant = processing[0];
    const warehouse = warehouses[0];
    const foodItem = foodItems[2];
    const shipmentStart = new Date(startTime.getTime() + 5000);
    const shipmentDuration = 4000;
    const shipmentEnd = new Date(shipmentStart.getTime() + shipmentDuration);
    
    const shipment: Shipment = {
      id: `shipment-${shipmentCounter++}`,
      shipmentId: `SH${String(shipmentCounter - 1).padStart(3, '0')}`,
      fromNodeId: plant.id,
      toNodeId: warehouse.id,
      startTime: shipmentStart,
      etaTime: shipmentEnd,
      status: 'in_transit',
      fromLat: plant.lat,
      fromLng: plant.lng,
      toLat: warehouse.lat,
      toLng: warehouse.lng,
      foodItem: foodItem.name,
      value: foodItem.value,
    };
    shipments.push(shipment);

    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: shipmentStart,
      type: 'shipment_created',
      lat: plant.lat,
      lng: plant.lng,
      payload: { shipmentId: shipment.shipmentId, fromNode: plant.name, toNode: warehouse.name },
      shipmentId: shipment.id,
    });

    // Location updates
    const numUpdates = 6;
    for (let i = 1; i <= numUpdates; i++) {
      const updateTime = new Date(shipmentStart.getTime() + (shipmentDuration * i) / (numUpdates + 1));
      const progress = i / (numUpdates + 1);
      const lat = plant.lat + (warehouse.lat - plant.lat) * progress;
      const lng = plant.lng + (warehouse.lng - plant.lng) * progress;

      shipmentLocationUpdates.push({
        id: `update-${shipmentLocationUpdates.length + 1}`,
        shipmentId: shipment.id,
        lat,
        lng,
        timestamp: updateTime,
      });

      events.push({
        id: `event-${eventCounter++}`,
        eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
        time: updateTime,
        type: 'shipment_location_update',
        lat,
        lng,
        payload: { shipmentId: shipment.shipmentId, progress: Math.round(progress * 100) },
        shipmentId: shipment.id,
      });
    }

    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: shipmentEnd,
      type: 'shipment_arrived',
      lat: warehouse.lat,
      lng: warehouse.lng,
      payload: { shipmentId: shipment.shipmentId },
      shipmentId: shipment.id,
    });
    shipment.arrivedTime = shipmentEnd;
    shipment.status = 'arrived';
  }

  // Shipment 3: Warehouse to NGO (starts at 11s, duration 5s)
  if (warehouses.length > 0 && ngos.length > 0) {
    const warehouse = warehouses[0];
    const ngo = ngos[0];
    const foodItem = foodItems[1];
    const shipmentStart = new Date(startTime.getTime() + 11000);
    const shipmentDuration = 5000;
    const shipmentEnd = new Date(shipmentStart.getTime() + shipmentDuration);
    
    const shipment: Shipment = {
      id: `shipment-${shipmentCounter++}`,
      shipmentId: `SH${String(shipmentCounter - 1).padStart(3, '0')}`,
      fromNodeId: warehouse.id,
      toNodeId: ngo.id,
      startTime: shipmentStart,
      etaTime: shipmentEnd,
      status: 'in_transit',
      fromLat: warehouse.lat,
      fromLng: warehouse.lng,
      toLat: ngo.lat,
      toLng: ngo.lng,
      foodItem: foodItem.name,
      value: foodItem.value,
    };
    shipments.push(shipment);

    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: shipmentStart,
      type: 'shipment_created',
      lat: warehouse.lat,
      lng: warehouse.lng,
      payload: { shipmentId: shipment.shipmentId, fromNode: warehouse.name, toNode: ngo.name },
      shipmentId: shipment.id,
    });

    // Create NGO request event before shipment
    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: new Date(startTime.getTime() + 10500),
      type: 'ngo_request',
      lat: ngo.lat,
      lng: ngo.lng,
      payload: { ngo: ngo.name, requestedFood: foodItem.name },
    });

    // Location updates
    const numUpdates = 7;
    for (let i = 1; i <= numUpdates; i++) {
      const updateTime = new Date(shipmentStart.getTime() + (shipmentDuration * i) / (numUpdates + 1));
      const progress = i / (numUpdates + 1);
      const lat = warehouse.lat + (ngo.lat - warehouse.lat) * progress;
      const lng = warehouse.lng + (ngo.lng - warehouse.lng) * progress;

      shipmentLocationUpdates.push({
        id: `update-${shipmentLocationUpdates.length + 1}`,
        shipmentId: shipment.id,
        lat,
        lng,
        timestamp: updateTime,
      });

      events.push({
        id: `event-${eventCounter++}`,
        eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
        time: updateTime,
        type: 'shipment_location_update',
        lat,
        lng,
        payload: { shipmentId: shipment.shipmentId, progress: Math.round(progress * 100) },
        shipmentId: shipment.id,
      });
    }

    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: shipmentEnd,
      type: 'shipment_arrived',
      lat: ngo.lat,
      lng: ngo.lng,
      payload: { shipmentId: shipment.shipmentId },
      shipmentId: shipment.id,
    });
    shipment.arrivedTime = shipmentEnd;
    shipment.status = 'arrived';
  }

  // Additional farm production events
  if (farms.length > 1) {
    events.push({
      id: `event-${eventCounter++}`,
      eventId: `EVT${String(eventCounter - 1).padStart(4, '0')}`,
      time: new Date(startTime.getTime() + 2000),
      type: 'farm_production',
      lat: farms[1].lat,
      lng: farms[1].lng,
      payload: { foodItem: foodItems[1].name, quantity: foodItems[1].value },
    });
  }

  return {
    nodes,
    shipments,
    events: events.sort((a, b) => a.time.getTime() - b.time.getTime()),
    shipmentLocationUpdates: shipmentLocationUpdates.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
  };
};

// Keep the old function for backward compatibility
export const generateSampleFoodData = (): FoodDataPoint[] => {
  const { nodes, events } = generateFoodTimelineData();
  
  return events.map((event, index) => ({
    id: event.id,
    name: `Event: ${event.type}`,
    lat: event.lat,
    lng: event.lng,
    timestamp: event.time,
    category: event.type.includes('farm') ? 'origin' : 
              event.type.includes('processing') ? 'production' :
              event.type.includes('warehouse') ? 'distribution' : 'consumption',
    description: `Event: ${event.type} at ${new Date(event.time).toLocaleTimeString()}`,
    value: 100,
  }));
};

