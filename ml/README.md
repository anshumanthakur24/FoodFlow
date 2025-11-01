# ML Service

This module prepares historical demand features from MongoDB and trains two unsupervised models:

- **KMeans** clusters districts with similar demand and supply behavior.
- **Isolation Forest** highlights anomalous demand spikes that may indicate brewing crises.

## Running inside Docker Compose

- The repository now ships with an `ml` service in `docker-compose.yml`.
- Container-specific settings live in `.env.docker` (Mongo points to the `mongo` service, paths stay relative to `/app`).
- Bring the stack up with:
  ```bash
  docker compose up -d --build ml
  ```
- Artifacts and CSV data are bind-mounted (`./ml/artifacts`, `./ml/data`) so training output persists on the host.
- The container bakes its own virtual environment at `/opt/venv`; `PYTHON_BIN` inside `.env.docker` already points there.
- For local development on Windows, keep using `.env`; Docker Compose automatically injects values from `.env.docker` for the container.

## Prerequisites

1. Install Python 3.10 or newer.
2. From the repository root, create and activate a virtual environment:
   ```powershell
   cd "e:/Projects/Complete/Arcanix Hack on Hills/ml"
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and update the values for your MongoDB deployment and optional datasets.

## External enrichment data

Two CSV inputs are optional but recommended for richer modelling:

| File                    | Purpose                                                             | Mandatory columns                                                    | Notes                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `FESTIVAL_FEATURES_CSV` | Share of district population celebrating a festival during a period | `state`, `district`, `period_start`, `festival`, `celebration_pct`   | `period_start` should be the first day of the period (weekly or monthly). Percentages are expressed as 0-100.                             |
| `INCOME_FEATURES_CSV`   | District-level per-capita income                                    | `state`, `district`, `per_capita_income` (+ optional `period_start`) | If `period_start` is present the income will be treated as time-varying, otherwise the latest value per district is used for all periods. |

Example `festival_features.csv`:

```csv
state,district,period_start,festival,celebration_pct
Maharashtra,Pune,2024-10-01,Diwali,92
Maharashtra,Pune,2024-04-01,Gudi Padwa,68
West Bengal,Kolkata,2024-10-01,Durga Puja,97
```

Example `income_features.csv`:

```csv
state,district,per_capita_income,period_start
Maharashtra,Pune,248000,2024-04-01
West Bengal,Kolkata,182000,2024-04-01
```

> **Suggested sources**
>
> - Per-capita income: Reserve Bank of India "Handbook of Statistics on the Indian States" (state-wise Net State Domestic Product) or MOSPI District Domestic Product datasets (CSV via https://www.mospi.gov.in/). Export as CSV with rupee values.
> - Festival participation: Census-based cultural participation studies (e.g. National Sample Survey 75th round) or curated datasets from IHDS / Pew Research (export to CSV with estimated celebration percentages per district). Document the provenance in version control for auditability.

## Data sources

- **Operational history (MongoDB)** – The Main API (`Server/`) persists nodes, batches, shipments, and requests inside the Mongo database you point to via `MONGODB_URI`. Run the production system or the provided simulator (`mock-server/`) to generate realistic traffic before training.
- **Festival participation CSV** – Curate participation percentages from NSS, IHDS, Pew, or state tourism departments and export to the format shown above (`data/festival_features.csv`).
- **Income CSV** – Pull state/district Net or Gross Domestic Product per capita from MOSPI or RBI tables; normalize to rupees per person and store in `data/income_features.csv`.
- **Optional enrichments** – You can extend the schema with weather, commodity price indices, or census population—add columns in the CSVs and update feature engineering accordingly.

## Running a training job

```powershell
python -m src.train --start-date 2023-01-01 --end-date 2024-10-31 --freq M
```

- `--start-date` / `--end-date` limit the historical window that will be pulled from MongoDB.
- `--freq` accepts any Pandas offset alias (`W`, `M`, `Q` etc.).
- Leave the optional flags out to rely on `.env` defaults.

## Outputs

Every training run creates a timestamped folder inside `ML_OUTPUT_DIR` (default `artifacts/`). It contains:

- `kmeans_model.joblib` and `isolation_forest_model.joblib` – serialized scikit-learn pipelines.
- `aggregated_features.csv` – engineered features for each `(state, district, period)` row.
- `cluster_assignments.csv` – features plus cluster label and anomaly flags (`is_anomaly = 1` means Isolation Forest flagged an outlier).
- `metadata.json` – exact configuration, feature summary, and model diagnostics.

## Integration guidelines

- The Main API can call the isolation forest pipeline to pre-screen new demand snapshots; treat scores < 0 as higher-risk anomalies.
- Persist `cluster_id` with predictions so logistics teams can tailor playbooks per cluster.
- Re-train weekly or when significant festival/income data updates are ingested.
- Add automated tests using stored fixtures once real production data is seeded into the database.

### One-command training script (Windows PowerShell)

```powershell
cd "e:/Projects/Complete/Arcanix Hack on Hills/ml"
.\scripts\start-training.ps1 -StartDate 2023-01-01 -EndDate 2024-10-31 -Freq M
```

- The script bootstraps the virtual environment (creating `.venv` if missing), installs dependencies, ensures `.env` exists, and executes `python -m src.train`.
- Use `-SkipDeps` to skip the dependency install step on subsequent runs.
- Omitting `-Freq` falls back to `ML_FEATURE_FREQ` from the `.env` file (defaults to monthly `M`).

## Node.js inference gateway

The `server` directory contains an Express service that wraps the Python models so the rest of the stack can keep using Node APIs.

### Setup

```powershell
cd "e:/Projects/Complete/Arcanix Hack on Hills/ml"
npm install
```

- The server uses the same `.env` file as the training pipeline. Ensure `ML_OUTPUT_DIR` points to the folder with your trained runs (relative paths are resolved from the `ml` directory) and optionally override `ML_SERVER_PORT` or `PYTHON_BIN`.
- The service will execute `python -m src.infer` under the hood, so the Python virtual environment must be activated (or `PYTHON_BIN` must point to it).

### Running

```powershell
npm run start
```

The API exposes:

- `GET /health` – current configuration and detected run folders.
- `GET /runs` – lists available training run IDs (timestamped directory names).
- `GET /runs/:runId/metadata` – returns the stored metadata for a specific run.
- `POST /predict` – body `{ "records": [ { ...feature columns... } ], "runId": "optional" }`.

When `runId` is omitted, the server picks the latest run directory (lexicographically).

> The payload should include the numeric feature columns generated during training (fields missing from a record are treated as `0`).

### Transfer planning

- `POST /transfers/plan` – computes recommended transfers between warehouses and from farms to warehouses, then augments each leg with map coordinates spaced roughly every 5 km using the OSRM public routing API (override via `ROUTE_SERVICE_URL`).
- Optional request body fields:
  - `mode`: `"warehouse_to_warehouse"`, `"farm_to_warehouse"`, or `"all"` (default).
  - `maxPairs`, `minTransferKg`, `overstockRatio`, `understockRatio`, `targetRatio` to tune heuristics.
  - `filters`: `{ "states": [], "districts": [], "types": [], "nodeIds": [], "regions": [] }` for geographic scoping.
  - `intervalKm`: override the sampling interval for returned coordinates (default `5`).

Example request:

```http
POST /transfers/plan
Content-Type: application/json

