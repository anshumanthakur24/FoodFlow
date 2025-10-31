# Scenario Manager Mock Server Usage

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
