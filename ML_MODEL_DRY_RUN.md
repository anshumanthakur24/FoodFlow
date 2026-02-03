# ML Model Dry Run (Beginner-Friendly) — Training + Inference + All Common Cases

This document is a **step-by-step dry run** of what our ML subsystem does in every major scenario:

- how training produces a “run” (artifacts)
- how inference works for both input formats (`records` vs raw Server snapshot)
- what the algorithms are (KMeans + Isolation Forest + scaling)
- what happens in edge cases (missing columns, empty payloads, too little data, missing artifacts)
- how Backend-A uses the ML outputs (and what it does _not_ use ML for)

It’s written so a beginner can follow the exact control flow in the repo.

---

## 0) Big picture (one paragraph)

The ML service (`ml/`) is a **Node.js API** that shells out to **Python**. Python does two jobs:

1. **Training**: read historical supply-chain data from MongoDB → aggregate it into “region/time” feature rows → train unsupervised models → save artifacts.
2. **Inference**: take either (A) already-aggregated rows or (B) raw Server-shaped data → produce the same type of aggregated feature rows → load artifacts → output cluster + anomaly flags per row.

Backend‑A (the main server) uses the ML output only as a **small regional urgency signal**, not as a full routing plan.

---

## 1) Vocabulary you’ll see everywhere

### 1.1 “Record” / “feature row”

A **record** is one row of numeric features representing:

- a _region_ (state + district)
- a _time window_ (`period_start`) like monthly (`freq = "M"`) or daily (`freq = "D"`)

Key columns (non-numeric identifiers):

- `state`, `district`, `period_start`

Everything else is numeric features (requested kg, incoming kg, produced kg, etc.).

### 1.2 “Run”

A **run** is one training output folder under:

- `ml/artifacts/<runId>/`

It contains model binaries and metadata.

---

## 2) The algorithms (what they do and why)

All models are **unsupervised**.

### 2.1 StandardScaler (preprocessing)

Both models are trained in scikit-learn **pipelines** that begin with `StandardScaler`.

- Why? Our features have different units and magnitudes (kg, counts, ratios). Scaling prevents one huge-magnitude feature from dominating distance-based learning.

Where it happens:

- Training: `ml/src/models.py` builds pipelines.
- Inference: we load the pipelines and call `.predict()` / `.decision_function()`.

### 2.2 KMeans clustering

Goal: group records into **behavior clusters**.

- Example cluster meanings (intuitive):
  - “High demand, high incoming supply”
  - “Low demand, low supply”
  - “Supply deficit / demand spike”

Output:

- `cluster_id` (integer)

How it’s trained:

- File: `ml/src/models.py`
- Pipeline: `StandardScaler() -> KMeans(n_clusters=..., n_init=10)`

Important behavior:

- If you request e.g. 5 clusters but only have 3 samples, it automatically reduces `n_clusters`.
- It enforces at least 2 clusters when possible.

### 2.3 Isolation Forest anomaly detection

Goal: flag records that look **unusual** compared to typical history.

Output:

- `anomaly_score` (float)
- `is_anomaly` (0/1)

How it works (intuitive):

- Isolation Forest isolates points using random splits.
- Outliers tend to be isolated in fewer splits.

How it’s trained:

- File: `ml/src/models.py`
- Pipeline: `StandardScaler() -> IsolationForest(contamination=..., n_estimators=300)`

Key parameter:

- `contamination` = expected fraction of outliers (e.g., 0.05 means “~5% anomalies”).

How `is_anomaly` is computed:

- scikit-learn `predict()` returns `-1` for outliers, `+1` for inliers.
- We convert it to `is_anomaly = 1` when prediction is `-1`.

---

## 3) Training dry run (what happens when you run `python -m src.train`)

Entry point:

- `ml/src/train.py`

### 3.1 Step-by-step

1. Load config (`load_config()`)
   - Reads Mongo URI/DB, output dir, default `freq`, cluster counts, contamination.

