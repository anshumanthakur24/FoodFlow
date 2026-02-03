# ML Service (ml/) — Beginner-Friendly Deep Dive

This document explains **how the ML service works**, how it consumes data from MongoDB (or from Backend-A snapshots), and how “freshness” relates to the ML + simulation results.

If you want a much more detailed, case-by-case walkthrough (training + both inference formats + edge cases), see: `ML_MODEL_DRY_RUN.md`.

> Quick mental model: the ML service is a **Node.js API wrapper** around a **Python pipeline** that runs **unsupervised models**. It does _not_ directly “plan shipments”; it produces **signals** (clusters + anomaly flags) that Backend-A can use as one input to decision making.

---

## 1) What problem the ML service is solving

The project needs a way to:

- detect **unusual demand/supply patterns** (“something’s happening in District X”), and
- provide a lightweight **regional signal** that can be used to prioritize actions.

Instead of predicting an exact future number (supervised forecasting), the current approach is:

- **KMeans clustering**: group region/time windows into “similar” behavior buckets.
- **Isolation Forest anomaly detection**: flag region/time windows that look unusual compared to typical history.

This is intentionally simple, explainable, and works even when you don’t have “ground truth labels”.

---

## 2) The ML service is actually two layers

### Layer A: Node.js inference gateway

Location:

- `ml/server/app.js`
- `ml/server/services/pythonRunner.js`

Responsibilities:

- exposes HTTP endpoints (`/health`, `/runs`, `/predict`, …)
- chooses which model run directory to use (latest or `runId`)
- spawns Python using `child_process.spawn`
- passes request payload to Python over **STDIN** and returns Python’s JSON output

Key detail:

- The gateway does not run scikit-learn inside Node. It shells out to Python: `python -m src.infer --model-dir <...>`.

### Layer B: Python training + inference pipeline

Locations:

- Training entrypoint: `ml/src/train.py`
- Inference entrypoint: `ml/src/infer.py`
- Feature engineering: `ml/src/feature_engineering.py`
- Mongo access: `ml/src/data_loader.py`
- Model training code: `ml/src/models.py`

Responsibilities:

- load data from MongoDB (training)
- aggregate raw docs into numeric feature rows (training + inference)
- train + persist models (training)
- load artifacts + predict cluster/anomaly (inference)

---

## 3) Data sources: what MongoDB collections and fields matter

When training, the ML code reads directly from MongoDB collections:

- `nodes`
- `batches`
- `requests`
- `shipments`

This happens in `ml/src/data_loader.py` (`MongoDataLoader`).

### What fields the ML pipeline expects

It’s tolerant to missing columns, but these are the important ones:

- **nodes**
  - `_id` (used as canonical `node_mongo_id`)
  - `state`, `district`
  - `type` (warehouse / ngo / farm)
  - `capacity_kg`
  - `location` (GeoJSON Point)

- **batches**
  - `originNode`, `currentNode`
  - `quantity_kg`, `original_quantity_kg`
  - `manufacture_date`, `expiry_iso`
  - `status`
  - `shelf_life_hours`
  - `freshnessPct` (stored/cached value; see freshness section below)

- **requests**
  - `requesterNode`
  - `items[]` where each item has `foodType` and `required_kg`
  - `requiredBy_iso`
  - `status`

- **shipments**
  - `fromNode`, `toNode`
  - `batchIds[]`
  - `start_iso`, `eta_iso`, `arrived_iso`
  - `status`
  - `travel_time_minutes`

Backend-A defines these MongoDB schemas under `Server/src/models/`.

---

## 4) Feature engineering (how raw docs become ML rows)

The ML model does not train on individual shipments or requests directly.

Instead, it creates “summary rows” keyed by:

- `state`
- `district`
- `period_start` (based on aggregation frequency, like daily or monthly)

This is implemented in `ml/src/feature_engineering.py`.

### 4.1 Key idea: aggregate by region + time window

Example: if `freq = "M"`, then all requests in (Pune, Oct 2024) get rolled up into a single row.

### 4.2 What kinds of features are produced

The exact feature list is stored in model artifacts (see metadata), but conceptually it includes:

- request volume (e.g., total requested kg, number of requests)
- shipment flow (incoming/outgoing kg and counts)
- production signals (batch creation volume)
- perishability signals (average freshness, shelf life)
- optional “external signals” (festival/income feature blocks when those CSV paths are configured)

### 4.3 Defensive defaults

In `ml/src/feature_engineering.py`, batches are normalized so required numeric columns exist.

That means even if some documents don’t have `freshnessPct` or `shelf_life_hours`, the pipeline will fill defaults so it can still run end-to-end.

---

## 5) Training: what gets written to ml/artifacts/

Entrypoint: `python -m src.train` (see `ml/src/train.py`).

Steps:

1. connect to MongoDB
2. fetch nodes/batches/requests/shipments for an optional date range
3. generate aggregated feature rows
4. train:
   - KMeans clustering model
   - Isolation Forest anomaly model
5. write a timestamped run directory under `ml/artifacts/<runId>/`

A run directory contains:

- `kmeans_model.joblib`
- `isolation_forest_model.joblib`
- `aggregated_features.csv` (raw engineered features)
- `cluster_assignments.csv` (features + predicted cluster/anomaly for training window)
- `metadata.json`

### 5.1 Why metadata.json is critical

