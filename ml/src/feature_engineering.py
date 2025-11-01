from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .utils.logging import get_logger

LOGGER = get_logger(__name__)

KEY_COLUMNS = ["state", "district", "period_start"]


def prepare_feature_frame(
    nodes_df: pd.DataFrame,
    requests_df: pd.DataFrame,
    shipments_df: pd.DataFrame,
    batches_df: pd.DataFrame,
    freq: str,
    festival_csv_path: Optional[str] = None,
    income_csv_path: Optional[str] = None,
) -> Tuple[pd.DataFrame, Dict[str, object]]:
    nodes = _prepare_nodes(nodes_df)
    batches = _normalize_batches(batches_df)

    request_block = _prepare_request_features(requests_df, nodes, freq)
    shipment_block = _prepare_shipment_features(shipments_df, nodes, batches, freq)
    batch_block = _prepare_batch_features(batches, nodes, freq)
    festival_block, festival_meta = _load_festival_features(festival_csv_path, freq)
    income_dynamic, income_static, income_meta = _load_income_features(income_csv_path, freq)

    blocks: List[pd.DataFrame] = [
        request_block,
        shipment_block,
        batch_block,
        festival_block,
        income_dynamic,
    ]
    blocks = [block for block in blocks if not block.empty]

    if blocks:
        features = _merge_blocks(blocks)
    else:
        features = pd.DataFrame(columns=KEY_COLUMNS)

    if not income_static.empty:
        features = features.merge(income_static, on=["state", "district"], how="left")

    if not features.empty:
        features = features.sort_values(KEY_COLUMNS).reset_index(drop=True)
        features = _post_process(features)

    metadata = {
        "rows": int(len(features)),
        "feature_columns": [col for col in features.columns if col not in KEY_COLUMNS],
        "frequency": freq,
        "festival_records": festival_meta,
        "income_records": income_meta,
        "generated_at": pd.Timestamp.utcnow().isoformat(),
    }
    return features, metadata


def _prepare_nodes(nodes_df: pd.DataFrame) -> pd.DataFrame:
    if nodes_df is None or nodes_df.empty:
        LOGGER.warning("Node collection is empty; downstream joins may miss location metadata.")
        return pd.DataFrame(columns=["node_mongo_id", "state", "district", "type", "capacity_kg"])

    nodes = nodes_df.copy()
    if "_id" not in nodes.columns:
        raise ValueError("Nodes dataframe missing Mongo _id field.")

    nodes["node_mongo_id"] = nodes["_id"].astype(str)
    nodes["state"] = nodes.get("state", "Unknown").fillna("Unknown")
    nodes["district"] = nodes.get("district", "Unknown").fillna("Unknown")

    if "capacity_kg" in nodes.columns:
        nodes["capacity_kg"] = pd.to_numeric(nodes["capacity_kg"], errors="coerce")

    return nodes


def _normalize_batches(batches_df: pd.DataFrame) -> pd.DataFrame:
    if batches_df is None or batches_df.empty:
        LOGGER.warning("Batch collection is empty; production features will be zero.")
        return pd.DataFrame(
            columns=[
                "batch_mongo_id",
                "batchId",
                "originNode",
                "manufacture_date",
                "initial_quantity_kg",
                "current_quantity_kg",
                "freshnessPct",
                "shelf_life_hours",
            ]
        )

    batches = batches_df.copy()
    batches["batch_mongo_id"] = batches["_id"].astype(str)

    for field in ["originNode", "currentNode"]:
        if field in batches.columns:
            batches[field] = batches[field].astype(str)

    for field in ["manufacture_date", "expiry_iso"]:
        if field in batches.columns:
            batches[field] = pd.to_datetime(batches[field], errors="coerce")

    batches.rename(
        columns={
            "quantity_kg": "current_quantity_kg",
            "original_quantity_kg": "initial_quantity_kg",
        },
        inplace=True,
    )

    for field in ["current_quantity_kg", "initial_quantity_kg", "freshnessPct", "shelf_life_hours"]:
        if field in batches.columns:
            batches[field] = pd.to_numeric(batches[field], errors="coerce")

    return batches