2. Parse CLI args
   - optional: `--start-date`, `--end-date`, `--freq`, `--kmeans-clusters`, `--contamination`.

3. Load raw MongoDB docs
   - uses `MongoDataLoader` in `ml/src/data_loader.py`
   - collections: `nodes`, `batches`, `requests`, `shipments`

4. Feature engineering
   - calls `prepare_feature_frame(...)` in `ml/src/feature_engineering.py`
   - returns:
     - `features` dataframe (rows = region/time buckets)
     - `feature_meta` (summary)

5. Guardrail: need enough rows
   - if `len(features) < 2` → training stops (can’t train unsupervised models with 1 point).

6. Build the feature matrix
   - `build_feature_matrix(features)` in `ml/src/models.py`
   - selects numeric columns only
   - fills missing numeric values with 0

7. Train models
   - `train_unsupervised_models(...)` in `ml/src/models.py`
   - returns trained pipelines + training summaries + labels/scores.

8. Write artifacts
   - creates run dir: `ml/artifacts/<timestamp>/`
   - writes:
     - `kmeans_model.joblib`
     - `isolation_forest_model.joblib`
     - `aggregated_features.csv`
     - `cluster_assignments.csv`
     - `metadata.json`

### 3.2 What `metadata.json` contains (why it matters)

Inference depends on `metadata.json` for one critical thing:

- `feature_columns`: the exact numeric columns the model expects.

If inference receives records missing some of those numeric columns, it will add them with 0.

---

## 4) Inference dry run — two input formats

Entry point:

- `ml/src/infer.py`

The Node gateway calls it like:

- `python -m src.infer --model-dir <runDir>`

### 4.1 Common steps regardless of input

1. Read raw JSON payload
   - from STDIN (Node sends it)

2. Load `metadata.json`
   - pulls `feature_columns`
   - also reads `frequency` (used as default `freq` if raw Server payload doesn’t provide one)

3. Load model binaries
   - `kmeans_model.joblib`
   - `isolation_forest_model.joblib`

4. Build numeric matrix
   - enforce that all `feature_columns` exist
   - coerce to numeric, fill NaNs with 0

5. Run inference
   - `cluster_id = kmeans_pipeline.predict(matrix)`
   - `anomaly_score` + `is_anomaly` from Isolation Forest

6. Return JSON:
   - `count`, `feature_columns`, `missing_feature_columns`, `results[]`

---

## 5) Case A: Inference with `records` (already-featured)

Payload shape:

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

Dry run:

1. Python sees `records` and uses them directly.
2. It compares record keys to `feature_columns` from metadata.
3. Missing numeric features are injected with `0.0`.
4. Predict cluster + anomaly.

Common beginner confusion:

- Your record can contain extra fields; inference preserves extras in the output.

---

## 6) Case B: Inference with raw Server snapshot (nodes/requests/shipments/batches)

Payload shape (simplified):

```json
{
  "freq": "M",
  "nodes": [...],
  "requests": [...],
  "shipments": [...],
  "batches": [...]
}
```

Dry run:

1. Python detects “server payload” by checking if any of those keys exist.
2. It converts each list to a pandas DataFrame.
3. It calls `prepare_feature_frame(...)` to build aggregated rows.
4. Those aggregated rows become the `records` it predicts on.

Important detail:

- Festival and income CSVs are **not** used during this inference path (they are set to `None` in `infer.py`).
- That’s fine: missing numeric features get filled with 0 anyway.

---

## 7) Edge cases and what the system does

This section is the “cover all cases” checklist.

### 7.1 ML gateway has no trained runs

Node endpoint: `POST /predict` in `ml/server/app.js`

- It tries to find the latest run dir.
- If none exist → responds with `400` and `No trained models available`.

Fix:

- run training once or mount `ml/artifacts/`.

### 7.2 metadata.json missing