During inference, the code reads `feature_columns` from `metadata.json`.

Those columns become the canonical “model input schema”. If an incoming prediction payload is missing some feature columns, inference fills missing numeric features with 0.

---

## 6) Inference: what /predict does

HTTP endpoint:

- `POST /predict` in `ml/server/app.js`

The ML gateway supports **two request formats**:

### 6.1 Format A: "records" (already-featured rows)

You provide `records: [...]` where each record is already a feature row.

The Python code loads the model artifacts and runs `predict`.

### 6.2 Format B: raw Backend-A snapshot (nodes/requests/shipments/batches)

You provide raw arrays, and Python will:

1. convert them into DataFrames
2. run the same feature engineering used during training
3. predict on the generated aggregated rows

This conversion happens in `ml/src/infer.py` via `maybe_build_records_from_server_payload()`.

### 6.3 Output fields

The response contains:

- `cluster_id`: the KMeans cluster assignment
- `anomaly_score`: Isolation Forest decision function score
- `is_anomaly`: 1 when the model flags the row as an outlier, else 0

It also includes:

- `feature_columns` used for the model
- `missing_feature_columns` that were filled with zeros

---

## 7) How Backend-A uses ML outputs today (and how it affects “food saved”)

The core “ML vs Regular” demo in this repo is primarily an optimization around:

- **distance** (shorter travel), and
- **freshness-at-delivery** (more food arrives before it degrades).

Backend-A’s ML allocator lives in:

- `Server/src/services/simulationService.js` (`allocateML`)

It calls the ML service at:

- `POST ${ML_SERVICE_URL}/predict`

Then it builds a simple `regionalSignals` map from ML results and uses it as a small multiplier:

- when a region is anomalous, it applies a mild `urgencyBoost` (currently `1.1`)

After that, the allocator scores candidate warehouses mostly via:

- an exponential distance penalty
- weighted delivered freshness at estimated delivery time
- an “expiry pressure” term (favor using batches that are safe-but-soon-to-expire)
- fulfillment ratio

### Important: the ML service does not compute freshness

Freshness comes from Backend-A’s perishability utility (see next section). The ML service may _consume_ freshness-related fields as features (e.g., `freshnessPct` averages), but the authoritative freshness math is on the Server side.

---

## 8) Freshness: how it’s computed and how it’s “appended” to API responses

Freshness utilities live in:

- `Server/src/utils/freshness.js`

### 8.1 The core freshness formula

Backend-A calculates a freshness percentage based on:

- elapsed time since `manufacture_date`
- `shelf_life_hours`
- an ambient temperature factor (`avgTemp`, default 25°C)

It returns a value in the range 0–100.

### 8.2 Why you see freshness fields that look “added”

There are two different things in play:

1. **Stored freshness field in MongoDB**

- The Batch schema includes `freshnessPct` (see `Server/src/models/batch.model.js`).
- Seed scripts may set it on creation.
- Batch creation endpoint currently initializes it to 100.

2. **Computed freshness at query time (derived fields)**

Backend-A often computes freshness “as of now” or “as of a timeline timestamp” and adds it to the API response object.

Examples:

- `GET /api/batches` and `GET /api/batches/:batchId` add `currentFreshnessPct` on the returned JSON objects (`Server/src/controllers/batch.controller.js`).
- `GET /api/history/day` recalculates `freshnessPct` for each batch at the requested day’s end (`Server/src/controllers/history.controller.js`).

In other words: freshness is not magically “appended in the database”. It is usually **derived** and attached to response JSON so the UI can show accurate freshness for the requested time.

### 8.3 How “food spoiled” / “food saved” is computed

For simulations, Backend-A estimates a delivery timestamp and computes freshness at that time. Then:

- “spoiled @ delivery” increments when `freshnessAtDelivery <= 0`
- “at risk” increments when `freshnessAtDelivery < 20`

That strict threshold explains why you can see `0 kg spoiled @ delivery` even when some deliveries are low-ish freshness.

---

## 9) Transfer planner endpoint (separate from clustering/anomaly)

Endpoint:

- `POST /transfers/plan`

This runs a different Python module (`src.transfer_planner`) and is about **inventory rebalancing** (e.g., warehouse-to-warehouse transfers based on capacity/utilization).

It is related to the same domain, but it is not the same as `/predict` and not part of the KMeans/IsolationForest anomaly detection pipeline.

---

## 10) Practical troubleshooting

### “No trained models available”

- The ML gateway requires at least one run directory under `ml/artifacts/`.
- Train once (or mount artifacts in Docker) so `/predict` has something to load.

### “metadata.json does not contain 'feature_columns'”

- The run directory is incomplete or corrupted.
- Re-run training to regenerate artifacts.

### Missing columns warnings

- Inference will fill missing numeric columns with 0.
- This keeps things running, but too many missing columns reduces model usefulness.

### Python interpreter issues

- The gateway uses `PYTHON_BIN` (or its default) to spawn Python.
- If `/health` shows an unexpected Python path, fix the env var used by the ML container/process.

---

## 11) Where to look next

If you want the ML signal to be a stronger “hero feature” (beyond a small urgency boost), common next steps are:

- feed ML anomaly scores into the scoring function more directly
- add supervised forecasting once you have historical labels (demand ground truth)
- include weather/temperature events in the feature set
- add evaluation dashboards comparing clusters/anomalies over time
