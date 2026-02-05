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
  dispatchTime?: string;
  batches: {
    batchId: string;
    quantity: number;
    freshness: number;
    freshness_at_delivery?: number;
  }[];
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
    snapshotDate?: string;
    mlSnapshotPayload?: {
      freq?: string;
      nodes?: unknown[];
      requests?: unknown[];
      shipments?: unknown[];
      batches?: unknown[];
      meta?: unknown;
    };
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
  allocations?: BackendAllocation[];
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

function fmtKgNice(n: number) {
  if (!Number.isFinite(n)) return "0 kg";
  const fmt = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
  return `${fmt.format(n)} kg`;
}

function fmtScore(n: number) {
  if (!Number.isFinite(n)) return "0.000";
  return n.toFixed(3);
}

function asNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getStringProp(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const raw = obj[key];
  return typeof raw === "string" && raw ? raw : null;
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
  const [mlSnapshotPayload, setMlSnapshotPayload] = useState<
    BackendSimulateResponse["data"]["mlSnapshotPayload"] | null
  >(null);
  const [snapshotDateIso, setSnapshotDateIso] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [windowDays, setWindowDays] = useState<number>(7);

  const [signalsOpen, setSignalsOpen] = useState(false);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState<string | null>(null);
  const [signals, setSignals] = useState<MLSignalRow[]>([]);
  const [signalsScope, setSignalsScope] = useState<"snapshot" | "all">(
    "snapshot",
  );
  const [selectedSignalKey, setSelectedSignalKey] = useState<string | null>(
    null,
  );
  const [signalSearch, setSignalSearch] = useState("");
  const [signalFilter, setSignalFilter] = useState<MLRegionFilter>("all");
  const [signalSort, setSignalSort] = useState<MLRegionSort>("boostFirst");

  const [perfMode, setPerfMode] = useState<boolean>(true);

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

        const allocatedNowKg = asNumber(alloc.allocated_kg, 0);
        if (allocatedNowKg <= 0) {
          continue;
        }

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

        const avgSpeedKmh = 40;
        const travelHours = (alloc.distance_km || 0) / avgSpeedKmh;
        const breaks = Math.floor(travelHours / 4) * 0.5;
        const totalTravelHours = travelHours + breaks;

        const start = alloc.dispatchTime
          ? new Date(alloc.dispatchTime)
          : new Date(simulationStartMs + idx * stepMs);
        const eta = new Date(start.getTime() + totalTravelHours * 3600 * 1000);

        // Use backend's batch freshness_at_delivery if available
        let weightedFreshness = 0;
        let totalQty = 0;
        let spoiledKg = 0;
        let atRiskKg = 0;
        for (const batch of alloc.batches || []) {
          const qty = batch.quantity || 0;
          if (qty <= 0) continue;
          totalQty += qty;

          const freshnessAtArrival =
            typeof (batch as { freshness_at_delivery?: number })
              .freshness_at_delivery === "number"
              ? (batch as { freshness_at_delivery?: number })
                  .freshness_at_delivery!
              : typeof batch.freshness === "number"
                ? batch.freshness
                : 100;

          weightedFreshness += freshnessAtArrival * qty;
          if (freshnessAtArrival <= 0) spoiledKg += qty;
          else if (freshnessAtArrival < 20) atRiskKg += qty;
        }
        const avgFreshnessAtArrival =
          totalQty > 0 ? weightedFreshness / totalQty : 100;

        // If we have no concrete batch quantity, don't create a shipment.
        if (totalQty <= 0) {
          continue;
        }

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
          quantity_kg: alloc.allocated_kg,
          distance_km: alloc.distance_km || 0,
          freshness_at_arrival: avgFreshnessAtArrival,
          spoiled_kg: spoiledKg,
          at_risk_kg: atRiskKg,
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
        allocations: allocData.allocations,
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
      if (!mlSnapshotPayload) {
        throw new Error(
          "Simulation snapshot not loaded yet. Please wait for the simulation to load before opening ML Signals.",
        );
      }

      const response = await fetch(`${API_BASE_URL}/api/ml/sendData`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          freq: mlSnapshotPayload.freq || "M",
          nodes: mlSnapshotPayload.nodes || [],
          requests: mlSnapshotPayload.requests || [],
          shipments: mlSnapshotPayload.shipments || [],
          batches: mlSnapshotPayload.batches || [],
          meta: mlSnapshotPayload.meta,
        }),
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

  // If the simulation snapshot changes, cached signals become invalid.
  useEffect(() => {
    setSignals([]);
    setSignalsError(null);
    setSelectedSignalKey(null);
  }, [snapshotDateIso, mlSnapshotPayload]);

  useEffect(() => {
    if (!signalsOpen) return;
    if (signalsLoading) return;
    if (signals.length > 0) return;
    void fetchSignals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    signalsOpen,
    signalsLoading,
    signals.length,
    snapshotDateIso,
    mlSnapshotPayload,
  ]);

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

  const signalsSnapshotIso = useMemo(() => {
    const iso =
      snapshotDateIso ||
      getStringProp(mlSnapshotPayload?.meta, "targetDate_iso");
    return typeof iso === "string" && iso ? iso : null;
  }, [snapshotDateIso, mlSnapshotPayload]);

  const snapshotPayloadCounts = useMemo(() => {
    const nodes = Array.isArray(mlSnapshotPayload?.nodes)
      ? mlSnapshotPayload!.nodes!.length
      : 0;
    const requests = Array.isArray(mlSnapshotPayload?.requests)
      ? mlSnapshotPayload!.requests!.length
      : 0;
    const shipments = Array.isArray(mlSnapshotPayload?.shipments)
      ? mlSnapshotPayload!.shipments!.length
      : 0;
    const batches = Array.isArray(mlSnapshotPayload?.batches)
      ? mlSnapshotPayload!.batches!.length
      : 0;
    return { nodes, requests, shipments, batches };
  }, [mlSnapshotPayload]);

  const effectiveSignals = useMemo(() => {
    if (signalsScope === "all") return signals;

    // Goal: show clusters/anomalies for the *simulated snapshot*, not arbitrary historical periods.
    // When snapshot date is known, filter ML rows down to that month (freq=M).
    const iso =
      snapshotDateIso ||
      getStringProp(mlSnapshotPayload?.meta, "targetDate_iso");
    if (!iso) return signals;

    const snapMs = Date.parse(iso);
    if (!Number.isFinite(snapMs)) return signals;

    const snap = new Date(snapMs);
    const periodStart = new Date(
      Date.UTC(snap.getUTCFullYear(), snap.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    const nextPeriodStart = new Date(
      Date.UTC(snap.getUTCFullYear(), snap.getUTCMonth() + 1, 1, 0, 0, 0, 0),
    );

    const startMs = periodStart.getTime();
    const endMs = nextPeriodStart.getTime();
    const filtered = signals.filter((r) => {
      const ms = periodMsOf(r);
      return ms >= startMs && ms < endMs;
    });

    return filtered;
  }, [signals, snapshotDateIso, mlSnapshotPayload, signalsScope]);

  const signalsPeriodRange = useMemo(() => {
    if (signals.length === 0) return null;
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const row of signals) {
      const ms = periodMsOf(row);
      if (!ms) continue;
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
    }
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return null;
    return {
      minIso: new Date(minMs).toISOString().slice(0, 10),
      maxIso: new Date(maxMs).toISOString().slice(0, 10),
    };
  }, [signals]);

  const regionAggregates = useMemo(() => {
    const byKey = new Map<string, MLRegionAggregate>();

    for (const row of effectiveSignals) {
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
  }, [effectiveSignals]);

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
        const response = await fetch(
          `${API_BASE_URL}/api/history/simulate?date=${encodeURIComponent(selectedDate)}&days=${encodeURIComponent(String(windowDays))}&backlog=10&dispatchMode=spread`,
        );
        const json = (await response.json()) as BackendSimulateResponse;
        if (!json.success) {
          throw new Error("Simulation endpoint returned an error");
        }

        setMlSnapshotPayload(json.data.mlSnapshotPayload || null);
        setSnapshotDateIso(
          typeof json.data.snapshotDate === "string"
            ? json.data.snapshotDate
            : null,
        );

        const simStart = new Date(json.data.startTime);
        const simEnd = new Date(json.data.endTime);
        const baseTime = simStart;
        const regularData = convertToTimelineData(json.data.regular, baseTime);
        const mlData = convertToTimelineData(json.data.ml, baseTime);
        setRegular(regularData);
        setMl(mlData);

        const start = Number.isFinite(simStart.getTime())
          ? simStart
          : new Date(baseTime.getTime() - 1000);
        const end = Number.isFinite(simEnd.getTime())
          ? simEnd
          : new Date(baseTime.getTime() + 1000);

        setStartTime(start);
        setEndTime(end);
        // Start timeline at the beginning, not at the end
        setCurrentTime(start);
        setIsPlaying(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load simulation",
        );
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [convertToTimelineData, selectedDate, windowDays]);

  // Dynamic metrics that update in real-time as the simulation progresses
  const kpis = useMemo(() => {
    if (!regular || !ml) return null;

    const currentMs = currentTime.getTime();

    // Helper to compute metrics for shipments that have arrived by currentTime
    const computeDynamicMetrics = (data: TimelineData) => {
      const shipmentsWithQty = data.shipments.filter(
        (s) => asNumber(s.quantity_kg, 0) > 0,
      );

      const completedShipments = shipmentsWithQty.filter(
        (s) => s.arrivedTime && s.arrivedTime.getTime() <= currentMs,
      );
      const inTransitShipments = shipmentsWithQty.filter(
        (s) =>
          s.startTime.getTime() <= currentMs &&
          (!s.arrivedTime || s.arrivedTime.getTime() > currentMs),
      );
      const pendingShipments = shipmentsWithQty.filter(
        (s) => s.startTime.getTime() > currentMs,
      );

      let deliveredKg = 0;
      let spoiledKg = 0;
      let atRiskKg = 0;
      let totalDistanceKm = 0;

      for (const shipment of completedShipments) {
        const qty = asNumber(shipment.quantity_kg, 0);
        deliveredKg += qty;

        const spoiled = asNumber(shipment.spoiled_kg, NaN);
        const atRisk = asNumber(shipment.at_risk_kg, NaN);

        if (Number.isFinite(spoiled)) {
          spoiledKg += spoiled;
        } else {
          const freshness = asNumber(shipment.freshness_at_arrival, 100);
          if (freshness <= 0) spoiledKg += qty;
        }

        if (Number.isFinite(atRisk)) {
          atRiskKg += atRisk;
        } else {
          const freshness = asNumber(shipment.freshness_at_arrival, 100);
          if (freshness > 0 && freshness < 20) atRiskKg += qty;
        }

        totalDistanceKm += asNumber(shipment.distance_km, 0);
      }

      const edibleDelivered = Math.max(0, deliveredKg - spoiledKg);
      const freshDelivered = Math.max(0, edibleDelivered - atRiskKg);
      const spoilageRatePct = safePct(spoiledKg, deliveredKg);
      const atRiskRatePct = safePct(atRiskKg, deliveredKg);

      return {
        deliveredKg,
        spoiledKg,
        atRiskKg,
        edibleDelivered,
        freshDelivered,
        spoilageRatePct,
        atRiskRatePct,
        totalDistanceKm,
        completedCount: completedShipments.length,
        inTransitCount: inTransitShipments.length,
        pendingCount: pendingShipments.length,
      };
    };

    const regularDynamic = computeDynamicMetrics(regular);
    const mlDynamic = computeDynamicMetrics(ml);

    const regularEdibleFulfillmentPct = safePct(
      regularDynamic.edibleDelivered,
      regular.totals.requestedKg,
    );
    const mlEdibleFulfillmentPct = safePct(
      mlDynamic.edibleDelivered,
      ml.totals.requestedKg,
    );
    const foodSavedKg = regularDynamic.spoiledKg - mlDynamic.spoiledKg;
    const spoilageReductionPct = pctDelta(
      regularDynamic.spoiledKg,
      mlDynamic.spoiledKg,
    );

    const savedOutOfRegularDeliveredPct = safePct(
      foodSavedKg,
      regularDynamic.deliveredKg,
    );

    const distanceReductionPct = pctDelta(
      regularDynamic.totalDistanceKm,
      mlDynamic.totalDistanceKm,
    );

    const regularAvgDistanceKm =
      regularDynamic.completedCount > 0
        ? regularDynamic.totalDistanceKm / regularDynamic.completedCount
        : 0;
    const mlAvgDistanceKm =
      mlDynamic.completedCount > 0
        ? mlDynamic.totalDistanceKm / mlDynamic.completedCount
        : 0;
    const avgDistanceReductionPct = pctDelta(
      regularAvgDistanceKm,
      mlAvgDistanceKm,
    );

    return {
      foodSavedKg,
      spoilageReductionPct,
      regularDelivered: regularDynamic.deliveredKg,
      mlDelivered: mlDynamic.deliveredKg,
      regularFreshDelivered: regularDynamic.freshDelivered,
      mlFreshDelivered: mlDynamic.freshDelivered,
      regularEdibleFulfillmentPct,
      mlEdibleFulfillmentPct,
      regularSpoiled: regularDynamic.spoiledKg,
      mlSpoiled: mlDynamic.spoiledKg,
      regularAtRisk: regularDynamic.atRiskKg,
      mlAtRisk: mlDynamic.atRiskKg,
      regularSpoilageRatePct: regularDynamic.spoilageRatePct,
      mlSpoilageRatePct: mlDynamic.spoilageRatePct,
      regularAtRiskRatePct: regularDynamic.atRiskRatePct,
      mlAtRiskRatePct: mlDynamic.atRiskRatePct,
      savedOutOfRegularDeliveredPct,
      regularDistanceKm: regularDynamic.totalDistanceKm,
      mlDistanceKm: mlDynamic.totalDistanceKm,
      distanceReductionPct,
      regularAvgDistanceKm,
      mlAvgDistanceKm,
      avgDistanceReductionPct,
      regularCompletedCount: regularDynamic.completedCount,
      mlCompletedCount: mlDynamic.completedCount,
      regularInTransitCount: regularDynamic.inTransitCount,
      mlInTransitCount: mlDynamic.inTransitCount,
      regularPendingCount: regularDynamic.pendingCount,
      mlPendingCount: mlDynamic.pendingCount,
    };
  }, [regular, ml, currentTime]);

  const requestedSoFarKg = useMemo(() => {
    const nowMs = currentTime.getTime();
    if (!Number.isFinite(nowMs)) return 0;

    const requests = Array.isArray(mlSnapshotPayload?.requests)
      ? mlSnapshotPayload!.requests!
      : [];

    let total = 0;
    const startMs = startTime?.getTime?.() ?? NaN;

    for (const r of requests) {
      if (!r || typeof r !== "object") continue;

      const createdIso = getStringProp(
        r as Record<string, unknown>,
        "createdOn_iso",
      );
      const createdMs = createdIso
        ? Date.parse(createdIso)
        : Number.isFinite(startMs)
          ? startMs
          : NaN;

      if (Number.isFinite(createdMs) && createdMs > nowMs) continue;

      const items = (r as Record<string, unknown>).items;
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        total += asNumber((item as Record<string, unknown>).required_kg, 0);
      }
    }

    return total;
  }, [mlSnapshotPayload, startTime, currentTime]);

  const snapshotSupply = useMemo(() => {
    if (!mlSnapshotPayload?.batches) return null;

    const snapMs = currentTime.getTime();
    if (!Number.isFinite(snapMs)) return null;

    let totalKg = 0;
    let knownExpiryKg = 0;
    let inferredExpiryKg = 0;
    let nonExpiredKg = 0;
    let expiringSoonKg = 0;
    let expiredKnownKg = 0;
    let unknownExpiryKg = 0;
    const soonMs = snapMs + 72 * 3600 * 1000; // 72h

    for (const b of mlSnapshotPayload.batches) {
      if (!b || typeof b !== "object") continue;
      const anyB = b as Record<string, unknown>;
      const statusRaw =
        typeof anyB.status === "string" ? anyB.status : "stored";
      const status = statusRaw.toLowerCase();
      if (status !== "stored" && status !== "reserved") continue;

      const qty = asNumber(anyB.quantity_kg, 0);
      if (qty <= 0) continue;

      // Inventory can increase during the simulation window as new batches arrive.
      // Only count batches that are available by currentTime.
      const availableRaw =
        typeof anyB.manufacture_date === "string"
          ? anyB.manufacture_date
          : typeof anyB.createdAt === "string"
            ? anyB.createdAt
            : null;
      const availableMs = availableRaw ? Date.parse(availableRaw) : NaN;
      if (Number.isFinite(availableMs) && availableMs > snapMs) {
        continue;
      }

      totalKg += qty;

      const expiryRaw =
        typeof anyB.expiry_iso === "string" ? anyB.expiry_iso : null;
      let expiryMs = expiryRaw ? Date.parse(expiryRaw) : NaN;
      let expiryKind: "known" | "inferred" | "unknown" = "unknown";

      if (Number.isFinite(expiryMs)) {
        expiryKind = "known";
      } else {
        const manufRaw =
          typeof anyB.manufacture_date === "string"
            ? anyB.manufacture_date
            : null;
        const shelfLifeHours = asNumber(anyB.shelf_life_hours, NaN);
        const manufMs = manufRaw ? Date.parse(manufRaw) : NaN;
        if (Number.isFinite(manufMs) && Number.isFinite(shelfLifeHours)) {
          expiryMs = manufMs + shelfLifeHours * 3600 * 1000;
          expiryKind = "inferred";
        }
      }

      if (!Number.isFinite(expiryMs)) {
        unknownExpiryKg += qty;
        continue;
      }

      if (expiryKind === "known") knownExpiryKg += qty;
      if (expiryKind === "inferred") inferredExpiryKg += qty;

      if (expiryMs >= snapMs) {
        nonExpiredKg += qty;
        if (expiryMs <= soonMs) expiringSoonKg += qty;
      } else {
        expiredKnownKg += qty;
      }
    }

    const usableSharePct = safePct(nonExpiredKg, totalKg);
    return {
      totalKg,
      knownExpiryKg,
      inferredExpiryKg,
      nonExpiredKg,
      expiringSoonKg,
      expiredKnownKg,
      unknownExpiryKg,
      usableSharePct,
    };
  }, [mlSnapshotPayload?.batches, currentTime]);

  const inventoryRemaining = useMemo(() => {
    if (!snapshotSupply || !regular || !ml) return null;

    const nowMs = currentTime.getTime();

    const movedKg = (data: TimelineData) => {
      let moved = 0;
      const ships = Array.isArray(data.shipments) ? data.shipments : [];
      for (const s of ships) {
        const startMs = s?.startTime?.getTime?.() ?? null;
        if (typeof startMs === "number" && startMs <= nowMs) {
          moved += asNumber(s.quantity_kg, 0);
        }
      }
      return moved;
    };

    const total = snapshotSupply.totalKg;
    const regularRemainingKg = Math.max(0, total - movedKg(regular));
    const mlRemainingKg = Math.max(0, total - movedKg(ml));

    return { totalKg: total, regularRemainingKg, mlRemainingKg };
  }, [snapshotSupply, regular, ml, currentTime]);

  const inventoryByStrategy = useMemo(() => {
    if (!mlSnapshotPayload?.batches || !regular || !ml) return null;

    const nowMs = currentTime.getTime();
    if (!Number.isFinite(nowMs)) return null;

    const soonMs = nowMs + 72 * 3600 * 1000;

    type UsedBatch = { batchId?: unknown; quantity?: unknown };
    type AllocLike = { dispatchTime?: string; batches?: UsedBatch[] };

    const movedByBatchId = (allocations: AllocLike[]) => {
      const moved = new Map<string, number>();
      for (const alloc of allocations || []) {
        const dispatchMs = alloc?.dispatchTime
          ? Date.parse(alloc.dispatchTime)
          : NaN;
        if (Number.isFinite(dispatchMs) && dispatchMs > nowMs) continue;

        for (const used of alloc?.batches || []) {
          const qty = asNumber(used?.quantity, 0);
          if (qty <= 0) continue;

          const idRaw = used?.batchId;
          const id =
            typeof idRaw === "string"
              ? idRaw
              : idRaw &&
                  typeof (idRaw as { toString?: unknown }).toString ===
                    "function"
                ? String((idRaw as { toString: () => string }).toString())
                : String(idRaw);

          moved.set(id, (moved.get(id) || 0) + qty);
        }
      }
      return moved;
    };

    const computeRemainingSnapshot = (allocations: AllocLike[]) => {
      const moved = movedByBatchId(allocations);

      let totalKg = 0;
      let nonExpiredKg = 0;
      let expiringSoonKg = 0;
      let expiredKg = 0;
      let unknownExpiryKg = 0;

      for (const b of mlSnapshotPayload.batches || []) {
        if (!b || typeof b !== "object") continue;
        const anyB = b as Record<string, unknown>;

        const statusRaw =
          typeof anyB.status === "string" ? anyB.status : "stored";
        const status = statusRaw.toLowerCase();
        if (status !== "stored" && status !== "reserved") continue;

        const idRaw = anyB._id;
        const id =
          typeof idRaw === "string"
            ? idRaw
            : idRaw &&
                typeof (idRaw as { toString?: unknown }).toString === "function"
              ? String((idRaw as { toString: () => string }).toString())
              : String(idRaw);

        const baseQty = asNumber(anyB.quantity_kg, 0);
        if (baseQty <= 0) continue;

        const availableRaw =
          typeof anyB.manufacture_date === "string"
            ? anyB.manufacture_date
            : typeof anyB.createdAt === "string"
              ? anyB.createdAt
              : null;
        const availableMs = availableRaw ? Date.parse(availableRaw) : NaN;
        if (Number.isFinite(availableMs) && availableMs > nowMs) continue;

        const remainingQty = Math.max(0, baseQty - (moved.get(id) || 0));
        if (remainingQty <= 0) continue;

        totalKg += remainingQty;

        const expiryRaw =
          typeof anyB.expiry_iso === "string" ? anyB.expiry_iso : null;
        let expiryMs = expiryRaw ? Date.parse(expiryRaw) : NaN;
        if (!Number.isFinite(expiryMs)) {
          const manufRaw =
            typeof anyB.manufacture_date === "string"
              ? anyB.manufacture_date
              : null;
          const shelfLifeHours = asNumber(anyB.shelf_life_hours, NaN);
          const manufMs = manufRaw ? Date.parse(manufRaw) : NaN;
          if (Number.isFinite(manufMs) && Number.isFinite(shelfLifeHours)) {
            expiryMs = manufMs + shelfLifeHours * 3600 * 1000;
          }
        }

        if (!Number.isFinite(expiryMs)) {
          unknownExpiryKg += remainingQty;
          continue;
        }

        if (expiryMs >= nowMs) {
          nonExpiredKg += remainingQty;
          if (expiryMs <= soonMs) expiringSoonKg += remainingQty;
        } else {
          expiredKg += remainingQty;
        }
      }

      return {
        totalKg,
        nonExpiredKg,
        expiringSoonKg,
        expiredKg,
        unknownExpiryKg,
      };
    };

    return {
      regular: computeRemainingSnapshot(
        (regular.allocations as AllocLike[]) || [],
      ),
      ml: computeRemainingSnapshot((ml.allocations as AllocLike[]) || []),
    };
  }, [mlSnapshotPayload?.batches, regular, ml, currentTime]);

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
        <div className="bg-white rounded-lg border border-zinc-200 p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <label className="text-sm text-zinc-700" htmlFor="snapshot-date">
              Snapshot date
            </label>
            <input
              id="snapshot-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-sm px-2 py-1.5 rounded-md border border-zinc-200 bg-white"
              max={new Date().toISOString().slice(0, 10)}
            />

            <label className="text-sm text-zinc-700" htmlFor="window-days">
              Window (days)
            </label>
            <input
              id="window-days"
              type="number"
              value={windowDays}
              onChange={(e) => setWindowDays(asNumber(e.target.value, 7))}
              min={7}
              max={31}
              step={1}
              className="text-sm w-24 px-2 py-1.5 rounded-md border border-zinc-200 bg-white"
            />

            <span className="text-xs text-zinc-500">Refetches simulation</span>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={perfMode}
              onChange={(e) => setPerfMode(e.target.checked)}
              className="h-4 w-4 accent-zinc-900"
            />
            Performance mode
            <span className="text-xs text-zinc-500">
              (faster map, clustered nodes)
            </span>
          </label>
        </div>

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

        {/* SIMPLE KPI DASHBOARD */}
        {regular && ml && kpis && snapshotSupply && (
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Total Requested
                </div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900">
                  {fmtKgNice(requestedSoFarKg)}
                </div>
                <div className="mt-3 text-[11px] text-zinc-600 space-y-1">
                  <div>
                    Outstanding (Regular):{" "}
                    <span className="font-medium text-zinc-900">
                      {fmtKgNice(
                        Math.max(
                          0,
                          requestedSoFarKg -
                            Math.max(
                              0,
                              asNumber(kpis.regularDelivered, 0) -
                                asNumber(kpis.regularSpoiled, 0),
                            ),
                        ),
                      )}
                    </span>
                  </div>
                  <div>
                    Outstanding (ML):{" "}
                    <span className="font-medium text-zinc-900">
                      {fmtKgNice(
                        Math.max(
                          0,
                          requestedSoFarKg -
                            Math.max(
                              0,
                              asNumber(kpis.mlDelivered, 0) -
                                asNumber(kpis.mlSpoiled, 0),
                            ),
                        ),
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Inventory Now (Regular vs ML)
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-zinc-100 p-3">
                    <div className="text-xs text-zinc-500">Regular</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-900">
                      {fmtKgNice(
                        inventoryByStrategy?.regular.totalKg ??
                          inventoryRemaining?.regularRemainingKg ??
                          snapshotSupply.totalKg,
                      )}
                    </div>
                    <div className="mt-2 text-[11px] text-zinc-500 space-y-1">
                      <div>
                        Unexpired:{" "}
                        <span className="font-medium text-emerald-700">
                          {fmtKgNice(
                            inventoryByStrategy?.regular.nonExpiredKg ?? 0,
                          )}
                        </span>
                      </div>
                      <div>
                        Expiring ≤72h:{" "}
                        <span className="font-medium text-amber-700">
                          {fmtKgNice(
                            inventoryByStrategy?.regular.expiringSoonKg ?? 0,
                          )}
                        </span>
                      </div>
                      <div>
                        Already expired:{" "}
                        <span className="font-medium text-red-700">
                          {fmtKgNice(
                            inventoryByStrategy?.regular.expiredKg ?? 0,
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-100 p-3">
                    <div className="text-xs text-zinc-500">ML</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-900">
                      {fmtKgNice(
                        inventoryByStrategy?.ml.totalKg ??
                          inventoryRemaining?.mlRemainingKg ??
                          snapshotSupply.totalKg,
                      )}
                    </div>
                    <div className="mt-2 text-[11px] text-zinc-500 space-y-1">
                      <div>
                        Unexpired:{" "}
                        <span className="font-medium text-emerald-700">
                          {fmtKgNice(inventoryByStrategy?.ml.nonExpiredKg ?? 0)}
                        </span>
                      </div>
                      <div>
                        Expiring ≤72h:{" "}
                        <span className="font-medium text-amber-700">
                          {fmtKgNice(
                            inventoryByStrategy?.ml.expiringSoonKg ?? 0,
                          )}
                        </span>
                      </div>
                      <div>
                        Already expired:{" "}
                        <span className="font-medium text-red-700">
                          {fmtKgNice(inventoryByStrategy?.ml.expiredKg ?? 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-zinc-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">
                    Delivered (Fresh vs Expired in Transport)
                  </div>
                  <div className="text-[11px] px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 whitespace-nowrap">
                    Food saved: {kpis.spoilageReductionPct.toFixed(1)}%
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-zinc-500">Regular</div>
                    <div className="mt-1">
                      <div className="text-[11px] text-zinc-500">
                        Fresh delivered
                      </div>
                      <div className="text-lg font-semibold text-zinc-900">
                        {fmtKgNice(kpis.regularFreshDelivered)}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {pct(
                          safePct(
                            kpis.regularFreshDelivered,
                            snapshotSupply.totalKg,
                          ),
                        )}{" "}
                        of inventory
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-zinc-100">
                      <div className="text-[11px] text-zinc-500">
                        Expired in transport
                      </div>
                      <div className="text-base font-semibold text-red-700">
                        {fmtKgNice(kpis.regularSpoiled)}
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-zinc-100">
                      <div className="text-[10px] text-zinc-400 space-y-0.5">
                        <div>✅ Delivered: {kpis.regularCompletedCount}</div>
                        <div>🚚 In Transit: {kpis.regularInTransitCount}</div>
                        <div>⏳ Pending: {kpis.regularPendingCount}</div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">ML</div>
                    <div className="mt-1">
                      <div className="text-[11px] text-zinc-500">
                        Fresh delivered
                      </div>
                      <div className="text-lg font-semibold text-emerald-700">
                        {fmtKgNice(kpis.mlFreshDelivered)}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {pct(
                          safePct(
                            kpis.mlFreshDelivered,
                            snapshotSupply.totalKg,
                          ),
                        )}{" "}
                        of inventory
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-zinc-100">
                      <div className="text-[11px] text-zinc-500">
                        Expired in transport
                      </div>
                      <div className="text-base font-semibold text-red-700">
                        {fmtKgNice(kpis.mlSpoiled)}
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-zinc-100">
                      <div className="text-[10px] text-zinc-400 space-y-0.5">
                        <div>✅ Delivered: {kpis.mlCompletedCount}</div>
                        <div>🚚 In Transit: {kpis.mlInTransitCount}</div>
                        <div>⏳ Pending: {kpis.mlPendingCount}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        <details className="bg-white rounded-lg border border-zinc-200 p-4 mb-6">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900">
            What “ML” means on this page
          </summary>
          <ul className="mt-3 text-sm text-zinc-600 list-disc pl-5 space-y-1">
            {notes.map((n, idx) => (
              <li key={idx}>{n}</li>
            ))}
          </ul>
        </details>

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
                  performanceMode={perfMode}
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
                  performanceMode={perfMode}
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
                    {signalsScope === "snapshot"
                      ? effectiveSignals.length
                      : signalsSummary.total}
                  </div>
                  {signalsScope === "snapshot" && (
                    <div className="text-[11px] text-zinc-500">
                      of {signalsSummary.total} returned
                    </div>
                  )}
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

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Scope</span>
                  <div className="inline-flex rounded-md border border-zinc-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSignalsScope("snapshot")}
                      className={`px-2.5 py-1.5 ${
                        signalsScope === "snapshot"
                          ? "bg-zinc-100 text-zinc-900"
                          : "bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                      title="Show only the simulation snapshot month"
                    >
                      Snapshot month
                    </button>
                    <button
                      type="button"
                      onClick={() => setSignalsScope("all")}
                      className={`px-2.5 py-1.5 border-l border-zinc-200 ${
                        signalsScope === "all"
                          ? "bg-zinc-100 text-zinc-900"
                          : "bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                      title="Show all periods returned by the ML service"
                    >
                      All periods
                    </button>
                  </div>
                </div>

                <div className="ml-auto flex flex-wrap items-center gap-3">
                  {signalsSnapshotIso && (
                    <span>
                      Snapshot as-of:{" "}
                      <span className="text-zinc-900">
                        {signalsSnapshotIso.slice(0, 10)}
                      </span>
                    </span>
                  )}
                  {mlSnapshotPayload && (
                    <span>
                      Snapshot payload:{" "}
                      <span className="text-zinc-900">
                        {snapshotPayloadCounts.nodes}
                      </span>{" "}
                      nodes,{" "}
                      <span className="text-zinc-900">
                        {snapshotPayloadCounts.requests}
                      </span>{" "}
                      requests,{" "}
                      <span className="text-zinc-900">
                        {snapshotPayloadCounts.shipments}
                      </span>{" "}
                      shipments,{" "}
                      <span className="text-zinc-900">
                        {snapshotPayloadCounts.batches}
                      </span>{" "}
                      batches
                    </span>
                  )}
                  {signalsPeriodRange && (
                    <span>
                      Returned range:{" "}
                      <span className="text-zinc-900">
                        {signalsPeriodRange.minIso}
                      </span>{" "}
                      →{" "}
                      <span className="text-zinc-900">
                        {signalsPeriodRange.maxIso}
                      </span>
                    </span>
                  )}
                </div>
              </div>

              {signalsScope === "snapshot" &&
                !signalsLoading &&
                signals.length > 0 &&
                effectiveSignals.length === 0 && (
                  <div className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">
                    No ML rows matched the snapshot month. Switch Scope →
                    &quot;All periods&quot; to inspect what the ML service
                    returned, or check that the snapshot payload contains valid
                    ISO dates.
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
