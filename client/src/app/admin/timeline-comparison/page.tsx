"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import TimelineControl from "@/components/TimelineControl";
import type { Event, Node, Shipment } from "@/data/sampleFoodData";

// Dynamically import MapTimeline to avoid SSR issues with Leaflet
const MapTimeline = dynamic(() => import("@/components/MapTimeline"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center rounded-lg">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  ),
});

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type ApiResponseEnvelope<T> = {
  success?: boolean;
  statusCode?: number;
  message?: string;
  data?: T;
};

interface StrategyMetrics {
  totalAllocated: number;
  totalDistanceKm?: number;
  avgDistance: number;
  avgFreshness: number;
  fulfillmentRate: number;
  deliveredKg?: number;
  deliveredAvgFreshness?: number;
  deliveredSpoiledKg?: number;
  deliveredAtRiskKg?: number;
}

interface StrategyTotals {
  requestedKg: number;
  allocatedKg: number;
}

interface BackendAllocation {
  requestId: string;
  foodType: string;
  required_kg: number;
  allocated_kg: number;
  warehouse: string;
  warehouseName?: string;
  distance_km: number;
  batches: { batchId: string; quantity: number; freshness: number }[];
  warehouseCoords?: [number, number];
  ngoCoords?: [number, number];
  ngoName?: string;
}

interface BackendStrategyPayload {
  strategy: string;
  metrics: StrategyMetrics;
  allocations: BackendAllocation[];
}

interface BackendSimulateResponse {
  success: boolean;
  data: {
    startTime: string;
    endTime: string;
    regular: BackendStrategyPayload;
    ml: BackendStrategyPayload;
  };
}

interface TimelineData {
  nodes: Node[];
  events: Event[];
  shipments: Shipment[];
  metrics: StrategyMetrics;
  totals: StrategyTotals;
}

type MLSignalRow = {
  state?: string;
  district?: string;
  period_start?: string;
  cluster_id?: number;
  anomaly_score?: number;
  is_anomaly?: number;
  [key: string]: unknown;
};

type MLPredictResponse = {
  count?: number;
  results?: MLSignalRow[];
  feature_columns?: string[];
  missing_feature_columns?: string[];
};

type MLRegionAggregate = {
  key: string;
  state: string;
  district: string;
  rows: MLSignalRow[];
  latestRow: MLSignalRow;
  latestPeriodMs: number;
  worstRow: MLSignalRow;
  worstScore: number;
  anomalyCount: number;
  isAnomalyLatest: boolean;
  isAnomalyEver: boolean;
  urgencyBoostLatest: number;
};

type MLRegionFilter = "all" | "boosted" | "normal" | "ever";
type MLRegionSort = "boostFirst" | "worstScore" | "latest" | "name";

function pctDelta(base: number, next: number) {
  if (!Number.isFinite(base) || base === 0) return 0;
  return ((base - next) / base) * 100;
}

function pct(n: number) {
  if (!Number.isFinite(n)) return "0.0%";
  return `${n.toFixed(1)}%`;
}

function safePct(numer: number, denom: number) {
  if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom <= 0)
    return 0;
  return (numer / denom) * 100;
}

function fmtKg(n: number) {
  return `${n.toFixed(1)} kg`;
}

function fmtKm(n: number) {
  return `${n.toFixed(1)} km`;
}

function fmtScore(n: number) {
  if (!Number.isFinite(n)) return "0.000";
  return n.toFixed(3);
}

function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function regionKeyOf(row: MLSignalRow) {
  return `${row.state || "Unknown"}—${row.district || "Unknown"}`;
}

