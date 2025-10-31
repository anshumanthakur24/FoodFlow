// Data models matching the backend structure

export type UserRole = 'farm_rep' | 'warehouse_mgr' | 'ngo' | 'admin';
export type NodeType = 'farm' | 'warehouse' | 'ngo' | 'processing';
export type BatchStatus = 'stored' | 'in_transit' | 'delivered' | 'spoiled' | 'reserved';
export type ShipmentStatus = 'in_transit' | 'arrived' | 'delayed' | 'cancelled';
export type EventType = 
  | 'farm_production' 
  | 'ngo_request' 
  | 'shipment_created' 
  | 'shipment_arrived' 
  | 'shipment_location_update'
  | 'batch_spoiled' 
  | 'prediction_made';

export interface Location {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Node {
  nodeId: string;
  type: NodeType;
  name: string;
  regionId: string;
  location: Location;
  capacity_kg: number;
  contact?: string;
}

export interface BatchHistoryEntry {
  time: Date;
  action: string;
  from: string | null;
  to: string | null;
  note?: string;
}

export interface Batch {
  batchId: string;
  parentBatchId: string | null;
  foodType: string;
  quantity_kg: number;
  original_quantity_kg: number;
  originNode: string;
  currentNode: string | null;
  status: BatchStatus;
  shelf_life_hours: number;
  manufacture_date: Date;
  expiry_iso: Date;
  initial_temp_c?: number;
  freshnessPct: number;
  history: BatchHistoryEntry[];
  metadata?: Record<string, any>;
}

export interface ShipmentBreak {
  start_iso: Date;
  end_iso: Date;
  reason: string;
}

export interface Shipment {
  shipmentId: string;
  batchIds: string[];
  fromNode: string;
  toNode: string;
  start_iso: Date;
  eta_iso: Date;
  arrived_iso: Date | null;
  status: ShipmentStatus;
  vehicleId?: string;
  travel_time_minutes: number;
  breaks: ShipmentBreak[];
  createdBy: string;
  latest_location?: {
    coordinates: [number, number]; // [lon, lat]
    timestamp: Date;
  };
}

export interface ShipmentLocation {
  shipmentId: string;
  timestamp: Date;
  coordinates: [number, number]; // [longitude, latitude]
  speed_kmh?: number;
  eta_iso?: Date;
}

export interface Event {
  eventId: string;
  time: Date;
  type: EventType;
  location: Location;
  payload: Record<string, any>; // Contains nodeId, shipmentId, batchId, etc. based on event type
}