Python throws:

- `FileNotFoundError("Metadata file not found...")`

Gateway returns JSON error with stderr/stdout.

Fix:

- retrain to regenerate the run folder.

### 7.3 model .joblib files missing

Python throws:

- `FileNotFoundError("Expected kmeans_model.joblib and isolation_forest_model.joblib...")`

Fix:

- retrain.

### 7.4 inference payload empty

Python throws:

- `ValueError("No inference payload supplied.")`

### 7.5 inference payload is neither records nor server format

Python throws:

- `ValueError("Payload must be an object with 'records' or raw Server data...")`

### 7.6 server payload provided but feature engineering yields 0 rows

Python does:

- if `features.empty` → returns `[]` and then throws:
  - `ValueError("No feature rows could be generated from provided Server data.")`

Common causes:

- missing/invalid dates (so `period_start` becomes NaT and rows drop out)
- no nodes with state/district mapping for joins

### 7.7 training has too little data

Training raises:

- `RuntimeError("Not enough aggregated rows to train models...")`

You need at least 2 aggregated rows.

### 7.8 training has no numeric columns

If feature engineering outputs only key columns with no numeric columns, training raises:

- `ValueError("No numeric feature columns available for training.")`

### 7.9 KMeans cluster count vs sample count

In `ml/src/models.py`, KMeans cluster count is adjusted:

- `n_clusters = min(config.kmeans_clusters, n_samples)`
- forced to at least 2 when possible

So you won’t accidentally request 10 clusters with 3 samples.

---

## 8) How Backend‑A uses ML outputs (and what it does NOT do)

Backend‑A’s allocator is in:

- `Server/src/services/simulationService.js` (`allocateML`)

What it does:

- tries to call the ML service for `results[]` containing `is_anomaly`
- sends a raw snapshot payload and maps each request’s `requesterNode` to the corresponding NGO **Node** `_id` when possible (so feature engineering can join `state`/`district`)
- maps each (state,district) to `{ isAnomaly, anomalyScore }`
- computes `urgencyBoost = 1.1` if anomalous, else `1.0`

What else influences allocation (non-ML signals):

- **Freshness is computed in Backend‑A**, not by ML.
  - Backend‑A uses `calculateFreshnessPct(batch, time, avgTemp=25)`.
  - There is a mock weather endpoint (`mock-server`), but Backend‑A currently uses the default `avgTemp=25` unless you explicitly wire weather into the allocator.

What it does NOT do:

- The ML service does not output “choose warehouse X”.
- Backend‑A does not send “warehouse candidates” to ML for scoring.
- Routing remains a Server-side heuristic: distance + delivered freshness + expiry pressure.

---

## 9) Worked dry runs (the model interacting with real-shaped examples)

This is the section you want if “dry run” means: **take specific inputs and walk through exactly what the code does to them**.

Important honesty note:

- The exact numeric outputs (cluster IDs and anomaly scores) depend on **your trained artifacts** (`ml/artifacts/<runId>/...`).
- So below, we explain the exact mechanics and show **example-shaped outputs**, but your actual numbers will differ.

### 9.1 Before we start: what inference needs from the run directory

Inference loads `metadata.json` and extracts `feature_columns`.

That list is the authoritative “schema” of numeric features the model expects.

If your input record does not include some of them, the inference code **creates them and sets them to 0**.

That behavior is important because it explains:

- why inference doesn’t crash when some features are absent
- why some features can be 0 if their data source isn’t available at runtime

How festival/income features work in practice:

- Training loads festival + income features via `TrainingConfig.festival_csv_path` and `TrainingConfig.income_csv_path`.
- Snapshot inference (raw Server-shaped payload) builds feature rows via `prepare_feature_frame(...)` and uses the same CSV paths from the trained run’s `metadata.json` (under `config.*`).
- If the CSV files don’t exist, feature engineering skips them and inference back-fills the missing columns with 0.

