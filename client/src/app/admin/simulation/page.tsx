"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Node, Event, Shipment } from "@/data/sampleFoodData";

// Import MapTimeline dynamically with SSR disabled
const MapTimeline = dynamic(() => import("@/components/MapTimeline"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  ),
});

interface SimulationData {
  nodes: Node[];
  events: Event[];
  shipments: Shipment[];
  metrics: {
    totalAllocated: number;
    avgDistance: number;
    avgFreshness: number;
    fulfillmentRate: number;
    deliveredKg?: number;
    deliveredAvgFreshness?: number;
    deliveredSpoiledKg?: number;
    deliveredAtRiskKg?: number;
  };
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
  warehouseCoords?: [number, number]; // [lng, lat]
  ngoCoords?: [number, number]; // [lng, lat]
  ngoName?: string;
}

interface BackendStrategyPayload {
  strategy: string;
  metrics: SimulationData["metrics"];
  allocations: BackendAllocation[];
}

function pctDelta(base: number, next: number) {
  if (!Number.isFinite(base) || base === 0) return 0;
  return ((base - next) / base) * 100;
}

export default function SimulationPage() {
  const [loading, setLoading] = useState(false);
  const [regularSim, setRegularSim] = useState<SimulationData | null>(null);
  const [mlSim, setMlSim] = useState<SimulationData | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000); // ms per step
  const [view, setView] = useState<"split" | "regular" | "ml">("split");

  const runSimulation = async () => {
    setLoading(true);
    try {
      // Fetch simulation using current DB state - no date needed
      const response = await fetch(
        `http://localhost:3001/api/history/simulate`,
      );
      const data = await response.json();

      if (data.success) {
        const baseTime = new Date(data.data.startTime);
        setRegularSim(
          convertToMapData(
            data.data.regular as BackendStrategyPayload,
            baseTime,
          ),
        );
        setMlSim(
          convertToMapData(data.data.ml as BackendStrategyPayload, baseTime),
        );
        setCurrentTime(baseTime);
      }
    } catch (error) {
      console.error("Simulation failed:", error);
    }
    setLoading(false);
  };

  const convertToMapData = (
    allocData: BackendStrategyPayload,
    baseTime: Date,
  ): SimulationData => {
    const nodes: Node[] = [];
    const events: Event[] = [];
    const shipments: Shipment[] = [];
    const nodeMap = new Map<string, Node>();

    let eventId = 1;
    let shipmentId = 1;

    const simulationStartMs = baseTime.getTime();
    const stepMs = 30 * 60 * 1000; // 30 min between shipments for readability

    // Create nodes from allocations
    allocData.allocations.forEach((alloc, idx) => {
      const warehouseId = alloc.warehouse;
      const ngoId = alloc.requestId;

      // Add warehouse node if not exists
      if (!nodeMap.has(warehouseId)) {
        const coords = alloc.warehouseCoords || [77.209, 28.6139];
        const warehouseNode: Node = {
          id: warehouseId,
          nodeId: warehouseId,
          name: alloc.warehouseName || "Warehouse",
          type: "warehouse",
          lat: coords[1], // GeoJSON is [lng, lat]
          lng: coords[0],
        };
        nodes.push(warehouseNode);
        nodeMap.set(warehouseId, warehouseNode);
      }

      // Add NGO node if not exists
      if (!nodeMap.has(ngoId)) {
        const coords = alloc.ngoCoords || [77.2, 28.6];
        const ngoNode: Node = {
          id: ngoId,
          nodeId: ngoId,
          name: alloc.ngoName || `NGO ${alloc.requestId}`,
          type: "ngo",
          lat: coords[1], // GeoJSON is [lng, lat]
          lng: coords[0],
        };
        nodes.push(ngoNode);
        nodeMap.set(ngoId, ngoNode);
      }

      const warehouseNode = nodeMap.get(warehouseId)!;
      const ngoNode = nodeMap.get(ngoId)!;

      // Create shipment
      const travelHours = (alloc.distance_km || 0) / 40;
      const startTime = new Date(simulationStartMs + idx * stepMs);
      const etaTime = new Date(startTime.getTime() + travelHours * 3600 * 1000);

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
        startTime,
        etaTime,
        arrivedTime: undefined,
        status: "in_transit",
      };
      shipments.push(shipment);

      // Create events
      events.push({
        id: `evt-${eventId++}`,
        eventId: `EVT-${alloc.requestId}-start`,
        type: "shipment_created",
        time: startTime,
        lat: warehouseNode.lat,
        lng: warehouseNode.lng,
        payload: { shipmentId: shipment.shipmentId, foodType: alloc.foodType },
      });

      events.push({
        id: `evt-${eventId++}`,
        eventId: `EVT-${alloc.requestId}-end`,
        type: "shipment_arrived",
        time: etaTime,
        lat: ngoNode.lat,
        lng: ngoNode.lng,
        payload: { shipmentId: shipment.shipmentId },
      });
    });

    return {
      nodes,
      events,
      shipments,
      metrics: allocData.metrics,
    };
  };

  const foodSavedKg =
    regularSim && mlSim
      ? (regularSim.metrics.deliveredSpoiledKg ?? 0) -
        (mlSim.metrics.deliveredSpoiledKg ?? 0)
      : 0;

  const spoilageReductionPct =
    regularSim && mlSim
      ? pctDelta(
          regularSim.metrics.deliveredSpoiledKg ?? 0,
          mlSim.metrics.deliveredSpoiledKg ?? 0,
        )
      : 0;

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const resetSimulation = () => {
    setIsPlaying(false);
    if (regularSim) {
      const minTime = Math.min(
        ...regularSim.events.map((e) => e.time.getTime()),
        ...regularSim.shipments.map((s) => s.startTime.getTime()),
      );
      setCurrentTime(new Date(minTime));
    }
  };

  // Animation loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && regularSim) {
      interval = setInterval(() => {
        setCurrentTime((prev) => new Date(prev.getTime() + speed));
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, regularSim, speed]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 flex items-center gap-3">
          <span className="text-4xl">🚚</span>
          Supply Chain Simulation: ML vs Traditional
        </h1>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex gap-4 items-end flex-wrap">
            <button
              onClick={runSimulation}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? "Loading..." : "🎬 Run Simulation"}
            </button>

            {regularSim && (
              <>
                <button
                  onClick={togglePlayPause}
                  className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700"
                >
                  {isPlaying ? "⏸️ Pause" : "▶️ Play"}
                </button>

                <button
                  onClick={resetSimulation}
                  className="bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700"
                >
                  🔄 Reset
                </button>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Speed: {speed}ms
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="2000"
                    step="100"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    className="w-32"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setView("split")}
                    className={`px-4 py-2 rounded ${
                      view === "split"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200"
                    }`}
                  >
                    Split View
                  </button>
                  <button
                    onClick={() => setView("regular")}
                    className={`px-4 py-2 rounded ${
                      view === "regular"
                        ? "bg-red-600 text-white"
                        : "bg-gray-200"
                    }`}
                  >
                    Regular Only
                  </button>
                  <button
                    onClick={() => setView("ml")}
                    className={`px-4 py-2 rounded ${
                      view === "ml" ? "bg-green-600 text-white" : "bg-gray-200"
                    }`}
                  >
                    ML Only
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Simulation View */}
        {regularSim && mlSim && (
          <div className="space-y-6">
            {/* Delta KPIs */}
            <div className="bg-white rounded-lg shadow p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded p-4">
                  <div className="text-xs uppercase tracking-wide text-emerald-900/70">
                    Food Saved (less spoiled at delivery)
                  </div>
                  <div className="text-2xl font-bold text-emerald-800 mt-1">
                    {foodSavedKg.toFixed(1)} kg
                  </div>
                  <div className="text-sm text-emerald-800/80">
                    Spoilage reduction: {spoilageReductionPct.toFixed(1)}%
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Spoiled At Delivery
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <div className="text-sm text-gray-500">Regular</div>
                      <div className="text-xl font-semibold text-gray-900">
                        {(regularSim.metrics.deliveredSpoiledKg ?? 0).toFixed(
                          1,
                        )}{" "}
                        kg
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">ML</div>
                      <div className="text-xl font-semibold text-emerald-700">
                        {(mlSim.metrics.deliveredSpoiledKg ?? 0).toFixed(1)} kg
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    At Risk (&lt;20% freshness)
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <div className="text-sm text-gray-500">Regular</div>
                      <div className="text-xl font-semibold text-gray-900">
                        {(regularSim.metrics.deliveredAtRiskKg ?? 0).toFixed(1)}{" "}
                        kg
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">ML</div>
                      <div className="text-xl font-semibold text-emerald-700">
                        {(mlSim.metrics.deliveredAtRiskKg ?? 0).toFixed(1)} kg
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Regular Simulation */}
              {(view === "split" || view === "regular") && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="bg-red-600 text-white p-4">
                    <h2 className="text-xl font-bold">
                      🔴 Traditional (Rule-Based)
                    </h2>
                    <p className="text-sm opacity-90">
                      Nearest warehouse + FIFO batches
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 grid grid-cols-3 gap-4 text-sm text-gray-900">
                    <div>
                      <span className="font-semibold text-gray-700">
                        Fulfillment:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {regularSim.metrics.fulfillmentRate.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Avg Distance:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {regularSim.metrics.avgDistance.toFixed(1)} km
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Avg Freshness:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {regularSim.metrics.avgFreshness.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Delivered Freshness:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {(
                          regularSim.metrics.deliveredAvgFreshness ?? 0
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Spoiled @ Delivery:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {(regularSim.metrics.deliveredSpoiledKg ?? 0).toFixed(
                          1,
                        )}{" "}
                        kg
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Total:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {regularSim.metrics.totalAllocated} kg
                      </span>
                    </div>
                  </div>

                  <div className="h-[600px]">
                    <MapTimeline
                      nodes={regularSim.nodes}
                      events={regularSim.events}
                      shipments={regularSim.shipments}
                      shipmentLocationUpdates={[]}
                      currentTime={currentTime}
                      startTime={regularSim.events[0]?.time || new Date()}
                      endTime={
                        regularSim.events[regularSim.events.length - 1]?.time ||
                        new Date()
                      }
                    />
                  </div>
                </div>
              )}

              {/* ML Simulation */}
              {(view === "split" || view === "ml") && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="bg-green-600 text-white p-4">
                    <h2 className="text-xl font-bold">
                      🟢 ML-Driven (Optimized)
                    </h2>
                    <p className="text-sm opacity-90">
                      Demand prediction + optimization
                    </p>
                  </div>

                  <div className="p-4 bg-gray-50 grid grid-cols-3 gap-4 text-sm text-gray-900">
                    <div>
                      <span className="font-semibold text-gray-700">
                        Fulfillment:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {mlSim.metrics.fulfillmentRate.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Avg Distance:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {mlSim.metrics.avgDistance.toFixed(1)} km
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Avg Freshness:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {mlSim.metrics.avgFreshness.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Delivered Freshness:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {(mlSim.metrics.deliveredAvgFreshness ?? 0).toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Spoiled @ Delivery:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {(mlSim.metrics.deliveredSpoiledKg ?? 0).toFixed(1)} kg
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">
                        Total:
                      </span>{" "}
                      <span className="font-bold text-lg">
                        {mlSim.metrics.totalAllocated} kg
                      </span>
                    </div>
                  </div>

                  <div className="h-[600px]">
                    <MapTimeline
                      nodes={mlSim.nodes}
                      events={mlSim.events}
                      shipments={mlSim.shipments}
                      shipmentLocationUpdates={[]}
                      currentTime={currentTime}
                      startTime={mlSim.events[0]?.time || new Date()}
                      endTime={
                        mlSim.events[mlSim.events.length - 1]?.time ||
                        new Date()
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!regularSim && !loading && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <span className="text-6xl mb-4 block">🗺️</span>
            <p className="text-gray-600 text-lg">
              Select a date and click &quot;Run Simulation&quot; to visualize
              supply chain allocation
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
