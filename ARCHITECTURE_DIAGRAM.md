# Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (Next.js)                            │
│                        Port 3000 - React + Leaflet                     │
├────────────────────────────────────────────────────────────────────────┤
│  Components:                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐         │
│  │ MapTimeline  │  │HistoryPlayer │  │ useSocketFrames      │         │
│  │  (existing)  │  │  (pending)   │  │ (Socket.IO client)   │         │
│  └──────────────┘  └──────────────┘  └──────────────────────┘         │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP REST + WebSocket (Socket.IO)
                              ↓
┌────────────────────────────────────────────────────────────────────────┐
│                    BACKEND-A (Primary API Server)                      │
│                  Port 3001 - Express + MongoDB + Socket.IO             │
├────────────────────────────────────────────────────────────────────────┤
│  REST Endpoints:                                                       │
│  ┌─────────────────┬─────────────────┬─────────────────┐              │
│  │ /api/batches    │ /api/shipments  │ /api/history    │              │
│  │ • POST create   │ • POST create   │ • GET /day      │              │
│  │ • GET list      │ • GET list      │ • GET /range    │              │
│  │ • GET /:id      │ • GET /:id      │                 │              │
│  │ • GET /summary  │ • PATCH /arrive │                 │              │
│  └─────────────────┴─────────────────┴─────────────────┘              │
│                                                                         │
│  ┌─────────────────┐                                                   │
│  │ /api/suggest    │    Socket.IO Events:                             │
│  │ • GET /for-batch│    • frame (state snapshots)                     │
│  │ • GET /for-reg. │    • shipment_update (create/arrive)             │
│  └─────────────────┘    • suggestion (ML recommendations)             │
│                         • alert (warnings/errors)                     │
│                                                                         │
│  Services & Utils:                                                     │
│  ┌──────────────┬─────────────┬──────────────┬──────────────┐         │
│  │ frameEmitter │ geoHelpers  │ freshness.js │ snapshot     │         │
│  │ (Socket.IO)  │ (distance)  │ (spoilage)   │ Builder      │         │
│  └──────────────┴─────────────┴──────────────┴──────────────┘         │
│                                                                         │
│  Data Models (MongoDB):                                                │
│  ┌──────┬─────────┬──────────┬─────────┬─────┬─────────┬────────┐    │
│  │ Node │ Batch   │ Shipment │ Request │ NGO │ Event   │ User   │    │
│  └──────┴─────────┴──────────┴─────────┴─────┴─────────┴────────┘    │
└────────────────────────────────────────────────────────────────────────┘
          │                                              │
          │ HTTP POST /predict                          │ HTTP GET
         │ (snapshot JSON)                             │ /api/transport/time
          ↓                                              ↓
┌─────────────────────────────┐    ┌────────────────────────────────────┐
│   BACKEND-B (ML Service)    │    │  BACKEND-C (Mock Server/Sim)       │
│   Port 5050                 │    │  Port 5001                         │
│   Node.js + Python          │    │  Express + MongoDB                 │
├─────────────────────────────┤    ├────────────────────────────────────┤
│  Endpoints:                 │    │  Endpoints:                        │
│  • POST /predict            │    │  • GET /api/transport/time         │
│    → Demand predictions     │    │    → Deterministic ETA calc        │
│    → Cluster assignments    │    │  • GET /api/weather                │
│    → Anomaly scores         │    │    → Temperature data              │
│  • POST /transfers/plan     │    │  • POST /api/scenario              │
│    → Warehouse allocations  │    │    → Event generation              │
│  • GET /runs                │    │                                    │
│    → Model metadata         │    │  Utils:                            │
│                             │    │  • seeding.js (deterministic)      │
│  Python Scripts:            │    │  • geo.js (haversine)              │
│  • infer.py                 │    │  • scenarioManager.js              │
│  • train.py                 │    │                                    │
│  • feature_engineering.py   │    │                                    │
└─────────────────────────────┘    └────────────────────────────────────┘
          │
          │ Loads trained models
          ↓
┌─────────────────────────────┐
│   ML Artifacts (offline)    │
│   ml/artifacts/             │
├─────────────────────────────┤
│  • kmeans_model.joblib      │
│  • isolation_forest.joblib  │
│  • aggregated_features.csv  │
│  • metadata.json            │
└─────────────────────────────┘
```

## Data Flow Examples

### 1. Create Shipment (with Batch Splitting)

```
Frontend                Backend-A                Backend-C               MongoDB
   │                        │                        │                     │
   │─POST /api/shipments───→│                        │                     │
   │  {fromNode, toNode,    │                        │                     │
   │   items: [{rice:200}]} │                        │                     │
   │                        │                        │                     │
   │                        │─Query stored batches──→│                     │
   │                        │←[Batch{rice:500kg}]────│                     │
   │                        │                        │                     │
   │                        │─Split batch (200/300)─→│                     │
   │                        │  Create child batch    │                     │
   │                        │←Child batch ID─────────│                     │
   │                        │                        │                     │
   │                        │─GET /api/transport/───→│                     │
   │                        │  time?from=A&to=B      │                     │
   │                        │←{distance:120km,───────│                     │
   │                        │  eta:2h}               │                     │
   │                        │                        │                     │
   │                        │─Create shipment doc───→│                     │
   │                        │─Update batch status───→│                     │
   │                        │─Create event──────────→│                     │
   │                        │                        │                     │
   │                        │─Emit Socket.IO─────────→ (all clients)       │
   │                        │  'shipment_update'     │                     │
   │←Shipment created───────│                        │                     │
   │  {shipmentId, eta}     │                        │                     │