#### 9.1.1 Full `feature_columns` list (current checked-in run)

For the checked-in artifacts at `ml/artifacts/20251101T153949Z/metadata.json`, the model consumes exactly these numeric columns:

```text
festival_ambedkar_jayanti
festival_bakr_id/eid_ul-adha
festival_bhai_duj
festival_birthday_of_ravindranath
festival_buddha_purnima/vesak
festival_chaitra_sukhladi
festival_chhat_puja_(pratihar_sashthi/surya_sashthi)
festival_christmas
festival_christmas_eve
festival_diwali/deepavali
festival_dolyatra
festival_dussehra
festival_easter_day
festival_first_day_of_durga_puja_festivities
festival_first_day_of_sharad_navratri
festival_ganesh_chaturthi/vinayaka_chaturthi
festival_good_friday
festival_govardhan_puja
festival_gudi_padwa
festival_guru_govind_singh_jayanti
festival_guru_nanak_jayanti
festival_guru_ravidas_jayanti
festival_guru_tegh_bahadur's_martyrdom_day
festival_hazarat_ali's_birthday
festival_holi
festival_holika_dahana
festival_independence_day
festival_jamat_ul-vida
festival_janmashtami
festival_janmashtami_(smarta)
festival_karaka_chaturthi_(karva_chauth)
festival_lohri
festival_maha_ashtami
festival_maha_navami
festival_maha_saptami
festival_maha_shivaratri/shivaratri
festival_maharishi_dayanand_saraswati_jayanti
festival_maharishi_valmiki_jayanti
festival_mahatma_gandhi_jayanti
festival_mahavir_jayanti
festival_makar_sankranti
festival_mesadi_/_vaisakhadi
festival_milad_un-nabi/id-e-milad
festival_muharram/ashura
festival_naraka_chaturdasi
festival_new_year's_day
festival_onam
festival_parsi_new_year
festival_pongal
festival_raksha_bandhan_(rakhi)
festival_rama_navami
festival_ramzan_id/eid-ul-fitar
festival_rath_yatra
festival_republic_day
festival_shivaji_jayanti
festival_ugadi
festival_vaisakhi
festival_vasant_panchami
net_flow_kg
per_capita_income_x
per_capita_income_y
production_vs_demand_ratio
request_to_supply_ratio
supply_demand_gap_kg
```

---

### 9.2 Example A — Inference with `records` (and missing feature columns)

We’ll send one record that is missing some features that exist in `metadata.json`.

#### Input

```json
{
  "records": [
    {
      "state": "Karnataka",
      "district": "Bengaluru",
      "period_start": "2026-02-01",
      "festival_diwali/deepavali": 0.62,
      "festival_holi": 0.0,
      "per_capita_income_x": 180000,
      "per_capita_income_y": 175000,
      "net_flow_kg": 0,
      "supply_demand_gap_kg": 0,
      "production_vs_demand_ratio": 0,
      "request_to_supply_ratio": 0,

      "note": "extra fields are allowed and passed through"
    }
  ]
}
```

#### Step-by-step: what `ml/src/infer.py` does

1. It loads `metadata.json` and reads `feature_columns`.

2. It builds a pandas DataFrame from your record.

3. It computes `missing_columns = [col for col in feature_columns if col not in frame.columns]`.

4. For every missing column, it does:

```py
frame[column] = 0.0
```

In this repo’s latest checked-in trained run (`ml/artifacts/20251101T153949Z/metadata.json`), the model feature columns are primarily:

- `festival_*` columns (one per festival)
- `per_capita_income_x` / `per_capita_income_y`
- derived numeric metrics like `net_flow_kg`, `supply_demand_gap_kg`, `production_vs_demand_ratio`, `request_to_supply_ratio`

So you do **not** need to provide every `festival_*` column: missing festival columns will be injected as 0.

5. It builds `matrix = frame[feature_columns].apply(pd.to_numeric, errors="coerce").fillna(0.0)`.

