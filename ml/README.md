# ML Service

This module prepares historical demand features from MongoDB and trains two unsupervised models:

- **KMeans** clusters districts with similar demand and supply behavior.
- **Isolation Forest** highlights anomalous demand spikes that may indicate brewing crises.

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

## Running a training job

```powershell
python -m src.train --start-date 2023-01-01 --end-date 2024-10-31 --freq M
```

- `--start-date` / `--end-date` limit the historical window that will be pulled from MongoDB.
- `--freq` accepts any Pandas offset alias (`W`, `M`, `Q` etc.).
- Leave the optional flags out to rely on `.env` defaults.

## Outputs

Every training run creates a timestamped folder inside `ML_OUTPUT_DIR` (default `ml/artifacts/`). It contains:

- `kmeans_model.joblib` and `isolation_forest_model.joblib` – serialized scikit-learn pipelines.
- `aggregated_features.csv` – engineered features for each `(state, district, period)` row.
- `cluster_assignments.csv` – features plus cluster label and anomaly flags (`is_anomaly = 1` means Isolation Forest flagged an outlier).
- `metadata.json` – exact configuration, feature summary, and model diagnostics.

## Integration guidelines

- The Main API can call the isolation forest pipeline to pre-screen new demand snapshots; treat scores < 0 as higher-risk anomalies.
- Persist `cluster_id` with predictions so logistics teams can tailor playbooks per cluster.
- Re-train weekly or when significant festival/income data updates are ingested.
- Add automated tests using stored fixtures once real production data is seeded into the database.