```

### 2. History Frame Query

```
Frontend                Backend-A                Backend-B               MongoDB
   │                        │                        │                     │
   │─GET /api/history/day──→│                        │                     │
   │  ?date=2026-02-01      │                        │                     │
   │                        │                        │                     │
   │                        │─Query nodes───────────→│                     │
   │                        │─Query batches─────────→│                     │
   │                        │─Query shipments───────→│                     │
   │                        │─Query events──────────→│                     │
   │                        │                        │                     │
   │                        │←Raw data───────────────│                     │
   │                        │                        │                     │
   │                        │ Calculate freshness    │                     │
   │                        │ Aggregate inventory    │                     │
   │                        │ Compute KPIs           │                     │
   │                        │ Transform to frontend  │                     │
   │                        │   format (lat/lng)     │                     │
   │                        │                        │                     │
   │←Frame JSON─────────────│                        │                     │
   │  {nodes, batches,      │                        │                     │
   │   shipments, events,   │                        │                     │
   │   kpis}                │                        │                     │
```

### 3. ML Suggestion Flow

```
Frontend            Backend-A           Backend-B           MongoDB
   │                    │                   │                 │
   │─GET /api/suggest──→│                   │                 │
   │  /for-batch/123    │                   │                 │
   │                    │                   │                 │
   │                    │─Query batch───────→                 │
   │                    │←Batch data────────│                 │
   │                    │                   │                 │
   │                    │─Build snapshot────→                 │
   │                    │  (nodes, batches, │                 │
   │                    │   requests, etc)  │                 │
   │                    │                   │                 │
   │                    │─POST /predict─────→                 │
   │                    │  {snapshot JSON}  │                 │
   │                    │                   │                 │
   │                    │                   │─Load models─────┤
   │                    │                   │─Infer.py────────┤
   │                    │                   │                 │
   │                    │←Predictions───────│                 │
   │                    │  [{cluster_id,    │                 │
   │                    │    anomaly_score, │                 │
   │                    │    district}]     │                 │
   │                    │                   │                 │
   │                    │ Generate          │                 │
   │                    │ allocations       │                 │
   │                    │ (top 5 regions)   │                 │
   │                    │                   │                 │
   │←Suggestions────────│                   │                 │
   │  [{regionId,       │                   │                 │
   │    confidence,     │                   │                 │
   │    reason}]        │                   │                 │
```

## Key Design Decisions

### 1. Batch Splitting Strategy

- **Parent-Child Relationship**: Uses `parentBatchId` field to track lineage
- **Quantity Management**: Both parent and child update quantities, sum equals original
- **Shared Metadata**: Manufacture date, origin node, shelf life preserved
- **History Trail**: Each split operation logged in both batch histories

### 2. Freshness Calculation

- **On-Demand Computation**: Calculated at query time, not stored (except as cache)
- **Temperature Factor**: Accelerates spoilage above 20°C threshold
- **Deterministic**: Same batch + date + temp always yields same freshness
- **Used In**: History frames, batch details, inventory summaries

### 3. Socket.IO Architecture

- **Room-Based**: Clients join `live_updates` room on subscription
- **Event Types**: Frame (full state), shipment_update (incremental), suggestion, alert
- **Broadcasting**: Server → All clients in room (no unicast needed)
- **Integration**: `io` instance stored in Express app for controller access

### 4. History Frame Approach

- **Snapshot-Based**: Query state at specific timestamp, not event replay
- **Frontend Format**: Transforms MongoDB GeoJSON to lat/lng pairs
- **KPI Calculation**: Aggregates fulfillment rate, spoilage, delivery times
- **Caching Strategy**: (Not implemented) Could cache daily frames for performance

### 5. ML Integration Pattern

- **Stateless Calls**: No session state in Backend-B
- **Snapshot Building**: Backend-A prepares data in expected format
- **Graceful Degradation**: Returns 503 if ML service unavailable
- **Simple Allocation**: Distance-based scoring (can be enhanced)

## Performance Considerations

### Database Indexes

- **Shipment**: `{status: 1, start_iso: 1}`, `{fromNode: 1, toNode: 1}`
- **Batch**: `{currentNode: 1, status: 1, foodType: 1}` (for allocation queries)
- **Event**: `{time: 1, location: '2dsphere'}` (existing)
- **Node**: `{location: '2dsphere'}` (existing)

### Optimization Opportunities

1. **History Frames**: Pre-compute and cache daily frames (reduce DB queries)
2. **Inventory Summary**: Materialized view or aggregation pipeline
3. **Freshness**: Store computed values with batch, update on shipment events
4. **ML Calls**: Batch predictions for multiple regions in single request
5. **Socket.IO**: Redis adapter for horizontal scaling (multi-instance)

## Security Notes

### Authentication (Not Implemented)

- Current endpoints are **unauthenticated**
- For production, add JWT middleware to protect routes
- Socket.IO needs authentication handshake

### Input Validation

- Basic validation in controllers (required fields, date formats)
- No schema validation library (consider Joi or Zod)
- SQL injection not a risk (using MongoDB)

### Rate Limiting

- Not implemented
- Consider `express-rate-limit` for API endpoints
- Socket.IO connection limits needed for production