This ensures:

- values become numeric
- non-numeric junk becomes NaN then becomes 0

6. It loads the pipelines from `.joblib`:

- `kmeans_pipeline` = `StandardScaler -> KMeans`
- `isolation_pipeline` = `StandardScaler -> IsolationForest`

7. It predicts:

- `cluster_id` using KMeans
- `anomaly_score` using IsolationForest decision function
- `is_anomaly` based on IsolationForest predict output (`-1` => anomaly)

#### How KMeans + Isolation Forest “use” the example (beginner view)

- The scaler converts each numeric feature into a standardized number:
  - $z = \frac{x - \mu}{\sigma}$

- KMeans compares the standardized vector to each cluster center and picks the closest.
- Isolation Forest looks at how easily this point is isolated compared to typical points.

#### Output (shape)

```json
{
  "count": 1,
  "missing_feature_columns": [
    "festival_ambedkar_jayanti",
    "festival_bakr_id/eid_ul-adha",
    "... (many other festival_* columns omitted for readability)"
  ],
  "results": [
    {
      "state": "Karnataka",
      "district": "Bengaluru",
      "period_start": "2026-02-01",
      "cluster_id": 2,
      "anomaly_score": -0.03,
      "is_anomaly": 1,
      "note": "extra fields are allowed and passed through"
    }
  ]
}
```

Key interpretation:

- `missing_feature_columns` tells you which model inputs were backfilled with zeros.
- `is_anomaly = 1` means “this row looks unusual compared to training history”, not “this is bad”.

---

### 9.3 Example B — Inference from a raw Server snapshot (how aggregation happens)

This case demonstrates how the model “interacts” with normal supply-chain objects.

#### Input (minimal snapshot)

```json
{
  "freq": "M",
  "nodes": [
    {
      "_id": "W1",
      "type": "warehouse",
      "state": "Karnataka",
      "district": "Bengaluru"
    },
    {
      "_id": "N1",
      "type": "ngo",
      "state": "Karnataka",
      "district": "Bengaluru"
    }
  ],
  "requests": [
    {
      "requestId": "R1",
      "requesterNode": "N1",
      "requiredBy_iso": "2026-02-10T00:00:00Z",
      "status": "pending",
      "items": [
        { "foodType": "rice", "required_kg": 500 },
        { "foodType": "wheat", "required_kg": 300 }
      ]
    }
  ],
  "shipments": [
    {
      "shipmentId": "S1",
      "fromNode": "W1",
      "toNode": "N1",
      "start_iso": "2026-02-05T00:00:00Z",
      "travel_time_minutes": 240,
      "batchIds": ["B1"]
    }
  ],
  "batches": [
    {
      "_id": "B1",
      "batchId": "B1",
      "originNode": "W1",
      "currentNode": "W1",
      "quantity_kg": 700,
      "original_quantity_kg": 700,
      "manufacture_date": "2026-02-01T00:00:00Z",
      "shelf_life_hours": 72,
      "freshnessPct": 90
    }
  ]
}
```

#### Step-by-step: what `ml/src/infer.py` does

1. It recognizes this is “server-shaped” because keys like `nodes`, `requests`, `shipments`, `batches` exist.

2. It converts each list into a DataFrame.

3. It calls `prepare_feature_frame(...)`.

4. `prepare_feature_frame(...)` builds **blocks** and merges them:

- Request block (by requester region + period)
  - explodes `items[]`
  - sums `required_kg` into `requested_kg`
  - counts `request_count`
  - computes `unique_food_types`
  - can create `request_status_pending`, etc.

- Shipment block (incoming/outgoing flows)
  - counts incoming/outgoing shipments
  - sums estimated kg moved (from batch payload info)
  - averages travel time

- Batch block (production)
  - counts produced batches
  - sums `produced_kg`
  - averages `freshnessPct` and `shelf_life_hours`