def _prepare_request_features(requests_df: pd.DataFrame, nodes: pd.DataFrame, freq: str) -> pd.DataFrame:
    if requests_df is None or requests_df.empty:
        LOGGER.info("No request documents found for the selected period.")
        return pd.DataFrame(columns=KEY_COLUMNS + ["requested_kg", "unique_food_types", "request_count"])

    requests = requests_df.copy()
    requests["requesterNode"] = requests["requesterNode"].astype(str)
    requests["requiredBy_iso"] = pd.to_datetime(requests.get("requiredBy_iso"), errors="coerce")
    requests["items"] = requests.get("items").apply(_normalize_request_items)

    exploded = requests.explode("items", ignore_index=True)
    exploded["items"] = exploded["items"].apply(lambda item: item if isinstance(item, dict) else {})
    exploded["required_kg"] = exploded["items"].apply(lambda item: float(item.get("required_kg", 0.0)))
    exploded["foodType"] = exploded["items"].apply(lambda item: item.get("foodType"))

    exploded = exploded.merge(
        nodes[["node_mongo_id", "state", "district"]],
        left_on="requesterNode",
        right_on="node_mongo_id",
        how="left",
    )

    exploded["period_start"] = _assign_period(exploded, "requiredBy_iso", freq)

    aggregated = (
        exploded.groupby(KEY_COLUMNS, dropna=False)
        .agg(
            requested_kg=("required_kg", "sum"),
            unique_food_types=("foodType", pd.Series.nunique),
            request_count=("requestId", "nunique"),
        )
        .reset_index()
    )

    aggregated["unique_food_types"] = aggregated["unique_food_types"].fillna(0.0)

    if "status" in requests.columns:
        status = requests.merge(
            nodes[["node_mongo_id", "state", "district"]],
            left_on="requesterNode",
            right_on="node_mongo_id",
            how="left",
        )
        status["period_start"] = _assign_period(status, "requiredBy_iso", freq)
        status_counts = (
            status.pivot_table(
                index=KEY_COLUMNS,
                columns="status",
                values="requestId",
                aggfunc="count",
                fill_value=0,
            )
            .reset_index()
        )
        status_counts.columns = [
            col if col in KEY_COLUMNS else f"request_status_{str(col).lower()}"
            for col in status_counts.columns
        ]
        aggregated = aggregated.merge(status_counts, on=KEY_COLUMNS, how="outer")

    return aggregated


