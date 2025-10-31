# Scenario Manager Mock Server Usage

## Prerequisites

- Node.js 18+
- MongoDB instance (local or remote)
- Optional: companion Test Server (`test-server`) running on port 4000 for verifying outbound events

## Installation

```powershell
cd "E:\Projects\Complete\Arcanix Hack on Hills\mock-server"
npm install
```

## Configuration

Create a `.env` file in `mock-server/` with environment overrides as needed:

```
PORT=5001
MONGO_URI=mongodb://127.0.0.1:27017/arcanix
MAIN_API_URL=http://localhost:4000
MAIN_API_FARM_PATH=/api/farm-events
MAIN_API_SHIPMENTS_PATH=/api/shipments
MAIN_API_REQUESTS_PATH=/api/requests
SCENARIO_MAX_BATCH_SIZE=200
SCENARIO_MIN_INTERVAL_MS=500
SCENARIO_PROB_FARM=0.7
SCENARIO_PROB_SHIPMENT=0.25
SCENARIO_PROB_NGO=0.05
```

Any unset value falls back to the defaults above.

## Running the Mock Server

```powershell
npm run dev   # nodemon for hot reload
# or
npm start     # plain node
```

The service will connect to MongoDB and listen on `PORT` (default `5001`). It exposes REST endpoints under `/api/scenario`.

## API Endpoints

### POST `/api/scenario/start`

Start a deterministic simulation.

```json
{
  "name": "HarvestRun-1",
  "seed": "arcanix-2025",
  "startDate": "2025-11-01T00:00:00Z",
  "batchSize": 20,
  "intervalMs": 2000,
  "regions": ["Andhra Pradesh"],
  "durationMinutes": 5,
  "probabilities": {
    "farm": 0.6,
    "shipment": 0.3,
    "ngo": 0.1
  }
}
```

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

## Event Flow

- Each tick (based on `intervalMs`) the manager builds a batch of events (up to `batchSize`).
- The generator uses seeded randomness (`seed` + `scenarioId` + tick index) to keep runs deterministic.
- Generated events are inserted into MongoDB and POSTed asynchronously to the configured Main API routes. Use the Test Server to observe these callbacks.

## Synthetic Region Fallback

If the `regions` collection is empty, the manager synthesizes regions from `crop_seasons` documents to keep the simulation running.

## Testing with the Companion Test Server

```powershell
cd "E:\Projects\Complete\Arcanix Hack on Hills\test-server"
npm install
npm start  # listens on 4000
```

Set `MAIN_API_URL=http://localhost:4000` in the mock-server `.env`. Start a scenario and observe logs in the test server or query `GET http://localhost:4000/api/received` for captured payloads.

## Useful Scripts

Sample curl requests are available in `scripts/scenario-curl-examples.sh` (update host/port as needed).

## Shutdown

Stop the mock server with `Ctrl+C`. Any running scenarios are marked as stopped when the process exits.
