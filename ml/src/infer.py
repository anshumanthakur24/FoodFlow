from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run inference with previously trained clustering and anomaly models."
    )
    parser.add_argument("--model-dir", required=True, help="Directory containing trained artifacts.")
    parser.add_argument(
        "--input-file",
        help="JSON file with records; when omitted the payload is read from STDIN.",
    )
    parser.add_argument(
        "--output-file",
        help="Optional path to write JSON predictions; prints to STDOUT when omitted.",
    )
    parser.add_argument(
        "--metadata-file",
        help="Optional metadata path; defaults to <model-dir>/metadata.json.",
    )
    return parser.parse_args()


def load_records(args: argparse.Namespace) -> List[Dict[str, Any]]:
    if args.input_file:
        payload_text = Path(args.input_file).read_text(encoding="utf-8")
    else:
        payload_text = sys.stdin.read()
    if not payload_text.strip():
        raise ValueError("No inference payload supplied.")

    payload = json.loads(payload_text)
    if isinstance(payload, dict) and "records" in payload:
        records = payload["records"]
    elif isinstance(payload, list):
        records = payload
    else:
        raise ValueError("Payload must be an object with 'records' or a list of feature dicts.")

    if not isinstance(records, list) or not records:
        raise ValueError("Provide a non-empty list of records for inference.")

    return records


def load_metadata(model_dir: Path, metadata_file: str | None) -> Dict[str, Any]:
    if metadata_file:
        path = Path(metadata_file)
    else:
        path = model_dir / "metadata.json"
    if not path.exists():
        raise FileNotFoundError(f"Metadata file not found at {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_matrix(records: List[Dict[str, Any]], feature_columns: List[str]) -> Tuple[pd.DataFrame, List[str]]:
    frame = pd.DataFrame(records)
    missing_columns = [col for col in feature_columns if col not in frame.columns]
    for column in missing_columns:
        frame[column] = 0.0
    matrix = frame[feature_columns].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    return matrix, missing_columns


def load_pipelines(model_dir: Path) -> Tuple[Any, Any]:
    kmeans_path = model_dir / "kmeans_model.joblib"
    iso_path = model_dir / "isolation_forest_model.joblib"

    if not kmeans_path.exists() or not iso_path.exists():
        raise FileNotFoundError(
            "Expected kmeans_model.joblib and isolation_forest_model.joblib in model directory"
        )

    kmeans_pipeline = joblib.load(kmeans_path)
    isolation_pipeline = joblib.load(iso_path)
    return kmeans_pipeline, isolation_pipeline


def run(models, matrix: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    kmeans_pipeline, isolation_pipeline = models

    clusters = kmeans_pipeline.predict(matrix)

    scaled = isolation_pipeline[:-1].transform(matrix)
    iso_model = isolation_pipeline.named_steps["model"]
    scores = iso_model.decision_function(scaled)
    flags = iso_model.predict(scaled)
    return clusters, scores, flags


def assemble_response(
    records: List[Dict[str, Any]],
    clusters: np.ndarray,
    scores: np.ndarray,
    flags: np.ndarray,
    feature_columns: List[str],
    missing_columns: List[str],
) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    for index, record in enumerate(records):
        result = {
            "cluster_id": int(clusters[index]),
            "anomaly_score": float(scores[index]),
            "is_anomaly": int(flags[index] == -1),
        }
        for key in ("state", "district", "period_start"):
            if key in record and key not in result:
                result[key] = record[key]
        extra_keys = set(record.keys()) - set(feature_columns) - set(result.keys())
        for key in extra_keys:
            result[key] = record[key]
        results.append(result)

    return {
        "count": len(results),
        "feature_columns": feature_columns,
        "missing_feature_columns": missing_columns,
        "results": results,
    }


def main() -> None:
    args = parse_args()
    model_dir = Path(args.model_dir)
    if not model_dir.exists():
        raise FileNotFoundError(f"Model directory not found: {model_dir}")

    records = load_records(args)
    metadata = load_metadata(model_dir, args.metadata_file)
    feature_columns = metadata.get("feature_columns")
    if not feature_columns:
        raise KeyError("metadata.json does not contain 'feature_columns'.")

    matrix, missing_columns = build_matrix(records, feature_columns)
    models = load_pipelines(model_dir)
    clusters, scores, flags = run(models, matrix)

    response = assemble_response(records, clusters, scores, flags, feature_columns, missing_columns)

    if args.output_file:
        Path(args.output_file).write_text(json.dumps(response, indent=2), encoding="utf-8")
    else:
        json.dump(response, sys.stdout)


if __name__ == "__main__":
    main()
