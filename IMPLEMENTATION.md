# Three-Service Food Supply Chain Implementation

## Architecture Overview

This implementation follows the hackathon architecture document with three services:

### Backend-A (Server/) - Primary API

- **Port**: 3001
- **Tech**: Node.js + Express + MongoDB + Socket.IO
- **Responsibilities**:
  - Core REST endpoints for batches, shipments, requests, nodes
  - History frame generation (`/api/history/day`, `/api/history/range`)
  - ML suggestion integration (`/api/suggest/for-batch`, `/api/suggest/for-region`)
  - Batch splitting logic with parent-child tracking
  - Real-time WebSocket updates via Socket.IO
  - Calls Backend-C for transport ETA calculations

### Backend-B (ml/) - ML Service

- **Port**: 3002
- **Tech**: Node.js wrapper + Python ML scripts
- **Responsibilities**:
  - Stateless prediction endpoint (`POST /api/predict`)
  - Demand forecasting per region
  - Anomaly detection (cluster analysis)
  - Transfer planning suggestions (`POST /api/transfers/plan`)

### Backend-C (mock-server/) - Simulator & Transport API

- **Port**: 5001
- **Tech**: Node.js + Express + MongoDB
- **Responsibilities**:
  - Deterministic transport ETA calculation (`GET /api/transport/time`)
  - Weather data generation (`GET /api/weather`)
  - Scenario simulation (`POST /api/scenario`)
  - Event generation for testing

## New Endpoints Implemented

### Backend-A (Server/)

#### Batches

```
POST   /api/batches                     - Create new batch
GET    /api/batches                     - List batches (filters: status, currentNode, foodType)
GET    /api/batches/:batchId            - Get single batch with freshness
GET    /api/batches/inventory/summary   - Inventory aggregation by node
```

#### Shipments

```
POST   /api/shipments                   - Create shipment (with batch splitting)
GET    /api/shipments                   - List shipments (filters: status, nodes, dates)
GET    /api/shipments/:id               - Get single shipment
PATCH  /api/shipments/:id/arrive        - Mark shipment as arrived
```

#### History

```
GET    /api/history/day?date=YYYY-MM-DD           - Single day frame
GET    /api/history/range?start=&end=             - Date range frames
```

#### Suggestions

```
GET    /api/suggest/for-batch/:batchId            - ML suggestions for batch
GET    /api/suggest/for-region/:regionId?date=    - ML predictions for region
```

### Backend-C (mock-server/)

#### Transport

```
GET    /api/transport/time?fromLat=&fromLon=&toLat=&toLon=&start_iso=
       Returns: {distance_km, travel_time_minutes, eta_iso, metadata}
```

#### Weather

```
GET    /api/weather?regionId=&date=
       Returns: {avg_temp_c, high_temp_c, low_temp_c, conditions}
```

## Key Features Implemented

### 1. Batch Splitting Logic

When creating a shipment, if a batch has more quantity than needed:

- Creates a child batch with `parentBatchId` reference
- Reduces parent batch quantity
- Maintains full history lineage
- Both batches share same `original_quantity_kg` and `originNode`

### 2. Freshness Calculation

Per architecture doc formula:

```javascript
freshnessPct = max(
  0,
  100 - (elapsed_hours / shelf_life_hours) * 100 * temp_factor,
);
temp_factor = 1 + max(0, (avg_temp_c - 20) / 10) * 0.5;
```

Applied in:

- `/api/batches/:batchId` endpoint
- `/api/history/day` frame generation
- Inventory summaries

### 3. Deterministic Transport ETA

Backend-C calculates travel time using:

- Haversine distance
- Average speed (60 km/h)
- Break intervals (0.5h every 4 hours)
- Night slow factor (1.2-1.4x if starting 8pm-6am)
- Seeded randomness for reproducibility

### 4. Socket.IO Real-Time Updates

Events emitted:

- `frame` - Complete state snapshot
- `shipment_update` - Shipment created/arrived
- `suggestion` - ML allocation suggestion
- `alert` - Errors or warnings

Clients subscribe by joining `live_updates` room.

### 5. ML Integration

- Builds snapshot from MongoDB (nodes, batches, requests, shipments)
- Calls Backend-B `/api/predict`
- Receives predictions with cluster IDs and anomaly scores
- Generates allocation suggestions based on demand patterns

## Data Models

### Enhanced Shipment Schema

```javascript
{
  shipmentId: String (unique),
  batchIds: [ObjectId],
  fromNode: ObjectId,
  toNode: ObjectId,
  start_iso: Date,
  eta_iso: Date,
  arrived_iso: Date,
  status: enum['pending', 'in_transit', 'arrived', 'delayed', 'cancelled'],
  vehicleId: String,
  travel_time_minutes: Number,
  distance_km: Number,
  breaks: [{ start_iso, end_iso, reason }],
  metadata: Object
}
```