def _prepare_shipment_features(
    shipments_df: pd.DataFrame,
    nodes: pd.DataFrame,
    batches: pd.DataFrame,
    freq: str,
) -> pd.DataFrame:
    if shipments_df is None or shipments_df.empty:
        LOGGER.info("No shipment documents found for the selected period.")
        return pd.DataFrame(
            columns=KEY_COLUMNS
            + [
                "incoming_shipments",
                "incoming_batches",
                "incoming_kg",
                "outgoing_shipments",
                "outgoing_batches",
                "outgoing_kg",
                "avg_travel_time_minutes",
            ]
        )

    shipments = shipments_df.copy()
    shipments["start_iso"] = pd.to_datetime(shipments.get("start_iso"), errors="coerce")
    shipments["batchIds"] = shipments.get("batchIds").apply(_normalize_id_list)

    for field in ["fromNode", "toNode"]:
        if field in shipments.columns:
            shipments[field] = shipments[field].astype(str)

    exploded = shipments.explode("batchIds", ignore_index=True)
    exploded["batchIds"] = exploded["batchIds"].astype(str)

    batch_lookup = pd.DataFrame()
    if not batches.empty:
        batch_lookup = batches[["batch_mongo_id", "initial_quantity_kg", "current_quantity_kg"]]

    if not batch_lookup.empty:
        exploded = exploded.merge(
            batch_lookup,
            left_on="batchIds",
            right_on="batch_mongo_id",
            how="left",
        )
        exploded["batch_payload_kg"] = exploded["initial_quantity_kg"].fillna(exploded["current_quantity_kg"])
    else:
        exploded["batch_payload_kg"] = np.nan

    exploded["batch_payload_kg"] = (
        pd.to_numeric(exploded["batch_payload_kg"], errors="coerce").fillna(0.0)
    )

    incoming = exploded.merge(
        nodes[["node_mongo_id", "state", "district"]],
        left_on="toNode",
        right_on="node_mongo_id",
        how="left",
    )
    incoming["period_start"] = _assign_period(incoming, "start_iso", freq)

    incoming_grouped = (
        incoming.groupby(KEY_COLUMNS, dropna=False)
        .agg(
            incoming_shipments=("shipmentId", "nunique"),
            incoming_batches=("batchIds", "count"),
            incoming_kg=("batch_payload_kg", "sum"),
            avg_travel_time_minutes=("travel_time_minutes", "mean"),
        )
        .reset_index()
    )

    outgoing = exploded.merge(
        nodes[["node_mongo_id", "state", "district"]],
        left_on="fromNode",
        right_on="node_mongo_id",
        how="left",
    )
    outgoing["period_start"] = _assign_period(outgoing, "start_iso", freq)

    outgoing_grouped = (
        outgoing.groupby(KEY_COLUMNS, dropna=False)
        .agg(
            outgoing_shipments=("shipmentId", "nunique"),
            outgoing_batches=("batchIds", "count"),
            outgoing_kg=("batch_payload_kg", "sum"),
        )
        .reset_index()
    )

    features = incoming_grouped.merge(outgoing_grouped, on=KEY_COLUMNS, how="outer")
    return features


def _prepare_batch_features(batches: pd.DataFrame, nodes: pd.DataFrame, freq: str) -> pd.DataFrame:
    if batches is None or batches.empty:
        return pd.DataFrame(
            columns=KEY_COLUMNS
            + ["produced_batches", "produced_kg", "avg_batch_freshness", "avg_shelf_life_hours"]
        )

    summary = batches.merge(
        nodes[["node_mongo_id", "state", "district"]],
        left_on="originNode",
        right_on="node_mongo_id",
        how="left",
    )
    summary["period_start"] = _assign_period(summary, "manufacture_date", freq)

    aggregated = (
        summary.groupby(KEY_COLUMNS, dropna=False)
        .agg(
            produced_batches=("batchId", "nunique"),
            produced_kg=("initial_quantity_kg", "sum"),
            avg_batch_freshness=("freshnessPct", "mean"),
            avg_shelf_life_hours=("shelf_life_hours", "mean"),
        )
        .reset_index()
    )

    return aggregated


def _load_festival_features(path: Optional[str], freq: str) -> Tuple[pd.DataFrame, Dict[str, object]]:
    meta: Dict[str, object] = {"source_path": path, "records": 0, "festivals": []}
    if not path:
        return pd.DataFrame(), meta

    file_path = Path(path)
    if not file_path.exists():
        LOGGER.warning("Festival feature file %s not found; skipping.", path)
        return pd.DataFrame(), meta

    festival_df = pd.read_csv(file_path)
    required_cols = {"state", "district", "period_start", "festival", "celebration_pct"}
    missing = required_cols - set(festival_df.columns)
    if missing:
        raise ValueError(
            f"Festival CSV missing required columns: {sorted(missing)}. Found: {sorted(festival_df.columns)}"
        )

    festival_df["period_start"] = pd.to_datetime(festival_df["period_start"], errors="coerce")
    festival_df.dropna(subset=["period_start"], inplace=True)
    festival_df["period_start"] = festival_df["period_start"].dt.to_period(freq).dt.start_time
    festival_df["celebration_pct"] = pd.to_numeric(
        festival_df["celebration_pct"], errors="coerce"
    ).fillna(0.0)

    pivot = (
        festival_df.pivot_table(
            index=KEY_COLUMNS,
            columns="festival",
            values="celebration_pct",
            aggfunc="max",
            fill_value=0.0,
        )
        .reset_index()
    )
    pivot.columns = [
        col if col in KEY_COLUMNS else f"festival_{str(col).lower().replace(' ', '_')}"
        for col in pivot.columns
    ]

    meta["records"] = int(len(festival_df))
    meta["festivals"] = sorted({str(val) for val in festival_df["festival"].unique()})
    return pivot, meta