- Festival block (district-level celebration intensity)
  - loads `ml/data/festival_features.csv` (generated by `ml/scripts/build_festival_features.py`)
  - pivots into one column per festival:
    - `festival_<festival name normalized>`
    - value is `celebration_pct` in `[0, 1]`
  - example feature: `festival_diwali/deepavali`

- Income block (district-level income)
  - loads `ml/data/income_features.csv`
  - merges both a time-variant and a static income view
  - NOTE: because both use `per_capita_income`, the final merged dataset can contain `per_capita_income_x` and `per_capita_income_y`

5. It produces one or more aggregated rows keyed by:

- `state`, `district`, `period_start`

#### What the engineered row “means” (intuitive)

For this snapshot, you should expect a row representing “Bengaluru in Feb 2026” with features like:

- `requested_kg ≈ 800` (500 rice + 300 wheat)
- `request_count ≈ 1`
- `unique_food_types ≈ 2`
- `incoming_shipments ≈ 1` (to N1’s region)
- `avg_travel_time_minutes ≈ 240`
- `produced_kg ≈ 700`
- `avg_batch_freshness ≈ 90`

Then inference runs exactly like Example A, but on the engineered rows.

Important nuance:

- The model only consumes columns listed in the run’s `metadata.json` → `feature_columns`.
- If your trained run doesn’t include operational columns like `requested_kg`/`incoming_kg`, then operational variation won’t affect `is_anomaly`.

#### Why this is powerful

This means you can send “normal app data” to ML and it will self-assemble the features.
That’s how Backend‑A uses it in practice.

---

### 9.4 Example C — Two similar regions, one becomes an anomaly

This is the simplest way to understand `is_anomaly`.

Think of Isolation Forest as “rare pattern detector” over whatever columns are in `feature_columns`.

For the currently checked-in trained run, `feature_columns` are heavily festival/income-driven.
So the easiest-to-understand anomaly story is a festival spike.

Imagine two monthly rows for the same district:

- Month A (non-festival): `festival_diwali/deepavali = 0.0`
- Month B (festival month): `festival_diwali/deepavali = 0.62`

If Month B’s overall festival signature + income context is rare in the training set, it may be flagged as an anomaly.

If you _want_ anomalies based on operational spikes (demand/supply), ensure your trained run’s `feature_columns` includes features like `requested_kg`, `incoming_kg`, `outgoing_kg`, `produced_kg` and retrain on a time window where those blocks are present.

The model output does **not** say what to do; it only says “this looks unusual”.

Backend‑A then uses that as a tiny multiplier:

- `urgencyBoost = 1.1` if `is_anomaly = 1`, else `1.0`

---

### 9.5 How to get real outputs for these examples (recommended)

If you want the exact `cluster_id` and `anomaly_score` for your currently trained artifacts, run the ML gateway and call it.

PowerShell example (edit the payload to match Example A or B):

```powershell
$body = @'
{"records":[{"state":"Karnataka","district":"Bengaluru","period_start":"2026-02-01","festival_diwali/deepavali":0.62,"per_capita_income_x":180000,"per_capita_income_y":175000,"net_flow_kg":0,"supply_demand_gap_kg":0,"production_vs_demand_ratio":0,"request_to_supply_ratio":0}]}
'@

Invoke-RestMethod -Method Post -Uri "http://localhost:5050/predict" -ContentType "application/json" -Body $body
```

This prints the true model outputs from your local artifacts.

---

## 10) How to validate the ML model end-to-end (beginner checklist)

1. Train once → confirm `ml/artifacts/<runId>/metadata.json` exists.
2. Start ML gateway → `GET /health` shows that run.
3. Call `POST /predict` with a minimal `records` payload.
4. Call `POST /predict` with a raw snapshot and confirm you get multiple regional rows.
5. Ensure Backend‑A can reach ML gateway (timeout < 8s) and gracefully degrades if not.