### Batch Schema (existing, unchanged)

Key fields:

- `parentBatchId`: References parent if split
- `quantity_kg`: Current quantity
- `original_quantity_kg`: Initial quantity at creation
- `freshnessPct`: Cached freshness (recalculated on query)
- `status`: 'stored' | 'in_transit' | 'delivered' | 'spoiled' | 'reserved'
- `history`: Array of state transitions

## Environment Variables

### Backend-A (.env)

```
PORT=3001
MONGODB_URI=mongodb://localhost:27017/food_supply_chain
BACKEND_C_URL=http://localhost:5001
ML_SERVICE_URL=http://localhost:3002
FRONTEND_URL=http://localhost:3000
```

### Backend-B (.env)

```
PORT=3002
ARTIFACTS_DIR=./artifacts
PYTHON_BIN=python3
ROUTE_SERVICE_URL=http://localhost:5001
```

### Backend-C (.env)

```
PORT=5001
MONGO_URI=mongodb://localhost:27017/mock_server
```

## Running the Services

### 1. Start Backend-C (Transport & Simulation)

```bash
cd mock-server
npm install
npm start
```

### 2. Start Backend-B (ML Service)

```bash
cd ml
npm install
pip install -r requirements.txt
npm start
```

### 3. Start Backend-A (Primary API)

```bash
cd Server
npm install
npm run dev
```

### 4. Start Frontend (Next.js)

```bash
cd client
npm install
npm run dev
```

## Testing the Implementation

### 1. Test Backend-C Transport Endpoint

```bash
curl "http://localhost:5001/api/transport/time?fromLat=28.7041&fromLon=77.1025&toLat=19.0760&toLon=72.8777&start_iso=2026-02-01T10:00:00Z"
```

Expected response:

```json
{
  "distance_km": 1154.32,
  "travel_time_minutes": 1183,
  "eta_iso": "2026-02-01T29:43:00Z",
  "metadata": {
    "base_hours": 19.24,
    "breaks_count": 4,
    "break_hours": 2.0,
    "night_slow_factor": 1.0,
    "avg_speed_kmh": 60
  }
}
```

### 2. Create a Batch

```bash
curl -X POST http://localhost:3001/api/batches \
  -H "Content-Type: application/json" \
  -d '{
    "foodType": "rice",
    "quantity_kg": 500,
    "originNodeId": "NODE_ID_HERE",
    "shelf_life_hours": 720,
    "manufacture_date": "2026-02-01T00:00:00Z"
  }'
```

### 3. Create a Shipment (with batch splitting)

```bash
curl -X POST http://localhost:3001/api/shipments \
  -H "Content-Type: application/json" \
  -d '{
    "fromNodeId": "WAREHOUSE_ID",
    "toNodeId": "NGO_ID",
    "items": [
      {"foodType": "rice", "quantity_kg": 200}
    ],
    "startTime": "2026-02-01T10:00:00Z"
  }'
```

### 4. Get History Frame

```bash
curl "http://localhost:3001/api/history/day?date=2026-02-01"
```

Expected response structure:

```json
{
  "date": "2026-02-01",
  "timestamp": "2026-02-01T23:59:59.999Z",
  "nodes": [{
    "id": "...",
    "nodeId": "...",
    "name": "...",
    "type": "warehouse",
    "lat": 28.7041,
    "lng": 77.1025,
    "stored_kg": 1500,
    "batch_count": 5
  }],
  "batches": [...],
  "shipments": [...],
  "events": [...],
  "kpis": {
    "fulfilled_requests": 10,
    "total_requests": 15,
    "fulfillment_rate": 66.67,
    "spoiled_kg": 50,
    "avg_delivery_time_minutes": 320,
    "total_shipments": 25,
    "active_shipments": 5
  }
}
```

### 5. Test Socket.IO (from browser console)

```javascript
const socket = io("http://localhost:3001");
socket.emit("subscribe_today", { nodeIds: [] });
socket.on("frame", (data) => console.log("Frame:", data));
socket.on("shipment_update", (data) => console.log("Shipment:", data));
```

## Utilities Created

### Server/src/utils/

- **geoHelpers.js**: `haversineDistanceKm()`, `extractCoordinates()`
- **freshness.js**: `calculateFreshnessPct()`, `isSpoiled()`, `remainingShelfLifeHours()`
- **snapshotBuilder.js**: `buildMLSnapshot()` for Backend-B integration

### mock-server/src/utils/

- **seeding.js**: `seedRandom()`, `seededRandomInRange()`, `seededRandomInt()`

## Next Steps (Not Yet Implemented)

### Frontend Components