def _load_income_features(
    path: Optional[str],
    freq: str,
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, object]]:
    meta: Dict[str, object] = {"source_path": path, "records": 0, "mode": "static"}
    if not path:
        return pd.DataFrame(), pd.DataFrame(), meta

    file_path = Path(path)
    if not file_path.exists():
        LOGGER.warning("Income feature file %s not found; skipping.", path)
        return pd.DataFrame(), pd.DataFrame(), meta

    income_df = pd.read_csv(file_path)
    required_cols = {"state", "district", "per_capita_income"}
    missing = required_cols - set(income_df.columns)
    if missing:
        raise ValueError(
            f"Income CSV missing required columns: {sorted(missing)}. Found: {sorted(income_df.columns)}"
        )

    income_df["per_capita_income"] = pd.to_numeric(
        income_df["per_capita_income"], errors="coerce"
    )

    dynamic = pd.DataFrame()
    if "period_start" in income_df.columns:
        income_df["period_start"] = pd.to_datetime(income_df["period_start"], errors="coerce")
        income_df.dropna(subset=["period_start"], inplace=True)
        income_df["period_start"] = income_df["period_start"].dt.to_period(freq).dt.start_time
        dynamic = income_df[KEY_COLUMNS + ["per_capita_income"]]
        meta["mode"] = "time_variant"
    static = (
        income_df[["state", "district", "per_capita_income"]]
        .drop_duplicates(subset=["state", "district"], keep="last")
        .reset_index(drop=True)
    )

    meta["records"] = int(len(income_df))
    return dynamic, static, meta


def _merge_blocks(blocks: List[pd.DataFrame]) -> pd.DataFrame:
    merged = blocks[0]
    for block in blocks[1:]:
        merged = merged.merge(block, on=KEY_COLUMNS, how="outer")
    return merged


def _post_process(features: pd.DataFrame) -> pd.DataFrame:
    features["state"] = features["state"].fillna("Unknown")
    features["district"] = features["district"].fillna("Unknown")

    numeric_cols = features.select_dtypes(include=[np.number]).columns.tolist()
    for col in numeric_cols:
        if col == "per_capita_income":
            continue
        features[col] = features[col].fillna(0.0)

    if "per_capita_income" in features.columns:
        median_income = features["per_capita_income"].median()
        features["per_capita_income"] = features["per_capita_income"].fillna(median_income)

    requested = _safe_series(features, "requested_kg")
    incoming = _safe_series(features, "incoming_kg")
    outgoing = _safe_series(features, "outgoing_kg")
    produced = _safe_series(features, "produced_kg")

    features["supply_demand_gap_kg"] = incoming - requested
    features["net_flow_kg"] = incoming - outgoing
    features["production_vs_demand_ratio"] = np.where(
        requested > 0,
        produced / requested,
        0.0,
    )
    features["request_to_supply_ratio"] = np.where(
        incoming > 0,
        requested / incoming,
        0.0,
    )

    return features


def _assign_period(frame: pd.DataFrame, column: str, freq: str) -> pd.Series:
    if column not in frame.columns:
        return pd.Series(pd.NaT, index=frame.index)
    series = pd.to_datetime(frame[column], errors="coerce")
    period = series.dt.to_period(freq)
    return period.dt.start_time


def _normalize_request_items(payload) -> List[dict]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return [payload]
    if pd.isna(payload):
        return []
    return []


def _normalize_id_list(payload) -> List[object]:
    if isinstance(payload, list):
        return payload
    if pd.isna(payload):
        return []
    return [payload]


def _safe_series(frame: pd.DataFrame, column: str) -> pd.Series:
    if column in frame.columns:
        return pd.to_numeric(frame[column], errors="coerce").fillna(0.0)
    return pd.Series(0.0, index=frame.index, dtype=float)