function periodMsOf(row: MLSignalRow) {
  const raw = typeof row.period_start === "string" ? row.period_start : "";
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function fmtPeriod(raw: unknown) {
  if (typeof raw !== "string" || !raw) return "(no period)";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toISOString().slice(0, 10);
}

export default function TimelineComparisonPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regular, setRegular] = useState<TimelineData | null>(null);
  const [ml, setMl] = useState<TimelineData | null>(null);

  const [signalsOpen, setSignalsOpen] = useState(false);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  const [signals, setSignals] = useState<MLSignalRow[]>([]);
  const [selectedSignalKey, setSelectedSignalKey] = useState<string | null>(
    null,
  );
  const [signalSearch, setSignalSearch] = useState("");
  const [signalFilter, setSignalFilter] = useState<MLRegionFilter>("all");
  const [signalSort, setSignalSort] = useState<MLRegionSort>("boostFirst");

  const [startTime, setStartTime] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getTime() - 1000);
  });
  const [endTime, setEndTime] = useState<Date>(() => new Date());
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  const [isPlaying, setIsPlaying] = useState(false);

  const convertToTimelineData = useMemo(() => {
    return (
      allocData: BackendStrategyPayload,
      baseTime: Date,
    ): TimelineData => {
      const nodes: Node[] = [];
      const events: Event[] = [];
      const shipments: Shipment[] = [];
      const nodeMap = new Map<string, Node>();

      let requestedKg = 0;
      let allocatedKg = 0;

      let eventId = 1;
      let shipmentId = 1;

      const simulationStartMs = baseTime.getTime();
      const stepMs = 30 * 60 * 1000; // 30 min spacing

      for (const [idx, alloc] of allocData.allocations.entries()) {
        requestedKg += alloc.required_kg || 0;
        allocatedKg += alloc.allocated_kg || 0;

        const warehouseId = alloc.warehouse;
        const ngoId = alloc.requestId;

        if (!nodeMap.has(warehouseId)) {
          const coords = alloc.warehouseCoords || [77.209, 28.6139];
          const warehouseNode: Node = {
            id: warehouseId,
            nodeId: warehouseId,
            name: alloc.warehouseName || "Warehouse",
            type: "warehouse",
            lat: coords[1],
            lng: coords[0],
          };
          nodes.push(warehouseNode);
          nodeMap.set(warehouseId, warehouseNode);
        }

        if (!nodeMap.has(ngoId)) {
          const coords = alloc.ngoCoords || [77.2, 28.6];
          const ngoNode: Node = {
            id: ngoId,
            nodeId: ngoId,
            name: alloc.ngoName || `NGO ${alloc.requestId}`,
            type: "ngo",
            lat: coords[1],
            lng: coords[0],
          };
          nodes.push(ngoNode);
          nodeMap.set(ngoId, ngoNode);
        }

        const warehouseNode = nodeMap.get(warehouseId)!;
        const ngoNode = nodeMap.get(ngoId)!;

        const travelHours = (alloc.distance_km || 0) / 40;
        const start = new Date(simulationStartMs + idx * stepMs);
        const eta = new Date(start.getTime() + travelHours * 3600 * 1000);

        const shipment: Shipment = {
          id: `ship-${shipmentId++}`,
          shipmentId: `SHP-${alloc.requestId}-${idx}`,
          fromNodeId: warehouseId,
          toNodeId: ngoId,
          fromLat: warehouseNode.lat,
          fromLng: warehouseNode.lng,
          toLat: ngoNode.lat,
          toLng: ngoNode.lng,
          foodItem: alloc.foodType,
          value: alloc.allocated_kg,
          startTime: start,
          etaTime: eta,
          arrivedTime: eta,
          status: "delivered",
        };
        shipments.push(shipment);

        events.push({
          id: `evt-${eventId++}`,
          eventId: `EVT-${alloc.requestId}-start`,
          type: "shipment_created",
          time: start,
          lat: warehouseNode.lat,
          lng: warehouseNode.lng,
          payload: {
            shipmentId: shipment.shipmentId,
            foodType: alloc.foodType,
          },
        });

        events.push({
          id: `evt-${eventId++}`,
          eventId: `EVT-${alloc.requestId}-end`,
          type: "shipment_arrived",
          time: eta,
          lat: ngoNode.lat,
          lng: ngoNode.lng,
          payload: { shipmentId: shipment.shipmentId },
        });
      }

      return {
        nodes,
        events,
        shipments,
        metrics: allocData.metrics,
        totals: { requestedKg, allocatedKg },
      };
    };
  }, []);

  const notes = useMemo(
    () => [
      "This view uses the backend’s real Regular vs ML allocation logic.",
      "The ML path uses freshness-aware scoring and calls the ML service (/predict) for regional signals when available.",
      "KPIs include delivery-time spoilage estimates (freshness at ETA).",
    ],
    [],
  );

  const fetchSignals = async () => {
    setSignalsLoading(true);
    setSignalsError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ml/sendData`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Failed to fetch ML signals: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
        );
      }

      const envelope =
        (await response.json()) as ApiResponseEnvelope<MLPredictResponse>;
      const payload = envelope?.data as MLPredictResponse | undefined;
      const results = Array.isArray(payload?.results) ? payload!.results! : [];

      setSignals(results);
      if (results.length > 0) {
        const firstKey = regionKeyOf(results[0]);
        setSelectedSignalKey((prev) => prev || firstKey);
      }
    } catch (err) {
      setSignalsError(
        err instanceof Error ? err.message : "Failed to fetch ML signals",
      );
    } finally {
      setSignalsLoading(false);
    }
  };

  useEffect(() => {
    if (!signalsOpen) return;
    if (signalsLoading) return;
    if (signals.length > 0) return;
    void fetchSignals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalsOpen]);

  const signalsSummary = useMemo(() => {
    const total = signals.length;
    const anomalies = signals.filter(
      (r) => asNumber(r.is_anomaly, 0) === 1,
    ).length;
    const uniqueRegions = new Set(signals.map(regionKeyOf)).size;
    const clusters = new Map<number, { total: number; anomalies: number }>();
    for (const row of signals) {
      const cid = asNumber(row.cluster_id, -1);
      const curr = clusters.get(cid) || { total: 0, anomalies: 0 };
      curr.total += 1;
      if (asNumber(row.is_anomaly, 0) === 1) curr.anomalies += 1;
      clusters.set(cid, curr);
    }
    const clusterRows = [...clusters.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([clusterId, stats]) => ({ clusterId, ...stats }));
    return { total, anomalies, uniqueRegions, clusterRows };
  }, [signals]);

  const regionAggregates = useMemo(() => {
    const byKey = new Map<string, MLRegionAggregate>();

    for (const row of signals) {
      const key = regionKeyOf(row);
      const state = String(row.state || "Unknown");
      const district = String(row.district || "Unknown");

      const existing = byKey.get(key);
      if (!existing) {
        const isAnomaly = asNumber(row.is_anomaly, 0) === 1;
        const score = asNumber(row.anomaly_score, 0);
        const latestPeriodMs = periodMsOf(row);
        byKey.set(key, {
          key,
          state,
          district,
          rows: [row],
          latestRow: row,
          latestPeriodMs,
          worstRow: row,
          worstScore: score,
          anomalyCount: isAnomaly ? 1 : 0,
          isAnomalyLatest: isAnomaly,
          isAnomalyEver: isAnomaly,
          urgencyBoostLatest: isAnomaly ? 1.1 : 1.0,
        });
        continue;
      }

      existing.rows.push(row);

      const rowIsAnomaly = asNumber(row.is_anomaly, 0) === 1;
      if (rowIsAnomaly) existing.anomalyCount += 1;

      const ms = periodMsOf(row);
      if (ms >= existing.latestPeriodMs) {
        existing.latestPeriodMs = ms;
        existing.latestRow = row;
        existing.isAnomalyLatest = rowIsAnomaly;
        existing.urgencyBoostLatest = rowIsAnomaly ? 1.1 : 1.0;
      }

      const score = asNumber(row.anomaly_score, 0);
      // Lower decision_function typically indicates more anomalous; treat min as “worst”.
      if (score < existing.worstScore) {
        existing.worstScore = score;
        existing.worstRow = row;
      }

      existing.isAnomalyEver = existing.anomalyCount > 0;
    }

    return [...byKey.values()];
  }, [signals]);

  const regionSummary = useMemo(() => {
    const totalRegions = regionAggregates.length;
    const boostedRegions = regionAggregates.filter(
      (r) => r.isAnomalyLatest,
    ).length;
    const everAnomalousRegions = regionAggregates.filter(
      (r) => r.isAnomalyEver,
    ).length;
    const normalRegions = totalRegions - boostedRegions;
    return {
      totalRegions,
      boostedRegions,
      normalRegions,
      everAnomalousRegions,
    };
  }, [regionAggregates]);

  const filteredRegions = useMemo(() => {
    const q = signalSearch.trim().toLowerCase();

    let base = regionAggregates;

    if (signalFilter === "boosted") {
      base = base.filter((r) => r.isAnomalyLatest);
    } else if (signalFilter === "normal") {
      base = base.filter((r) => !r.isAnomalyLatest);
    } else if (signalFilter === "ever") {
      base = base.filter((r) => r.isAnomalyEver);
    }

    if (q) {
      base = base.filter((region) => {
        const key = region.key.toLowerCase();
        const cluster = String(asNumber(region.latestRow.cluster_id, -1));
        const period = String(
          region.latestRow.period_start || "",
        ).toLowerCase();
        return key.includes(q) || cluster.includes(q) || period.includes(q);
      });
    }

    const sorted = [...base];
    if (signalSort === "boostFirst") {
      sorted.sort((a, b) => {
        if (a.isAnomalyLatest !== b.isAnomalyLatest) {
          return a.isAnomalyLatest ? -1 : 1;
        }
        return a.worstScore - b.worstScore;
      });
    } else if (signalSort === "worstScore") {
      sorted.sort((a, b) => a.worstScore - b.worstScore);
    } else if (signalSort === "latest") {
      sorted.sort((a, b) => b.latestPeriodMs - a.latestPeriodMs);
    } else {
      sorted.sort((a, b) => a.key.localeCompare(b.key));
    }

    return sorted;
  }, [regionAggregates, signalFilter, signalSearch, signalSort]);

  const selectedRegion = useMemo(() => {
    if (!selectedSignalKey) return null;
    return regionAggregates.find((r) => r.key === selectedSignalKey) || null;
  }, [regionAggregates, selectedSignalKey]);

  useEffect(() => {
    if (!signalsOpen) return;
    if (filteredRegions.length === 0) return;
    if (!selectedSignalKey) {
      setSelectedSignalKey(filteredRegions[0].key);
      return;
    }
    const exists = filteredRegions.some((r) => r.key === selectedSignalKey);
    if (!exists) setSelectedSignalKey(filteredRegions[0].key);
  }, [signalsOpen, filteredRegions, selectedSignalKey]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      setIsPlaying(false);

      try {
        const response = await fetch(`${API_BASE_URL}/api/history/simulate`);
        const json = (await response.json()) as BackendSimulateResponse;
        if (!json.success) {
          throw new Error("Simulation endpoint returned an error");
        }

        const baseTime = new Date(json.data.startTime);
        const regularData = convertToTimelineData(json.data.regular, baseTime);
        const mlData = convertToTimelineData(json.data.ml, baseTime);
        setRegular(regularData);
        setMl(mlData);

        const allTimes: number[] = [];
        for (const e of regularData.events) allTimes.push(e.time.getTime());
        for (const e of mlData.events) allTimes.push(e.time.getTime());
        const computedStart =
          allTimes.length > 0
            ? new Date(Math.min(...allTimes))
            : new Date(baseTime.getTime() - 1000);
        const computedEnd =
          allTimes.length > 0
            ? new Date(Math.max(...allTimes))
            : new Date(baseTime.getTime() + 1000);

        setStartTime(computedStart);
        setEndTime(computedEnd);
        setCurrentTime(computedStart);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load simulation",
        );
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [convertToTimelineData]);

  const kpis = useMemo(() => {
    if (!regular || !ml) return null;

    const regularDelivered =
      regular.metrics.deliveredKg ?? regular.totals.allocatedKg;
    const mlDelivered = ml.metrics.deliveredKg ?? ml.totals.allocatedKg;

    const regularSpoiled = regular.metrics.deliveredSpoiledKg ?? 0;
    const mlSpoiled = ml.metrics.deliveredSpoiledKg ?? 0;
    const foodSavedKg = regularSpoiled - mlSpoiled;
    const spoilageReductionPct = pctDelta(regularSpoiled, mlSpoiled);

    const regularAtRisk = regular.metrics.deliveredAtRiskKg ?? 0;
    const mlAtRisk = ml.metrics.deliveredAtRiskKg ?? 0;

    const regularSpoilageRatePct = safePct(regularSpoiled, regularDelivered);
    const mlSpoilageRatePct = safePct(mlSpoiled, mlDelivered);

    const regularAtRiskRatePct = safePct(regularAtRisk, regularDelivered);
    const mlAtRiskRatePct = safePct(mlAtRisk, mlDelivered);

    const savedOutOfRegularDeliveredPct = safePct(
      foodSavedKg,
      regularDelivered,
    );

    const regularDistanceKm =
      regular.metrics.totalDistanceKm ??
      (regular.metrics.avgDistance ?? 0) * regular.shipments.length;
    const mlDistanceKm =
      ml.metrics.totalDistanceKm ??
      (ml.metrics.avgDistance ?? 0) * ml.shipments.length;
    const distanceReductionPct = pctDelta(regularDistanceKm, mlDistanceKm);

    const regularAvgDistanceKm = regular.metrics.avgDistance ?? 0;
    const mlAvgDistanceKm = ml.metrics.avgDistance ?? 0;
    const avgDistanceReductionPct = pctDelta(
      regularAvgDistanceKm,
      mlAvgDistanceKm,
    );

    return {
      foodSavedKg,
      spoilageReductionPct,
      regularDelivered,
      mlDelivered,
      regularSpoiled,
      mlSpoiled,
      regularAtRisk,
      mlAtRisk,
      regularSpoilageRatePct,
      mlSpoilageRatePct,
      regularAtRiskRatePct,
      mlAtRiskRatePct,
      savedOutOfRegularDeliveredPct,
      regularDistanceKm,
      mlDistanceKm,
      distanceReductionPct,
      regularAvgDistanceKm,
      mlAvgDistanceKm,
      avgDistanceReductionPct,
    };
  }, [regular, ml]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">
              Timeline Comparison (Regular vs ML)
            </h1>
            <p className="text-sm text-zinc-500">
              Same sample scenario, two routing strategies.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSignalsOpen(true)}
              className="text-sm px-3 py-1.5 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700"
              title="See clustering + anomaly detection signals used by ML allocation"
            >
              ML Signals
            </button>
            <a
              href="/admin"
              className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              Back to Admin
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Status */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="text-red-800 font-medium">Error</div>
            <div className="text-red-700 text-sm mt-1">{error}</div>
            <div className="text-red-700 text-sm mt-2">
              Ensure the backend is running on `NEXT_PUBLIC_API_URL` and the ML
              service is reachable.
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-lg border border-zinc-200 p-6 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <div className="text-sm text-zinc-700">Loading simulation…</div>
            </div>
          </div>
        )}

        {/* KPI row */}
        {regular && ml && kpis && (
          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-4">
                <div className="text-xs uppercase tracking-wide text-emerald-900/70">
                  Food Saved (less spoiled at delivery)
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-emerald-900/70">Saved</div>
                    <div className="text-2xl font-semibold text-emerald-900">
                      {fmtKg(kpis.foodSavedKg)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-emerald-900/70">Reduction</div>
                    <div className="text-2xl font-semibold text-emerald-900">
                      {kpis.spoilageReductionPct.toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-sm text-emerald-900/80 space-y-1">
                  <div>
                    Out of{" "}
                    <span className="font-medium">
                      {fmtKg(kpis.regularSpoiled)}
                    </span>{" "}
                    that Regular would spoil @ delivery
                  </div>
                  <div>
                    That’s{" "}
                    <span className="font-medium">
                      {pct(kpis.savedOutOfRegularDeliveredPct)}
                    </span>{" "}
                    of Regular delivered volume
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Spoiled @ Delivery
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Regular</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {fmtKg(kpis.regularSpoiled)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {pct(kpis.regularSpoilageRatePct)} of delivered
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-500">ML</div>
                    <div className="text-lg font-semibold text-emerald-700">
                      {fmtKg(kpis.mlSpoiled)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {pct(kpis.mlSpoilageRatePct)} of delivered
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Delivered Freshness (kg-weighted)
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Regular</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {(regular.metrics.deliveredAvgFreshness ?? 0).toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-500">ML</div>
                    <div className="text-lg font-semibold text-emerald-700">
                      {(ml.metrics.deliveredAvgFreshness ?? 0).toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Total Requested
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Same scenario</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {fmtKg(regular.totals.requestedKg)}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Used for both strategies
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Total Delivered
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Regular</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {fmtKg(kpis.regularDelivered)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-500">ML</div>
                    <div className="text-lg font-semibold text-emerald-700">
                      {fmtKg(kpis.mlDelivered)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Fulfillment
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Regular</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {pct(regular.metrics.fulfillmentRate)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-500">ML</div>
                    <div className="text-lg font-semibold text-emerald-700">
                      {pct(ml.metrics.fulfillmentRate)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  At-Risk Delivered (&lt;20% freshness)
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Regular</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {fmtKg(kpis.regularAtRisk)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {pct(kpis.regularAtRiskRatePct)} of delivered
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-500">ML</div>
                    <div className="text-lg font-semibold text-emerald-700">
                      {fmtKg(kpis.mlAtRisk)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {pct(kpis.mlAtRiskRatePct)} of delivered
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Distance (avg / shipment)
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Regular</div>
                    <div className="text-lg font-semibold text-zinc-900">
                      {fmtKm(kpis.regularAvgDistanceKm)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-500">ML</div>
                    <div className="text-lg font-semibold text-emerald-700">
                      {fmtKm(kpis.mlAvgDistanceKm)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {kpis.avgDistanceReductionPct >= 0 ? "-" : "+"}
                      {Math.abs(kpis.avgDistanceReductionPct).toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-zinc-500 flex items-center justify-between">
                  <span>Total (sum)</span>
                  <span>
                    {fmtKm(kpis.regularDistanceKm)} → {fmtKm(kpis.mlDistanceKm)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="bg-white rounded-lg border border-zinc-200 p-4 mb-6">
          <div className="text-sm font-medium text-zinc-900 mb-2">
            What “ML” means on this page
          </div>
          <ul className="text-sm text-zinc-600 list-disc pl-5 space-y-1">
            {notes.map((n, idx) => (
              <li key={idx}>{n}</li>
            ))}
          </ul>

          {regular && ml && kpis && (
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Why ML improves outcomes
                </div>
                <div className="mt-2 text-sm text-zinc-700 space-y-1">
                  <div>
                    • Prefers batches that will still be fresh at ETA (spoilage
                    ↓).
                  </div>
                  <div>
                    • Strongly prefers closer warehouses (distance caps +
                    decay).
                  </div>
                  <div>
                    • Uses anomaly signals to slightly boost urgency where
                    demand may spike.
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs uppercase tracking-wide text-emerald-900/70">
                  ML impact at a glance
                </div>
                <div className="mt-2 text-sm text-emerald-900/90 space-y-1">
                  <div>
                    • Food saved:{" "}
                    <span className="font-medium">
                      {fmtKg(kpis.foodSavedKg)}
                    </span>
                  </div>
                  <div>
                    • Spoilage reduction:{" "}
                    <span className="font-medium">
                      {kpis.spoilageReductionPct.toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    • Avg distance change:{" "}
                    <span className="font-medium">
                      {kpis.avgDistanceReductionPct >= 0 ? "-" : "+"}
                      {Math.abs(kpis.avgDistanceReductionPct).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Urgency boost (signal → action)
                </div>
                <div className="mt-2 text-sm text-zinc-700">
                  If a region is anomalous, allocation scoring applies:
                  <div className="mt-2 font-mono text-xs bg-zinc-50 border border-zinc-200 rounded p-2">
                    urgencyBoost = is_anomaly ? 1.1 : 1.0
                  </div>
                  <div className="mt-2 text-xs text-zinc-500">
                    Open “ML Signals” to inspect clusters/anomalies per region.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Maps */}
        {regular && ml && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <section className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">
                    Regular (Baseline)
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Rule-based allocation from backend
                  </p>
                </div>
                <span className="text-xs text-zinc-500">
                  Allocations: {regular.shipments.length}
                </span>
              </div>
              <div className="h-[520px]">
                <MapTimeline
                  nodes={regular.nodes}
                  events={regular.events}
                  shipments={regular.shipments}
                  shipmentLocationUpdates={[]}
                  currentTime={currentTime}
                  startTime={startTime}
                  endTime={endTime}
                />
              </div>
            </section>

            <section className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">
                    ML-Optimized
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Freshness-aware + (optional) ML regional signals
                  </p>
                </div>
                <span className="text-xs text-zinc-500">
                  Allocations: {ml.shipments.length}
                </span>
              </div>
              <div className="h-[520px]">
                <MapTimeline
                  nodes={ml.nodes}
                  events={ml.events}
                  shipments={ml.shipments}
                  shipmentLocationUpdates={[]}
                  currentTime={currentTime}
                  startTime={startTime}
                  endTime={endTime}
                />
              </div>
            </section>
          </div>
        )}

        {/* Shared timeline controls */}
        <div className="relative h-[90px]">
          <TimelineControl
            startTime={startTime}
            endTime={endTime}
            currentTime={currentTime}
            onTimeChange={setCurrentTime}
            isPlaying={isPlaying}
            onPlayPause={setIsPlaying}
          />
        </div>
      </main>

      {/* ML Signals drawer */}
      {signalsOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSignalsOpen(false)}
          />

          <aside className="absolute right-0 top-0 h-full w-full max-w-[520px] bg-white shadow-xl border-l border-zinc-200 flex flex-col">
            <div className="p-4 border-b border-zinc-200 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  ML Signals (Clustering + Anomaly Detection)
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Data comes from `POST /api/ml/sendData` → ML `/predict`.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchSignals()}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700"
                  disabled={signalsLoading}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setSignalsOpen(false)}
                  className="text-xs px-2.5 py-1.5 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-zinc-200">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-xs text-zinc-500">Rows</div>
                  <div className="text-lg font-semibold text-zinc-900">
                    {signalsSummary.total}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-xs text-zinc-500">Regions</div>
                  <div className="text-lg font-semibold text-zinc-900">
                    {regionSummary.totalRegions}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs text-amber-900/70">Boosted now</div>
                  <div className="text-lg font-semibold text-amber-900">
                    {regionSummary.boostedRegions}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  value={signalSearch}
                  onChange={(e) => setSignalSearch(e.target.value)}
                  placeholder="Search region / cluster / period…"
                  className="w-full text-sm rounded-md border border-zinc-200 px-3 py-2"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSignalFilter("all")}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                    signalFilter === "all"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter("boosted")}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                    signalFilter === "boosted"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  title="Regions boosted now (latest period is_anomaly=1 → urgencyBoost=1.1)."
                >
                  Boosted now ({regionSummary.boostedRegions})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter("normal")}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                    signalFilter === "normal"
                      ? "border-zinc-300 bg-zinc-100 text-zinc-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  Normal now ({regionSummary.normalRegions})
                </button>
                <button
                  type="button"
                  onClick={() => setSignalFilter("ever")}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                    signalFilter === "ever"
                      ? "border-purple-300 bg-purple-50 text-purple-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  title="Regions that were anomalous at least once (any period in the returned history)."
                >
                  Had anomalies ({regionSummary.everAnomalousRegions})
                </button>

                <div className="ml-auto flex items-center gap-2">
                  <label className="text-xs text-zinc-500">Sort</label>
                  <select
                    value={signalSort}
                    onChange={(e) =>
                      setSignalSort(e.target.value as MLRegionSort)
                    }
                    className="text-xs rounded-md border border-zinc-200 px-2 py-1.5 bg-white"
                  >
                    <option value="boostFirst">
                      Boosted now → worst score
                    </option>
                    <option value="worstScore">Worst score</option>
                    <option value="latest">Latest period</option>
                    <option value="name">Region name</option>
                  </select>
                </div>
              </div>

              {signalsError && (
                <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                  {signalsError}
                </div>
              )}
              {signalsLoading && (
                <div className="mt-3 text-sm text-zinc-600">
                  Loading ML signals…
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              <div className="p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                  Clusters (count / anomalies)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {signalsSummary.clusterRows.map((row) => (
                    <div
                      key={row.clusterId}
                      className="rounded border border-zinc-200 bg-white p-2"
                    >
                      <div className="text-sm font-medium text-zinc-900">
                        Cluster {row.clusterId}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {row.total} rows • {row.anomalies} anomalies
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 text-xs uppercase tracking-wide text-zinc-500 mb-2">
                  Regions (select one)
                </div>
                <div className="space-y-2">
                  {filteredRegions.slice(0, 200).map((region) => {
                    const key = region.key;
                    const isSelected = key === selectedSignalKey;
                    const isBoosted = region.isAnomalyLatest;
                    const score = region.worstScore;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setSelectedSignalKey(key)}
                        className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                          isSelected
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-zinc-200 bg-white hover:bg-zinc-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-zinc-900">
                              {key}
                            </div>
                            <div className="text-xs text-zinc-500">
                              Latest: {fmtPeriod(region.latestRow.period_start)}{" "}
                              • Cluster{" "}
                              {asNumber(region.latestRow.cluster_id, -1)}
                              {region.isAnomalyEver
                                ? ` • anomalies ${region.anomalyCount}`
                                : ""}
                              {` • worst score ${fmtScore(score)}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {region.isAnomalyEver && !isBoosted && (
                              <div className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-900">
                                Had anomalies
                              </div>
                            )}
                            <div
                              className={`text-xs px-2 py-1 rounded ${
                                isBoosted
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-zinc-100 text-zinc-700"
                              }`}
                              title={
                                isBoosted
                                  ? "Boosted now (latest period is anomalous → urgencyBoost=1.1)"
                                  : "Normal now (latest period is not anomalous → urgencyBoost=1.0)"
                              }
                            >
                              {isBoosted ? "Boosted now" : "Normal now"}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {filteredRegions.length > 200 && (
                    <div className="text-xs text-zinc-500">
                      Showing first 200 matches. Refine search to narrow.
                    </div>
                  )}
                </div>

                <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-sm font-semibold text-zinc-900">
                    Selected region signal
                  </div>
                  {selectedRegion ? (
                    <div className="mt-2 text-sm text-zinc-700 space-y-2">
                      <div>
                        <span className="text-zinc-500">Region:</span>{" "}
                        {selectedRegion.key}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded border border-zinc-200 bg-white p-2">
                          <div className="text-xs text-zinc-500">
                            Latest cluster
                          </div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {asNumber(selectedRegion.latestRow.cluster_id, -1)}
                          </div>
                        </div>
                        <div className="rounded border border-zinc-200 bg-white p-2">
                          <div className="text-xs text-zinc-500">
                            Worst score
                          </div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {fmtScore(selectedRegion.worstScore)}
                          </div>
                        </div>
                        <div className="rounded border border-zinc-200 bg-white p-2">
                          <div className="text-xs text-zinc-500">
                            Urgency boost
                          </div>
                          <div className="text-sm font-semibold text-zinc-900">
                            ×{selectedRegion.urgencyBoostLatest.toFixed(1)}
                          </div>
                        </div>
                      </div>

                      <div className="rounded border border-zinc-200 bg-white p-3">
                        <div className="text-xs uppercase tracking-wide text-zinc-500">
                          Latest vs worst
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div className="rounded border border-zinc-200 bg-zinc-50 p-2">
                            <div className="text-xs text-zinc-500">
                              Latest period
                            </div>
                            <div className="text-sm font-semibold text-zinc-900">
                              {fmtPeriod(selectedRegion.latestRow.period_start)}
                            </div>
                            <div className="text-xs text-zinc-600 mt-1">
                              score{" "}
                              {fmtScore(
                                asNumber(
                                  selectedRegion.latestRow.anomaly_score,
                                  0,
                                ),
                              )}
                              {selectedRegion.isAnomalyLatest
                                ? " • anomalous"
                                : ""}
                            </div>
                          </div>
                          <div className="rounded border border-zinc-200 bg-zinc-50 p-2">
                            <div className="text-xs text-zinc-500">
                              Worst period
                            </div>
                            <div className="text-sm font-semibold text-zinc-900">
                              {fmtPeriod(selectedRegion.worstRow.period_start)}
                            </div>
                            <div className="text-xs text-zinc-600 mt-1">
                              score{" "}
                              {fmtScore(
                                asNumber(
                                  selectedRegion.worstRow.anomaly_score,
                                  0,
                                ),
                              )}
                              {asNumber(
                                selectedRegion.worstRow.is_anomaly,
                                0,
                              ) === 1
                                ? " • anomalous"
                                : ""}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded border border-zinc-200 bg-white p-3">
                        <div className="text-xs uppercase tracking-wide text-zinc-500">
                          Recent periods
                        </div>
                        <div className="mt-2 space-y-1">
                          {[...selectedRegion.rows]
                            .sort((a, b) => periodMsOf(b) - periodMsOf(a))
                            .slice(0, 8)
                            .map((row, idx) => {
                              const isAnomaly =
                                asNumber(row.is_anomaly, 0) === 1;
                              return (
                                <div
                                  key={`${selectedRegion.key}-p-${idx}`}
                                  className={`flex items-center justify-between rounded border px-2 py-1 ${
                                    isAnomaly
                                      ? "border-amber-200 bg-amber-50"
                                      : "border-zinc-200 bg-zinc-50"
                                  }`}
                                >
                                  <div className="text-xs text-zinc-700">
                                    {fmtPeriod(row.period_start)}
                                  </div>
                                  <div className="text-xs text-zinc-600">
                                    c{asNumber(row.cluster_id, -1)} •{" "}
                                    {fmtScore(asNumber(row.anomaly_score, 0))}
                                  </div>
                                  <div
                                    className={`text-[11px] px-1.5 py-0.5 rounded ${
                                      isAnomaly
                                        ? "bg-amber-100 text-amber-900"
                                        : "bg-zinc-100 text-zinc-700"
                                    }`}
                                  >
                                    {isAnomaly ? "Anomaly" : "Normal"}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>

                      <div className="text-xs text-zinc-500">
                        In `allocateML`, anomalous regions get a small boost so
                        the optimizer prioritizes them earlier when tradeoffs
                        exist.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-zinc-600">
                      Select a region to inspect.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-zinc-200 text-xs text-zinc-500">
              Tip: these signals come from the trained models in `ml/artifacts/`
              (cluster centers + anomaly boundary). They are not recomputed from
              scratch during simulation.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
