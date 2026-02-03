"use client";

import React, { useState, useEffect } from "react";
import {
  adminService,
  type ComparisonResult,
  type Allocation,
} from "@/services/admin.service";

export default function ComparisonPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonData, setComparisonData] = useState<ComparisonResult | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    // Default to 2026-01-28 (the date with demo data)
    return "2026-01-28";
  });

  const loadComparison = async (date?: string) => {
    setLoading(true);
    setError(null);

    try {
      const data = await adminService.compareAllocations(date);
      setComparisonData(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load comparison",
      );
      console.error("Error loading comparison:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value);
  };

  const handleRunComparison = () => {
    loadComparison(selectedDate);
  };

  // Load comparison on mount
  useEffect(() => {
    loadComparison(selectedDate);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🚛 ML vs Traditional Supply Chain Comparison
          </h1>
          <p className="text-gray-600">
            Compare ML-driven predictive allocation vs traditional rule-based
            approach
          </p>
        </div>

        {/* Date Selection */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center gap-4">
            <label className="text-gray-700 font-medium">Select Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={handleDateChange}
              className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={handleRunComparison}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Running..." : "🔄 Run Comparison"}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">
              <strong>Error:</strong> {error}
            </p>
            <p className="text-red-600 text-sm mt-2">
              Make sure all services are running (Backend on port 3001, ML on
              port 3002)
            </p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Running simulation...</p>
          </div>
        )}

        {/* Comparison Results */}
        {!loading && comparisonData && (
          <>
            {/* Metrics Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Regular Strategy */}
              <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-red-500">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-gray-900">
                    🔴 Traditional (Rule-Based)
                  </h2>
                </div>
                <p className="text-gray-600 mb-6">
                  Nearest warehouse + FIFO batches
                </p>

                <div className="space-y-4">
                  <MetricCard
                    label="Fulfillment Rate"
                    value={`${comparisonData.regular.metrics.fulfillmentRate ?? 0}%`}
                    color="text-gray-900"
                  />
                  <MetricCard
                    label="Avg Distance"
                    value={`${(comparisonData.regular.metrics.avgDistance ?? 0).toFixed(1)} km`}
                    color="text-gray-900"
                  />
                  <MetricCard
                    label="Avg Freshness"
                    value={`${(comparisonData.regular.metrics.avgFreshness ?? 0).toFixed(1)}%`}
                    color="text-gray-900"
                  />
                  <MetricCard
                    label="Total Allocated"
                    value={`${comparisonData.regular.metrics.totalAllocated ?? 0} kg`}
                    color="text-gray-900"
                  />
                  <MetricCard
                    label="Requests Fulfilled"
                    value={`${comparisonData.regular.metrics.fulfilledRequests ?? 0} / ${comparisonData.regular.metrics.totalRequests ?? 0}`}
                    color="text-gray-900"
                  />
                </div>
              </div>

              {/* ML Strategy */}
              <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-gray-900">
                    🟢 ML-Driven (Optimized)
                  </h2>
                </div>
                <p className="text-gray-600 mb-6">
                  Demand prediction + optimization
                </p>

                <div className="space-y-4">
                  <MetricCard
                    label="Fulfillment Rate"
                    value={`${comparisonData.ml.metrics.fulfillmentRate ?? 0}%`}
                    color="text-green-600"
                  />
                  <MetricCard
                    label="Avg Distance"
                    value={`${(comparisonData.ml.metrics.avgDistance ?? 0).toFixed(1)} km`}
                    color="text-green-600"
                  />
                  <MetricCard
                    label="Avg Freshness"
                    value={`${(comparisonData.ml.metrics.avgFreshness ?? 0).toFixed(1)}%`}
                    color="text-green-600"
                  />
                  <MetricCard
                    label="Total Allocated"
                    value={`${comparisonData.ml.metrics.totalAllocated ?? 0} kg`}
                    color="text-green-600"
                  />
                  <MetricCard
                    label="Requests Fulfilled"
                    value={`${comparisonData.ml.metrics.fulfilledRequests ?? 0} / ${comparisonData.ml.metrics.totalRequests ?? 0}`}
                    color="text-green-600"
                  />
                </div>
              </div>
            </div>

            {/* Improvements Panel */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow-lg p-8 mb-8 text-white">
              <h2 className="text-2xl font-bold mb-6">📈 ML Improvements</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <ImprovementCard
                  label="Fulfillment Increase"
                  value={comparisonData.improvements.fulfillmentIncrease}
                />
                <ImprovementCard
                  label="Distance Reduction"
                  value={comparisonData.improvements.distanceReduction}
                />
                <ImprovementCard
                  label="Freshness Boost"
                  value={comparisonData.improvements.freshnessIncrease}
                />
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                💡 Summary
              </h3>
              <p className="text-gray-700 text-lg">{comparisonData.summary}</p>
            </div>

            {/* Detailed Allocations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Regular Allocations */}
              <AllocationsList
                title="Traditional Allocations"
                allocations={comparisonData.regular.allocations}
                color="red"
              />

              {/* ML Allocations */}
              <AllocationsList
                title="ML-Driven Allocations"
                allocations={comparisonData.ml.allocations}
                color="green"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex justify-between items-center py-3 border-b border-gray-200">
      <span className="text-sm text-gray-600 uppercase tracking-wide">
        {label}
      </span>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
    </div>
  );
}

// Improvement Card Component
function ImprovementCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-sm opacity-90 mb-2">{label}</div>
      <div className="text-4xl font-bold">{value}</div>
    </div>
  );
}

// Allocations List Component
function AllocationsList({
  title,
  allocations,
  color,
}: {
  title: string;
  allocations: Allocation[];
  color: "red" | "green";
}) {
  const borderColor = color === "red" ? "border-red-500" : "border-green-500";
  const bgColor = color === "red" ? "bg-red-50" : "bg-green-50";

  return (
    <div
      className={`bg-white rounded-lg shadow-md p-6 border-t-4 ${borderColor}`}
    >
      <h3 className="text-xl font-bold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {allocations.length === 0 ? (
          <p className="text-gray-500 italic">No allocations made</p>
        ) : (
          allocations.map((allocation, idx) => (
            <div key={idx} className={`${bgColor} rounded-lg p-4`}>
              <div className="font-semibold text-gray-900 mb-2">
                Request: {allocation.requestId}
              </div>
              <div className="text-sm text-gray-600 mb-2">
                Fulfillment: {allocation.fulfillmentRate_percent ?? 0}% (
                {allocation.totalAllocated_kg ?? 0} /{" "}
                {allocation.totalRequired_kg ?? 0} kg)
              </div>

              {allocation.allocated?.map((alloc, aidx) => (
                <div
                  key={aidx}
                  className="ml-4 mt-2 text-sm border-l-2 border-gray-300 pl-3"
                >
                  <div className="font-medium">{alloc.warehouseName}</div>
                  <div className="text-gray-600">
                    Distance: {(alloc.distance_km ?? 0).toFixed(1)} km |
                    Freshness: {(alloc.avgFreshness_percent ?? 0).toFixed(1)}%
                  </div>
                  <div className="text-gray-500 text-xs">
                    {alloc.items?.map((item) => (
                      <span key={item.foodType} className="mr-3">
                        {item.foodType}: {item.allocated_kg ?? 0}kg
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
