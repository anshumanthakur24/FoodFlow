# Scenario Manager Mock Server Usage

## Data Seeding

Reference CSV and Excel data for the mock server is checked into the repository under `mock-server/mock-data/`. Docker builds no longer attempt to download files at runtime.

To refresh the Mongo collections manually (for example, after updating the Excel files), run the bundled scripts from the `mock-server/mock-data/` directory:

```powershell
python excel-to-mongo.py --folder ./crop-generation-data --mongo-uri mongodb://localhost:27017 --db arcanix
python infer-seasons.py --mongo-uri mongodb://localhost:27017 --db arcanix --input_coll crops_history --grouping district --min_coverage 0.75
```

## Configuration

Create a `.env` file in `mock-server/` with environment overrides as needed:

```
PORT=5001
MONGO_URI=mongodb://127.0.0.1:27017/arcanix
MAIN_API_URL=http://localhost:3001
MAIN_API_FARM_PATH=/api/v1/event/farm
MAIN_API_REQUEST_CREATE_PATH=/api/v1/request/createRequest
MAIN_API_REQUEST_APPROVE_TEMPLATE=/api/v1/request/{requestId}/approved
MAIN_API_REQUEST_FULFILL_TEMPLATE=/api/v1/request/{requestId}/fulfilled
SCENARIO_MAX_BATCH_SIZE=200
SCENARIO_MIN_INTERVAL_MS=500
SCENARIO_PROB_FARM=0.65
SCENARIO_PROB_REQUEST=0.35
```

Any unset value falls back to the defaults above.

Tip: If your main API only exposes a single status endpoint (e.g. `PATCH /api/v1/request/:requestID/status`), set the approve/fulfill templates to point at that path and use the Mongo object id placeholder:

```
MAIN_API_REQUEST_APPROVE_TEMPLATE=/api/v1/request/{requestObjectId}/status
MAIN_API_REQUEST_FULFILL_TEMPLATE=/api/v1/request/{requestObjectId}/status
```

The mock server will capture the created request's Mongo `_id` from the creation response and substitute it into `{requestObjectId}` automatically.

## Request Lifecycle

Request creation events follow the main API schema. Each `request` payload includes `requestId`, `requesterNode`, `items`, and lifecycle history. The simulator then:

- POSTs to `MAIN_API_REQUEST_CREATE_PATH` when a request is created.
- After a random 1–6 day delay, POSTs to `MAIN_API_REQUEST_APPROVE_TEMPLATE` to mark the request as approved. Templates support `{requestId}` (the human ID) and `{requestObjectId}` (Mongo `_id`).
- For the majority of approved requests, POSTs to `MAIN_API_REQUEST_FULFILL_TEMPLATE` after an additional 4–48 simulation hours to mark them fulfilled.

Requests that are never approved remain tracked internally with `pending` status so the mock server can surface their history via the events collection.
Request identifiers are deterministically derived from the scenario seed so that approval and fulfilment calls always reference the same value sent during creation.
The simulator persists three event types in Mongo for this lifecycle: `request` (creation), `requestApproved`, and `requestFulfilled`.

All lifecycle calls use `POST` with JSON bodies. For status-only endpoints, the payloads are:

- Approval: `{ "status": "approved", "approvedOn": "<ISO>" }`
- Fulfillment: `{ "status": "fulfilled", "fulfilledBy": "<ObjectId>", "fullFilledOn": "<ISO>", "approvedOn": "<ISO>" }`

## API Endpoints

### POST `/api/scenario/start`

Start a deterministic simulation.

There are two ways to scope where events are emitted from:

1. Provide `nodes` directly (preferred). Each item should match `Server/src/models/node.model.js` shape (at least `nodeId`, `type`, `district`, optional `state`, and `location.coordinates` as `[lon, lat]`).

```json
{
  "name": "HarvestRun-1",
  "seed": "arcanix-2025",
  "startDate": "2025-11-01T00:00:00Z",
  "batchSize": 20,
  "intervalMs": 2000,
  "nodes": [
    {
      "nodeId": "FARM-001",
      "type": "farm",
      "district": "Pune",
      "state": "Maharashtra",
      "location": { "type": "Point", "coordinates": [73.86, 18.52] }
    },
    {
      "nodeId": "WH-001",
      "type": "warehouse",
      "district": "Pune",
      "state": "Maharashtra",
      "location": { "type": "Point", "coordinates": [73.9, 18.55] }
    }
  ],
  "durationMinutes": 5,
  "probabilities": { "farm": 0.65, "request": 0.35 }
}
```