1. **History Player** (`client/src/components/HistoryPlayer.tsx`)
   - Date range picker
   - Play/pause/speed controls
   - Frame scrubbing slider
   - Passes frames to existing MapTimeline component

2. **Socket.IO Integration** (`client/src/hooks/useSocketFrames.ts`)
   - Connect to Backend-A WebSocket
   - Subscribe to `frame` events
   - Store latest frame in state
   - Toggle between live and replay modes

3. **History Service** (`client/src/services/historyService.ts`)
   - `fetchDay(date)` - GET /api/history/day
   - `fetchRange(start, end)` - GET /api/history/range
   - Cache frames for smooth playback

### Demo Data Seeding

Create `Server/scripts/seed-demo-data.js`:

- 5 farm nodes (different states)
- 3 warehouse nodes
- 2 NGO nodes
- 50 batches distributed across warehouses
- 10 NGO requests (5 fulfilled, 5 pending)
- 15 shipments (10 arrived, 5 in transit)
- 100+ events spanning 7 days

### Additional Features

1. **Request fulfillment workflow**: Auto-create shipments when requests are approved
2. **Spoilage detection cron**: Daily job to mark batches with freshness <= 0 as spoiled
3. **ML-driven pre-positioning**: Use predictions to suggest proactive transfers
4. **Multi-leg shipments**: Support warehouse-to-warehouse then warehouse-to-NGO routing
5. **Capacity constraints**: Validate shipments don't exceed warehouse capacity

## Architecture Compliance

✅ **Backend-A**: Core REST endpoints, MongoDB persistence, calls Backend-B and Backend-C  
✅ **Backend-B**: Stateless ML prediction (existing endpoint verified)  
✅ **Backend-C**: Deterministic transport ETA, weather data, seeded randomness  
✅ **Batch Splitting**: Parent-child tracking, quantity updates, history preservation  
✅ **Freshness Calculation**: Formula per architecture doc, temperature factors  
✅ **Socket.IO**: Real-time frame broadcasting, client subscription  
✅ **History Frames**: Daily snapshots with nodes, batches, shipments, events, KPIs  
⏳ **Frontend**: History player and WebSocket client (pending)  
⏳ **Demo Data**: Seed script (pending)

## Troubleshooting

### Common Issues

**1. Backend-A can't reach Backend-C**

- Ensure Backend-C is running on port 5001
- Check `BACKEND_C_URL` in Backend-A .env
- Verify no firewall blocking localhost:5001

**2. ML predictions fail**

- Ensure ML service is running on port 3002
- Check that model artifacts exist in `ml/artifacts/`
- Verify Python dependencies installed: `pip install -r requirements.txt`

**3. Socket.IO connection refused**

- Check CORS configuration in `Server/index.js`
- Verify `FRONTEND_URL` env variable matches frontend origin
- Ensure client uses `http://` protocol, not `https://` for local dev

**4. Freshness calculation shows NaN**

- Verify batch has `manufacture_date` and `shelf_life_hours`
- Check that date parsing succeeds (valid ISO strings)
- Ensure `avgTemp` parameter is numeric

## File Structure Summary

```
Server/
├── src/
│   ├── controllers/
│   │   ├── batch.controller.js         ✨ NEW
│   │   ├── shipment.controller.js      ✨ NEW
│   │   ├── history.controller.js       ✨ NEW
│   │   └── suggest.controller.js       ✨ NEW
│   ├── routes/
│   │   ├── batch.route.js             ✨ NEW
│   │   ├── shipment.route.js          ✨ NEW
│   │   ├── history.route.js           ✨ NEW
│   │   └── suggest.route.js           ✨ NEW
│   ├── models/
│   │   └── shipment.model.js          ✅ ENHANCED
│   ├── services/
│   │   └── frameEmitter.js            ✨ NEW
│   ├── utils/
│   │   ├── geoHelpers.js              ✨ NEW
│   │   ├── freshness.js               ✨ NEW
│   │   └── snapshotBuilder.js         ✨ NEW
│   ├── app.js                         ✅ UPDATED (routes mounted)
│   └── index.js                       ✅ UPDATED (Socket.IO)
└── package.json                       ✅ UPDATED (socket.io)

mock-server/
├── src/
│   ├── controllers/
│   │   ├── transportController.js     ✨ NEW
│   │   └── weatherController.js       ✨ NEW
│   ├── routes/
│   │   ├── transportRoutes.js         ✨ NEW
│   │   └── weatherRoutes.js           ✨ NEW
│   ├── utils/
│   │   └── seeding.js                 ✨ NEW
│   └── server.js                      ✅ UPDATED (routes mounted)
```

## Credits

Implementation follows the **Hackathon Architecture Document** specifications for a three-service food supply chain system with deterministic simulation, ML-driven predictions, and real-time WebSocket updates.
