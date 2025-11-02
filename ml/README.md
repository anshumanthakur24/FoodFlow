# ML Service (short)

Unsupervised models for supply–demand monitoring:

- KMeans clusters districts; Isolation Forest flags anomalies.

Artifacts live in `ml/artifacts/<timestamp>/` with `metadata.json` and model files.

## Run (Windows PowerShell)

Training:

```powershell
cd "e:/Projects/Complete/Arcanix Hack on Hills/ml"
python -m venv .venv; .\.venv\Scripts\activate; pip install -r requirements.txt
python -m src.train --start-date 2023-01-01 --end-date 2024-10-31 --freq M
```

Node inference gateway:

```powershell
cd "e:/Projects/Complete/Arcanix Hack on Hills/ml"; npm install; npm run start
```

## HTTP API

GET /health – status and available runs
GET /runs – list trained run IDs
GET /runs/:runId/metadata – return metadata for a run

POST /predict – choose one of the two request formats below. If `runId` is omitted, the latest run is used.

1. Feature rows (existing format)

```json
{
  "runId": "optional",
  "records": [
    {
      "state": "Maharashtra",
      "district": "Pune",
      "period_start": "2024-10-01",
      "requested_kg": 1250,
      "incoming_kg": 980,
      "outgoing_kg": 450,
      "produced_kg": 1100
    }
  ]
}
```

2. Raw Server models (send data “as-is” from `Server/`)

```json
{
  "runId": "optional",
  "freq": "M",
  "nodes": [
    {
      "nodeId": "WH-001",
      "type": "warehouse",
      "district": "Pune",
      "state": "Maharashtra",
      "location": { "type": "Point", "coordinates": [73.86, 18.52] }
    }
  ],
  "requests": [
    {
      "requesterNode": "NGO-001",
      "items": [{ "foodType": "cereals", "required_kg": 500 }],
      "requiredBy_iso": "2024-10-10",
      "status": "open"
    }
  ],
  "shipments": [
    {
      "shipmentId": "S1",
      "batchIds": [],
      "fromNode": "FARM-001",
      "toNode": "WH-001",
      "start_iso": "2024-10-05",
      "travel_time_minutes": 120
    }
  ],
  "batches": [
    {
      "originNode": "FARM-001",
      "quantity_kg": 1200,
      "manufacture_date": "2024-10-01"
    }
  ]
}
```

Response (both formats):

```json
{
  "count": 1,
  "feature_columns": [
    "requested_kg",
    "incoming_kg",
    "outgoing_kg",
    "produced_kg",
    "…"
  ],
  "missing_feature_columns": ["…"],
  "results": [
    {
      "state": "Maharashtra",
      "district": "Pune",
      "period_start": "2024-10-01",
      "cluster_id": 2,
      "anomaly_score": 0.17,
      "is_anomaly": 0
    }
  ]
}
```

POST /transfers/plan – unchanged; accepts the existing payload and augments each suggestion with an OSRM route.

Notes:

- Any missing numeric feature is treated as 0.
- When sending raw Server models, `freq` defaults to the training frequency in `metadata.json` if omitted.