{
   "mode": "all",
   "maxPairs": 3,
   "intervalKm": 5,
   "filters": { "states": ["maharashtra"] }
}
```

Example response (abridged):

```json
{
  "generated_at": "2025-11-01T06:29:00.112Z",
  "counts": { "warehouse_to_warehouse": 2, "farm_to_warehouse": 1 },
  "warehouse_to_warehouse": [
    {
      "type": "warehouse_to_warehouse",
      "suggested_quantity_kg": 420.5,
      "distance_km": 38.7,
      "source": {
        "nodeId": "WH-008",
        "utilization_pct": 92.1,
        "projected_utilization_pct": 65.4,
        "location": { "lat": 18.58, "lon": 73.77 }
      },
      "target": {
        "nodeId": "WH-014",
        "utilization_pct": 21.6,
        "projected_utilization_pct": 48.2,
        "location": { "lat": 18.45, "lon": 73.86 }
      },
      "route": {
        "provider": "osrm",
        "distanceKm": 41.2,
        "durationMinutes": 54.8,
        "points": [
          { "lat": 18.58, "lon": 73.77, "cumulativeKm": 0 },
          { "lat": 18.53, "lon": 73.81, "cumulativeKm": 5 },
          { "lat": 18.45, "lon": 73.86, "cumulativeKm": 41.2 }
        ]
      }
    }
  ]
}
```

> ⚠️ The default OSRM endpoint is shared and rate-limited; for higher throughput host your own instance and point `ROUTE_SERVICE_URL` to it.

Example request:

```http
POST /predict
Content-Type: application/json

{
   "records": [
      {
         "state": "Maharashtra",
         "district": "Pune",
         "period_start": "2024-10-01",
         "requested_kg": 1250,
         "incoming_kg": 980,
         "outgoing_kg": 450,
         "produced_kg": 1100,
         "request_status_open": 4,
         "request_status_fulfilled": 3
      }
   ]
}
```

Response (truncated):

```json
{
  "count": 1,
  "results": [
    {
      "state": "Maharashtra",
      "district": "Pune",
      "cluster_id": 2,
      "anomaly_score": 0.17,
      "is_anomaly": 0
    }
  ]
}
```
