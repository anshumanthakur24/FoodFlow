# FoodFlow (ThreeService) — Project Deep Dive

This document is a **single, source-backed explanation of the whole system**: the “why”, the architecture, the data model, the key algorithms (Regular vs ML), every API surface, and how the frontend drives it.

> Note on doc drift: some older docs/references in the repo mention an ML port of **3002**. The current Docker Compose configuration exposes ML on **5050** and Backend-A defaults for ML calls also use **5050**. This doc treats **docker-compose.yml** as the canonical deployment.

See also: `ML_SERVER_EXPLAINED.md` (beginner-friendly explanation of the ML gateway + Python pipeline, feature engineering, models, and how freshness relates).

## Table of Contents

- [1. What this project is solving](#1-what-this-project-is-solving)
- [2. Architecture and services](#2-architecture-and-services)
- [3. How to run it (Docker vs local)](#3-how-to-run-it-docker-vs-local)
- [3.1 Environment variables (what matters)](#31-environment-variables-what-matters)
- [4. Data model (MongoDB)](#4-data-model-mongodb)
- [5. Core calculations and algorithms](#5-core-calculations-and-algorithms)
- [6. Backend-A (Server/) — REST + Socket.IO API](#6-backend-a-server--rest--socketio-api)
- [7. Backend-B (ml/) — ML gateway API](#7-backend-b-ml--ml-gateway-api)
- [8. Backend-C (mock-server/) — scenario + transport API](#8-backend-c-mock-server--scenario--transport-api)
- [8.1 test-server (optional)](#81-test-server-optional)
- [9. Frontend (client/) — pages, components, and API call sites](#9-frontend-client--pages-components-and-api-call-sites)
- [10. End-to-end workflows (story mode)](#10-end-to-end-workflows-story-mode)
- [11. Known quirks, mismatches, and troubleshooting](#11-known-quirks-mismatches-and-troubleshooting)

---

## 1. What this project is solving

Food distribution networks (farms → warehouses → NGOs/beneficiaries) have two hard problems:

1. **Matching supply to demand** under uncertainty and spikes (festivals, disasters, seasonal shifts).
2. **Preventing waste** in a perishable supply chain where each hour of delay reduces freshness.

FoodFlow’s core idea:

- Maintain an **event-driven operational picture** (nodes, batches, requests, shipments, events).
- Provide a baseline **rule-based allocator** (“Regular”) to act as a realistic comparison.
- Provide an **ML-assisted allocator** (“ML”) that:
  - Uses demand/anomaly signals from the ML service when available.
  - **Optimizes allocations for delivery-time freshness and distance**, rather than “nearest only”.
- Provide **history frames + simulations** so the UI can replay and compare strategies.

The key “judge-friendly” KPI is: **food saved that would otherwise go bad**, approximated in the system as “delivered quantity whose freshness-at-delivery drops to 0% (spoiled)”.

---

## 2. Architecture and services

See also: `ARCHITECTURE_DIAGRAM.md`.

### Service map (canonical: Docker Compose)

From `docker-compose.yml`:

- **MongoDB**: `mongo` (port `27017`)
- **Backend-C**: `mock-server` (port `5001`) — scenario + transport time
- **Backend-B**: `ml` (port `5050`) — Node gateway that runs Python inference
- **Backend-A**: `server` (port `3001`) — Express REST API + Socket.IO
- **Frontend**: `client` (port `3000`) — Next.js admin + map timelines

Also present in the repo (optional tooling):

- **test-server**: `test-server/` — a tiny receiver service used for integration-style testing / event collection.

Repo naming note (Windows/macOS can behave differently here):

- `Server/` (capital S) is the **current primary API** used by Docker Compose.
- `server/` (lowercase) is a separate Node project that also contains Python files; treat it as **legacy/experimental** unless you explicitly wire it into your run.

### Who calls who

- `client` → `server` via REST (and optionally Socket.IO)
- `server` → `mock-server` for ETA/transport time during shipment creation
- `server` → `ml` for:
  - `/predict` (regional anomaly/demand signals, optional)
  - `/transfers/plan` (transfer planning)

---

## 3. How to run it (Docker vs local)

### Option A: Docker Compose (recommended)

From repo root:

```bash
docker compose up --build
```

Expected ports:

- Frontend: http://localhost:3000
- Server API: http://localhost:3001
- Mock-server: http://localhost:5001
- ML service: http://localhost:5050
- MongoDB: mongodb://localhost:27017

### 3.1 Environment variables (what matters)

Canonical Docker values come from:

- `docker-compose.yml`
- `Server/.env.docker`
- `ml/.env.docker`

Backend-A (`Server/.env.docker`):

- `PORT=3001`
- `MONGODB_URI=mongodb://mongo:27017/arcanix`
- `SIMULATION_BASE_URL=http://ml:5050` (used by `/api/ml/*` endpoints)
- `SCENARIO_BASE_URL=http://mock-server:5001/api`

Backend-B (`ml/.env.docker`):

- `ML_SERVER_PORT=5050`
- `PYTHON_BIN=/opt/venv/bin/python`
- `ROUTE_SERVICE_URL=https://router.project-osrm.org`
- `FESTIVAL_FEATURES_CSV`, `INCOME_FEATURES_CSV` (feature enrichment)
- ML hyperparameters (`ML_KMEANS_CLUSTERS`, `ML_IFOREST_CONTAMINATION`, ...)

Frontend (`docker-compose.yml`):

- `NEXT_PUBLIC_API_URL=http://server:3001`

Mock-server (`docker-compose.yml`):

- `PORT=5001`
- `MONGO_URI=mongodb://mongo:27017/arcanix`
- `MAIN_API_URL=http://server:3001`

### Option B: Local multi-terminal dev

Existing docs: `QUICKSTART.md` and `IMPLEMENTATION.md` outline local start.

Be aware of port drift:

- Compose uses ML on **5050**.
- Some docs mention ML on **3002**.

To run locally, keep these aligned:

- Set Server’s ML base URL to `http://localhost:5050` (or change ML to 3002 consistently).

---

## 4. Data model (MongoDB)

Backend-A uses Mongoose models in `Server/src/models/`.

### 4.1 Node

File: `Server/src/models/node.model.js`

Represents a physical location in the logistics network.

Key fields:

- `type`: `farm | warehouse | ngo`
- `name`: display name
- `regionId`: coarse region identifier (often used as “state” fallback)
- `district`: district string
- `location`: GeoJSON Point (`coordinates: [lng, lat]`)
- `capacity_kg`: optional capacity

Indexes:

- `location` has a `2dsphere` index.

### 4.2 NGO (organization)

File: `Server/src/models/NGO.model.js`

Represents an NGO organization (distinct from a Node). A key design choice:

- Requests point to an **NGO org** document.
- Allocation logic maps NGO org → NGO node by matching **name**.

Key fields:

- `name`, `address`
- `contactInfo`
- `requestStats` (pending/approved/completed/etc.)

### 4.3 Request

File: `Server/src/models/request.model.js`

Represents demand from an NGO.

Key fields:

- `requesterNode`: ref to `NGO` (org)
- `requestID`: string id (note casing)
- `items`: `[{ foodType, required_kg }]`
- `createdOn`, `requiredBefore`
- `status`: `fulfilled | pending | cancelled | approved`
- `fulfilledBy`: ref to `Node` (who fulfilled)

### 4.4 Batch

File: `Server/src/models/batch.model.js`

Represents inventory units that can be stored, shipped, split, and delivered.

Key fields:

- `foodType`, `quantity_kg`, `original_quantity_kg`
- `originNode` (ref Node), `currentNode` (ref Node)
- `status`: `stored | in_transit | delivered | spoiled | reserved`
- `parentBatchId`: lineage tracking when a batch is split
- Perishability:
  - `shelf_life_hours`
  - `manufacture_date`
  - `freshnessPct` (cached / baseline; real freshness is computed by utilities)
- `history[]`: audit trail of transitions

### 4.5 Shipment

File: `Server/src/models/shipment.model.js`

Represents movement from one Node to another.

Key fields:

- `shipmentId` (unique)
- `batchIds[]`
- `fromNode`, `toNode`
- Timing: `start_iso`, `eta_iso`, `arrived_iso`
- `status`: `pending | in_transit | arrived | delayed | cancelled`
- Transport metrics: `travel_time_minutes`, `distance_km`, `breaks[]`
- `metadata.items` is used by history formatting to display food type and total shipped weight

### 4.6 Event

File: `Server/src/models/event.model.js`

Event stream entries used for timelines and state reasoning.

Types include:

- `farm_production`
- `ngo_request`
- `shipment_created`, `shipment_arrived`
- `shipment_location_update`
- `batch_spoiled`
- `prediction_made`

### 4.7 Prediction / User

- `Prediction` stores ML predictions (not heavily used by the current UI).
- `User` exists for role modeling (auth not implemented for most endpoints).

---

## 5. Core calculations and algorithms

### 5.1 Freshness (spoilage proxy)

Utility: `Server/src/utils/freshness.js`

Used throughout:

- History frames (`/api/history/day`, `/api/history/range`)
- Simulation metrics (“delivered freshness”, “spoiled at delivery”, “at-risk”)
- ML allocator scoring (freshness-at-delivery thresholds)

Conceptually:

- Freshness decreases with elapsed time since `manufacture_date`.
- Spoilage in metrics is currently a strict threshold: **freshness-at-delivery ≤ 0%**.
- “At risk” is **freshness-at-delivery < 20%**.

### 5.2 Transport time

- Real shipments (`POST /api/shipments`) call Backend-C:
  - `GET /api/transport/time?fromLat=&fromLon=&toLat=&toLon=&start_iso=`
- Simulated shipments approximate travel time from distance using an average speed + break model.

### 5.3 Regular allocation (baseline)

Implemented in: `Server/src/services/simulationService.js` → `allocateRegular()`

High-level behavior:

- For each request:
  - Map Request’s NGO org → NGO node (match by name).
  - Find nearest warehouse (Haversine distance).
  - Allocate using FIFO batch selection (oldest manufacture date first) from that warehouse.

This is “reactive and local”: it does not look at demand hotspots or delivery freshness.

### 5.4 ML allocation (optimization)

Implemented in: `Server/src/services/simulationService.js` → `allocateML()`

Key ideas:

- Optional demand/anomaly signals:
  - Builds a snapshot and calls `POST ${ML_SERVICE_URL}/predict`.
  - Converts results into a `regionalSignals` map.
  - If ML is unavailable, the allocator still works (signals are optional).

- For each request + item:
  - Evaluate **every warehouse** as a candidate.
  - Estimate travel time and compute **freshness-at-delivery** for candidate batches.
  - Apply minimum delivered freshness thresholds:
    - `ML_MIN_DELIVERED_FRESHNESS_PCT` (default ~55)
    - `ML_RELAXED_MIN_DELIVERED_FRESHNESS_PCT` (default ~25)
  - Score warehouse using a composite:
    - distance (exponential penalty)
    - delivered freshness
    - “expiry pressure” (waste-avoidance)
    - fulfillment ratio
    - urgency boost if region is anomaly

Result: more deliveries arrive fresher and/or with less waste, not merely closer.

### 5.5 Simulation metrics

Implemented in: `Server/src/controllers/history.controller.js` → `calcMetrics()`

Computed fields include:

- `totalAllocated`, `avgDistance`, `avgFreshness`, `fulfillmentRate`
- Delivery-time metrics:
  - `deliveredKg`
  - `deliveredAvgFreshness`
  - `deliveredSpoiledKg` (freshness-at-delivery ≤ 0)
  - `deliveredAtRiskKg` (freshness-at-delivery < 20)

---

## 6. Backend-A (Server/) — REST + Socket.IO API

Server app mounts routes in `Server/src/app.js`.

Base URL (local): `http://localhost:3001`

### 6.1 Nodes

Mounted: `/api/v1/node`

Routes (`Server/src/routes/node.route.js`):

- `GET /api/v1/node/getAllDistricts`
- `GET /api/v1/node/getAllNodes?page=&limit=`
- `GET /api/v1/node/district/:district?page=&limit=`
- `POST /api/v1/node/addNewNode`
- `DELETE /api/v1/node/deleteNode/:id`

### 6.2 NGOs + Requests

Mounted:

- `/api/v1/ngo` (NGO list)
- `/api/v1/request` (request CRUD)

Routes (`Server/src/routes/ngo.route.js`):

- `GET /api/v1/ngo/` → list NGOs
- `GET /api/v1/request/all?page=&limit=&status=` → list requests
- `POST /api/v1/request/createRequest` → create NGO request
- `PATCH /api/v1/request/:requestID/status` → update request status
- `GET /api/v1/request/getAllRequets/:ngoId?page=&limit=&status=` → list requests for NGO org

Important nuance:

- `:requestID` in the PATCH route is treated as a Mongo `_id` in controller logic.

### 6.3 Events ingestion

Mounted: `/api/v1/event`

Routes (`Server/src/routes/event.route.js`):

- `POST /api/v1/event/farm`
- `POST /api/v1/event/request`
- `POST /api/v1/event/shipment`

`POST /api/v1/event/farm` is an event store endpoint. For certain event types it also creates domain entities:

- `farm_production` → creates a Batch
- `ngo_request` → creates a Request

### 6.4 Batches

Mounted: `/api/batches`

Routes (`Server/src/routes/batch.route.js`):

- `POST /api/batches`
- `GET /api/batches?status=&currentNode=&foodType=&originNode=&page=&limit=`
- `GET /api/batches/inventory/summary?nodeId=`
- `GET /api/batches/:batchId`

### 6.5 Shipments

Mounted: `/api/shipments`

Routes (`Server/src/routes/shipment.route.js`):

- `POST /api/shipments` (batch splitting + ETA lookup)
- `GET /api/shipments` (filters)
- `GET /api/shipments/:id`
- `PATCH /api/shipments/:id/arrive`

### 6.6 History + comparison + simulation

Mounted: `/api/history`

Routes (`Server/src/routes/history.route.js`):

- `GET /api/history/day?date=YYYY-MM-DD` → daily snapshot
- `GET /api/history/range?start=YYYY-MM-DD&end=YYYY-MM-DD` → multiple frames
- `GET /api/history/compare?date=YYYY-MM-DD` → compare strategies (allocations + summary)
- `GET /api/history/simulate?date=YYYY-MM-DD` → strategy allocations formatted for visualization

In practice, the admin comparison pages use `/api/history/simulate`.

### 6.7 ML proxy endpoints

Mounted: `/api/ml`

Routes (`Server/src/routes/model.route.js`):

- `POST /api/ml/sendData` → sends Mongo snapshot (or records) to ML `/predict`
- `POST /api/ml/:requestID/status` → requests `/transfers/plan` from ML service

### 6.8 Suggestions

Mounted: `/api/suggest`

Routes (`Server/src/routes/suggest.route.js`):

- `GET /api/suggest/for-batch/:batchId`
- `GET /api/suggest/for-region/:regionId?date=`

Note: `suggest.controller.js` still defaults ML base URL to port `3002`; this is one place where Compose (5050) vs docs (3002) can diverge.

### 6.9 Start Mock scenario

- `POST /api/v1/startMock`

This triggers a scenario run via mock-server (used for event generation / demo flows).

### 6.10 Socket.IO real-time updates

Backend-A initializes Socket.IO in `Server/index.js` and stores the `io` instance on the Express app (`app.set("io", io)`) so controllers can emit updates.

The real-time channel is used for “live mode” updates (as opposed to history snapshots).

Events you will see emitted (see `Server/src/services/frameEmitter.js` and controllers like shipment creation/arrival):

- `frame` — state snapshot payload (when emitting frames)
- `shipment_update` — incremental updates when shipments are created/arrived
- `suggestion` — ML recommendation payloads
- `alert` — warnings/errors

Client subscriptions are room-based (commonly `live_updates`). Some docs reference a `subscribe_today` message flow; treat the server code as the source of truth for the current handshake.

### 6.11 Map route (placeholder)

Mounted: `/api/v1/map`

The route file exists (`Server/src/routes/map.routes.js`) but is currently a placeholder/no-op in the implementation.

---

## 7. Backend-B (ml/) — ML gateway API

Entry: `ml/server/app.js`

Base URL (Compose): `http://localhost:5050`

Endpoints:

- `GET /health` → reports artifacts dir, available runs, Python bin, route service URL
- `GET /runs` → list available trained runs
- `GET /runs/:runId/metadata` → metadata for a run
- `POST /predict`
  - Accepts either:
    - `records: [...]` (already-featurized rows), OR
    - raw Server-shaped arrays: `nodes/requests/shipments/batches`
  - Uses the latest run (or requested runId) and calls Python inference via `pythonRunner`
- `POST /transfers/plan`
  - Produces inter-warehouse transfer suggestions (calls Python + optional route estimation)

Artifacts:

- `ml/artifacts/<runId>/...` contains models and metadata.

---

## 8. Backend-C (mock-server/) — scenario + transport API

Base URL: `http://localhost:5001`

This service provides:

- Transport time calculation: `GET /api/transport/time`
- Weather stubs: `GET /api/weather`
- Scenario generation endpoints (`/api/scenario/...`) used for demo automation

The primary Server dependency is transport time, used during shipment creation.

For more detail on scenario endpoints and payload shapes, see `mock-server/docs/usage.md` and the routes/controllers under `mock-server/src/routes/` and `mock-server/src/controllers/`.

---

## 8.1 test-server (optional)

Folder: `test-server/`

This is a minimal Node server used to receive and log posted events/objects during testing. It’s not wired into Docker Compose by default, but it’s useful when you want to:

- simulate “external integrations” that consume farm/shipment/request events
- validate your pipeline without standing up a full downstream system

---

## 9. Frontend (client/) — pages, components, and API call sites

The frontend is a Next.js App Router project.

### 9.1 Environment variables

Most API calls should be driven via:

- `NEXT_PUBLIC_API_URL` (recommended: `http://localhost:3001` for local, `http://server:3001` inside Compose)

### 9.2 Client service wrappers

Files:

- `client/src/services/admin.service.ts`
- `client/src/services/ngo.service.ts`

Admin service uses `NEXT_PUBLIC_API_URL || http://localhost:3001` and calls:

- `/api/v1/ngo`
- `/api/v1/request/all`
- `/api/v1/request/getAllRequets/:ngoId`
- `/api/v1/request/:requestId/status`
- `/api/history/compare`

NGO service currently defaults base URL to `http://localhost:3000` (frontend origin) and then uses `/api/v1/request/...`. In a typical deployment, these should go to Backend-A (3001) unless a Next.js proxy is set up.

### 9.3 Admin pages

Key pages:

- `client/src/app/admin/timeline-comparison/page.tsx`
  - Calls `GET /api/history/simulate`
  - Builds two timelines (Regular vs ML)
  - Displays KPIs including “Food Saved” (Regular spoiled @ delivery − ML spoiled @ delivery) plus denominators/rates

- `client/src/app/admin/simulation/page.tsx`
  - Calls `GET /api/history/simulate`
  - Renders split/regular/ml views with animated map timeline

Other admin pages exist for NGO/request management.

### 9.4 Map timeline components

Key components:

- `client/src/components/MapTimeline.tsx` — renders nodes, shipments, events for a given frame/time
- `client/src/components/AnimatedPolyline.tsx` — draws animated route lines
- `client/src/components/AnimatedTransitMarker.tsx` — renders moving “truck” markers
- `client/src/components/TimelineControl.tsx` — play/pause/scrub UI

The timeline visuals depend on these fields:

- Nodes: `lat/lng`, `type`, `name`
- Shipments: `startTime`, `etaTime`, optionally `arrivedTime`, and coordinates for endpoints

---

## 10. End-to-end workflows (story mode)

### 10.1 Seed an India-wide demo dataset

File: `Server/scripts/seed-india-geo.js`

Run:

```bash
cd Server
npm run seed:india
```

Creates:

- Nodes across India (warehouses + NGOs + farms)
- NGO org entries
- Batches (mix of perishables and non-perishables)
- Requests
- Events

This dataset is designed to make the Regular vs ML comparison meaningful.

### 10.2 Create a request (NGO demand)

- `POST /api/v1/request/createRequest`

This creates a `Request` and updates NGO request stats.

### 10.3 Allocate and compare strategies

There are two main “comparison” APIs:

- `GET /api/history/compare` → higher-level comparison payload
- `GET /api/history/simulate` → allocations formatted for the frontend’s comparison timelines

Frontend comparison pages use `/api/history/simulate` and compute presentation KPIs.

### 10.4 Create a real shipment

- `POST /api/shipments`

This does _real_ batch allocation and splitting, calls Backend-C for ETA, writes a Shipment, updates Batch statuses, and emits events.

### 10.5 Mark shipment arrived

- `PATCH /api/shipments/:id/arrive`

Updates Shipment + Batches + Event log.

### 10.6 Replay history

- `GET /api/history/day`
- `GET /api/history/range`

Produces frontend-ready snapshots with computed freshness and shipment states.

---

## 11. Known quirks, mismatches, and troubleshooting

### 11.1 ML port mismatch (3002 vs 5050)

- Compose exposes ML at **5050**.
- `Server/src/services/simulationService.js` defaults to `ML_SERVICE_URL = http://localhost:5050`.
- `Server/src/controllers/suggest.controller.js` defaults to `http://localhost:3002`.

If ML suggestions fail but ML allocator still works, this mismatch is usually why.

### 11.2 NGO org vs NGO node mapping

Requests refer to NGO organizations (model `NGO`). The allocator then finds a Node by matching `Node.name === NGO.name`. This requires seed data consistency.

### 11.3 “0 kg spoiled at delivery” can be realistic under current definition

Spoilage is counted only when freshness-at-delivery reaches **0%**. Many realistic deliveries will be “at risk” (<20%) without hitting 0%.

### 11.4 Quick smoke checks

- Server health (basic): `curl http://localhost:3001/api/history/day?date=2026-02-01`
- ML health: `curl http://localhost:5050/health`
- Transport ETA: `curl "http://localhost:5001/api/transport/time?fromLat=28.6139&fromLon=77.209&toLat=19.076&toLon=72.8777&start_iso=2026-02-01T10:00:00Z"`

---

## Appendix: Existing docs you may still want

- `README.md` — high-level problem statement
- `ARCHITECTURE_DIAGRAM.md` — ASCII diagram + flow examples
- `QUICKSTART.md` — local dev outline (may contain old ML port)
- `IMPLEMENTATION.md` — earlier implementation notes
- `DEMO_GUIDE.md` and `DEMO_PRESENTATION_GUIDE.md` — judge/demo scripts (partially out-of-date vs current compare/simulate endpoints)