2. Legacy: provide `regions` and the simulator will resolve regions/warehouses from Mongo.

Returns: `{ "scenarioId": string, "status": "running" }`

### POST `/api/scenario/stop`

Stop a running simulation.

```json
{
  "scenarioId": "<id from start>"
}
```

Returns: `{ "scenarioId": string, "status": "stopped", "stats": { "totalEventsSent": number } }`

### GET `/api/scenario/:id/status`

Retrieve scenario metadata, status, configuration, and stats.

### GET `/api/scenario/:id/events?limit=100`

Fetch recent events persisted in MongoDB (`sim_events`). `limit` defaults to 100 and is capped at 500.

All emitted events now include an `emittedFrom` object inside the payload with the source node details, plus simulated time fields that advance between events:

```json
{
  "type": "farm",
  "payload": {
    "emittedFrom": {
      "nodeId": "FARM-001",
      "type": "farm",
      "district": "Pune",
      "state": "Maharashtra",
      "location": { "lat": 18.52, "lon": 73.86 }
    },
    "quantity_kg": 2500,
    "generatedAt": "2025-11-01T00:05:00.000Z",
    "generatedAt_iso": "2025-11-01T00:05:00.000Z",
    "createdAt": "2025-11-01T00:05:00.000Z",
    "createdAt_iso": "2025-11-01T00:05:00.000Z",
    "previousEvent": "2025-11-01T00:00:00.000Z",
    "previousEvent_iso": "2025-11-01T00:00:00.000Z",
    "batch": {
      "quantity_kg": 2500,
      "dateOfCreation": "2025-11-01T00:05:00.000Z",
      "dateOfCreation_iso": "2025-11-01T00:05:00.000Z"
    }
  }
}
```

Request creation events follow the request schema published by the main API. Each `request` payload includes `requestId`, `requesterNode`, `items`, and lifecycle history. The simulator emits `requestApproved` after a random delay (1–6 days) and `requestFulfilled` 4–48 hours after approval for most requests. Requests that are never approved remain in the simulator ledger and stay in `pending` status.

### Simulated time configuration

You can configure how much simulated time advances between events when starting a scenario:

```json
{
  "name": "HarvestRun-1",
  "seed": "arcanix-2025",
  "startDate": "2025-11-01T00:00:00Z",
  "batchSize": 20,
  "intervalMs": 2000,
  "timeAdvance": { "minMinutes": 60, "maxMinutes": 1440 },
  "nodes": [...]
}
```

Defaults are 60–1440 minutes if omitted. The simulated clock is monotonic and embedded in the event payload via the `generatedAt`/`createdAt` fields.

## Docker

Build and launch the mock server alongside MongoDB with seeded reference data:

1. From the repo root run `docker compose up --build`.
2. Wait for the entrypoint logs to show the Python data prep scripts completing (`excel-to-mongo.py`, `infer-seasons.py`).
3. Interact with the API at `http://localhost:5001` once the "Starting Scenario Manager" log appears.

The compose setup exposes an optional `MONGO_DB` environment variable that defaults to the database parsed from `MONGO_URI`. Setting `SKIP_DATA_SETUP=1` on the `mock-server` service skips the Python loaders if you already have seeded data.

## Generate nodes from Mongo states/districts

The generator now only needs your MongoDB to be running with the `agriculte.crops_history` collection populated:

```powershell
cd "e:/Projects/Complete/Arcanix Hack on Hills/mock-server/mock-data"

# Generate nodes (writes nodes.mongo.json by default when you pass a filename)
node .\generate-nodes.js .\nodes.mongo.json

# Import the generated JSON into the main API database
mongoimport --uri "mongodb://127.0.0.1:27017/arcanix" --collection nodes --jsonArray --file ".\nodes.mongo.json"
```

Environment overrides (optional):

- `MONGO_URI` (default `mongodb://127.0.0.1:27017/agriculte`)
- `MONGO_DB` (default `agriculte`)
- `MONGO_COLLECTION` (default `crops_history`)
