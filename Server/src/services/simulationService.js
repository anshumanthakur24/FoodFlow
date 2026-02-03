import { Node } from "../models/node.model.js";
import { Batch } from "../models/batch.model.js";
import { Request } from "../models/request.model.js";
import { NGO } from "../models/NGO.model.js";
import { haversineDistanceKm } from "../utils/geoHelpers.js";
import {
  calculateFreshnessPct,
  remainingShelfLifeHours,
} from "../utils/freshness.js";
import axios from "axios";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5050";
const TRANSPORT_SERVICE_URL =
  process.env.TRANSPORT_SERVICE_URL || "http://localhost:5001";

const debugAlloc = (...args) => {
  if (process.env.ALLOC_DEBUG === "1") {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

const safeRemainingShelfLifeHours = (batch, currentDate) => {
  const life = Number(batch?.shelf_life_hours);
  const hasLife = Number.isFinite(life) && life > 0;
  const manufacture = batch?.manufacture_date
    ? new Date(batch.manufacture_date)
    : null;
  const hasManufacture =
    manufacture instanceof Date && !Number.isNaN(manufacture.getTime());

  // If we don't have perishability metadata, treat as non-perishable.
  if (!hasLife || !hasManufacture) return Number.POSITIVE_INFINITY;

  const hours = remainingShelfLifeHours(batch, currentDate);
  return Number.isFinite(hours) ? hours : Number.POSITIVE_INFINITY;
};

/**
 * REGULAR ALLOCATION (Rule-Based Baseline)
 * - Nearest warehouse to NGO
 * - FIFO batch selection (oldest first)
 * - Reactive: only responds to existing requests
 */
export async function allocateRegular(requests, batches, warehouses, ngos) {
  const allocations = [];
  const unusedBatches = [...batches];

  // Fetch NGO organizations to map request.requesterNode (NGO ID) to Node
  const ngoOrgs = await NGO.find().lean();

  // Build lookup to map NGO org id -> NGO node id for ML feature engineering joins.
  // The ML feature engineering expects requests.requesterNode to match nodes._id.
  const ngoOrgNameById = new Map(
    (ngoOrgs || []).map((org) => [
      org?._id?.toString?.() ?? String(org._id),
      org?.name,
    ])
  );
  const ngoNodeIdByName = new Map(
    (ngos || []).map((node) => [
      node?.name,
      node?._id?.toString?.() ?? String(node._id),
    ])
  );

  debugAlloc(
    `[allocateRegular] Starting with ${requests.length} requests, ${ngoOrgs.length} NGO orgs, ${ngos.length} NGO nodes`
  );

  for (const request of requests) {
    // Find NGO organization
    const ngoOrg = ngoOrgs.find(
      (org) => org._id.toString() === request.requesterNode.toString()
    );
    if (!ngoOrg) {
      debugAlloc(
        `[allocateRegular] No NGO org found for request ${request.requestID}, requesterNode: ${request.requesterNode}`
      );
      continue;
    }

    // Find corresponding NGO node by name
    const ngoNode = ngos.find((n) => n.name === ngoOrg.name);
    if (!ngoNode) {
      debugAlloc(
        `[allocateRegular] No NGO node found for org name: ${ngoOrg.name}`
      );
      continue;
    }

    debugAlloc(
      `[allocateRegular] Processing request ${request.requestID} for NGO ${ngoNode.name}`
    );

    debugAlloc(
      `[allocateRegular]  NGO location: [${ngoNode.location.coordinates.join(", ")}], warehouses: ${warehouses.length}`
    );

    // Find nearest warehouse
    let nearestWarehouse = null;
    let minDistance = Infinity;

    for (const warehouse of warehouses) {
      debugAlloc(`[allocateRegular]  Checking warehouse ${warehouse.name}...`);
      debugAlloc(
        `[allocateRegular]    Warehouse location object:`,
        warehouse.location
      );
      debugAlloc(
        `[allocateRegular]    Warehouse coords: [${warehouse.location?.coordinates?.join(", ") || "MISSING"}]`
      );
      const distance = haversineDistanceKm(
        {
          lat: ngoNode.location.coordinates[1],
          lon: ngoNode.location.coordinates[0],
        },
        {
          lat: warehouse.location.coordinates[1],
          lon: warehouse.location.coordinates[0],
        }
      );
      debugAlloc(`[allocateRegular]    Distance: ${distance.toFixed(2)} km`);
      if (distance < minDistance) {
        minDistance = distance;
        nearestWarehouse = warehouse;
      }
    }

    if (!nearestWarehouse) {
      debugAlloc(
        `[allocateRegular] No warehouse found for NGO ${ngoNode.name}`
      );
      continue;
    }

    debugAlloc(
      `[allocateRegular]  Nearest warehouse: ${nearestWarehouse.name} (${minDistance.toFixed(2)} km away)`
    );

    // FIFO allocation for each item
    for (const item of request.items) {
      debugAlloc(
        `[allocateRegular]   Item: ${item.foodType}, need ${item.required_kg}kg from warehouse ${nearestWarehouse.name}`
      );

      const availableBatches = unusedBatches
        .filter(
          (b) =>
            b.foodType === item.foodType &&
            b.currentNode.toString() === nearestWarehouse._id.toString() &&
            b.status === "stored"
        )
        .sort(
          (a, b) => new Date(a.manufacture_date) - new Date(b.manufacture_date)
        ); // Oldest first

      debugAlloc(
        `[allocateRegular]   Found ${availableBatches.length} matching batches`
      );

      let remaining = item.required_kg;
      const usedBatches = [];

      for (const batch of availableBatches) {
        if (remaining <= 0) break;

        const allocatedQty = Math.min(batch.quantity_kg, remaining);
        usedBatches.push({
          batchId: batch._id,
          quantity: allocatedQty,
          freshness: batch.freshnessPct || 100,
        });

        remaining -= allocatedQty;

        // Remove or reduce batch
        const idx = unusedBatches.findIndex(
          (b) => b._id.toString() === batch._id.toString()
        );
        if (allocatedQty >= batch.quantity_kg) {
          unusedBatches.splice(idx, 1);
        } else {
          unusedBatches[idx].quantity_kg -= allocatedQty;
        }
      }

      allocations.push({
        requestId: request.requestID,
        foodType: item.foodType,
        required_kg: item.required_kg,
        allocated_kg: item.required_kg - remaining,
        warehouse: nearestWarehouse._id,
        warehouseName: nearestWarehouse.name,
        distance_km: minDistance,
        batches: usedBatches,
        strategy: "regular",
      });
    }
  }

  return allocations;
}

/**
 * ML ALLOCATION (Predictive Optimization)
 * - Calls ML service for demand prediction
 * - Pre-positions inventory based on forecasted hotspots
 * - Optimizes for freshness (60%) + distance (40%)
 */
export async function allocateML(requests, batches, warehouses, ngos) {
  const allocations = [];
  const unusedBatches = [...batches];

  const preferredMinDeliveredFreshnessPct = Number(
    process.env.ML_MIN_DELIVERED_FRESHNESS_PCT ?? 55
  );
  const relaxedMinDeliveredFreshnessPct = Number(
    process.env.ML_RELAXED_MIN_DELIVERED_FRESHNESS_PCT ?? 25
  );

  // Strongly prefer nearby allocations to keep routes realistic.
  // If nothing is feasible within the cap (e.g., no eligible batches nearby), we fall back to the best overall option.
  const maxPreferredDistanceKm = Number(process.env.ML_MAX_DISTANCE_KM ?? 250);
  const distanceDecayKm = Number(process.env.ML_DISTANCE_DECAY_KM ?? 35);

  // Hard limits to prevent pathological long-haul allocations.
  const hardMaxDistanceKm = Number(process.env.ML_HARD_MAX_DISTANCE_KM ?? 450);
  const topKWarehouses = Number(process.env.ML_TOP_K_WAREHOUSES ?? 8);

  // Fetch NGO organizations to map request.requesterNode (NGO ID) to Node
  const ngoOrgs = await NGO.find().lean();

  // Optional ML context (anomaly/demand signals). Allocation still works without this.
  let regionalSignals = new Map();
  try {
    const payload = {
      freq: "M",
      nodes: (warehouses || []).concat(ngos || []).map((n) => ({
        _id: n._id?.toString?.() ?? String(n._id),
        nodeId: n._id?.toString?.() ?? String(n._id),
        type: n.type,
        district: n.district || null,
        state: n.state || n.regionId || "Unknown",
        location: n.location || null,
      })),
      requests: (requests || []).map((r) => ({
        requestId: r.requestID || r.requestId,
        // Convert NGO org id to NGO node id when possible so ML joins can recover state/district.
        requesterNode: (() => {
          const orgId =
            r.requesterNode?.toString?.() ?? String(r.requesterNode);
          const orgName = ngoOrgNameById.get(orgId);
          const nodeId = orgName ? ngoNodeIdByName.get(orgName) : null;
          return nodeId || orgId;
        })(),
        items: r.items,
        requiredBy_iso: r.requiredBefore || r.requiredBy_iso || null,
        status: r.status || "pending",
      })),
      shipments: [],
      batches: (batches || []).map((b) => ({
        _id: b._id?.toString?.() ?? String(b._id),
        batchId: b._id?.toString?.() ?? String(b._id),
        originNode: b.originNode?.toString?.() ?? String(b.originNode),
        currentNode: b.currentNode?.toString?.() ?? String(b.currentNode),
        manufacture_date: b.manufacture_date,
        foodType: b.foodType,
      })),
    };

    const mlResp = await axios.post(`${ML_SERVICE_URL}/predict`, payload, {
      timeout: 8000,
      headers: { "Content-Type": "application/json" },
    });

    const results = mlResp?.data?.results;
    if (Array.isArray(results)) {
      regionalSignals = new Map(
        results
          .filter((r) => r && (r.state || r.district))
          .map((r) => [
            `${r.state || "Unknown"}-${r.district || "Unknown"}`,
            {
              anomalyScore:
                typeof r.anomaly_score === "number" ? r.anomaly_score : 0,
              isAnomaly: r.is_anomaly === 1,
            },
          ])
      );
    }
  } catch (_err) {
    // ML signals are optional; allocation proceeds without them.
  }

  const estimateTravelHours = (distanceKm) => {
    const avgSpeedKmh = 40;
    const baseHours = distanceKm / avgSpeedKmh;
    const breaks = Math.floor(baseHours / 4) * 0.5;
    return baseHours + breaks;
  };

  // Allocate each request to nearest warehouse with best freshness
  for (const request of requests) {
    // Find NGO organization
    const ngoOrg = ngoOrgs.find(
      (org) => org._id.toString() === request.requesterNode.toString()
    );
    if (!ngoOrg) continue;

    // Node schema has no org reference; match by name (seed scripts align these)
    const ngoNode = ngos.find((n) => n.name === ngoOrg.name);
    if (!ngoNode) continue;

    const dispatchTime = request.createdOn
      ? new Date(request.createdOn)
      : new Date();

    const regionKey = `${ngoNode.state || ngoNode.regionId || "Unknown"}-${ngoNode.district || "Unknown"}`;
    const signal = regionalSignals.get(regionKey);
    const urgencyBoost = signal?.isAnomaly ? 1.1 : 1.0;

    for (const item of request.items) {
      let bestScoreOverall = -Infinity;
      let bestWarehouseOverall = null;
      let bestBatchesOverall = [];

      let bestScoreInCap = -Infinity;
      let bestWarehouseInCap = null;
      let bestBatchesInCap = [];

      // Evaluate only nearby warehouses (top-K by distance) to avoid absurd routes.
      const warehouseCandidates = (warehouses || [])
        .map((warehouse) => {
          const distance = haversineDistanceKm(
            {
              lat: ngoNode.location.coordinates[1],
              lon: ngoNode.location.coordinates[0],
            },
            {
              lat: warehouse.location.coordinates[1],
              lon: warehouse.location.coordinates[0],
            }
          );
          return { warehouse, distance };
        })
        .filter(
          (x) =>
            x.warehouse &&
            Number.isFinite(x.distance) &&
            x.distance >= 0 &&
            x.distance <= hardMaxDistanceKm
        )
        .sort((a, b) => a.distance - b.distance)
        .slice(0, Math.max(1, topKWarehouses));

      for (const { warehouse, distance } of warehouseCandidates) {
        const travelHours = estimateTravelHours(distance);
        const minRemainingHoursRequired = travelHours + 2; // buffer for delays

        const deliveryTime = new Date(
          dispatchTime.getTime() + travelHours * 3600 * 1000
        );

        // Get batches for this food type at this warehouse
        const candidateBatches = unusedBatches
          .filter(
            (b) =>
              b.foodType === item.foodType &&
              b.currentNode &&
              b.currentNode.toString() === warehouse._id.toString() &&
              b.status === "stored"
          )
          .map((b) => ({
            batch: b,
            remainingHours: safeRemainingShelfLifeHours(b, dispatchTime),
            freshnessAtDelivery: calculateFreshnessPct(b, deliveryTime),
          }))
          .filter((x) => x.remainingHours > minRemainingHoursRequired);

        const strictEligible = candidateBatches
          .filter(
            (x) => x.freshnessAtDelivery >= preferredMinDeliveredFreshnessPct
          )
          // Prefer higher freshness at delivery; use FEFO only as a tie-breaker.
          .sort(
            (a, b) =>
              b.freshnessAtDelivery - a.freshnessAtDelivery ||
              a.remainingHours - b.remainingHours
          );

        const relaxedEligible = candidateBatches
          .filter(
            (x) => x.freshnessAtDelivery >= relaxedMinDeliveredFreshnessPct
          )
          .sort(
            (a, b) =>
              b.freshnessAtDelivery - a.freshnessAtDelivery ||
              a.remainingHours - b.remainingHours
          );

        const usingRelaxed = strictEligible.length === 0;
        const availableBatches = usingRelaxed
          ? relaxedEligible
          : strictEligible;

        if (availableBatches.length === 0) continue;

        const totalAvailable = availableBatches.reduce(
          (sum, x) => sum + (x.batch.quantity_kg || 0),
          0
        );

        // Calculate weighted freshness
        let cumulativeQty = 0;
        let weightedDeliveredFreshness = 0;
        let weightedExpiryPressure = 0;
        for (const {
          batch,
          remainingHours,
          freshnessAtDelivery,
        } of availableBatches) {
          const usableQty = Math.min(
            batch.quantity_kg,
            item.required_kg - cumulativeQty
          );

          weightedDeliveredFreshness +=
            freshnessAtDelivery * (usableQty / item.required_kg);

          // Higher when remaining time is low (but safe), promoting waste avoidance.
          const expiryPressure = 1 / (1 + remainingHours / 24);
          weightedExpiryPressure +=
            expiryPressure * (usableQty / item.required_kg);

          cumulativeQty += usableQty;
          if (cumulativeQty >= item.required_kg) break;
        }

        const fulfillmentRatio = Math.min(1, totalAvailable / item.required_kg);

        // Exponential distance penalty (very strong) to keep travel realistic.
        // Smaller decay => harsher penalty for long routes.
        const distanceScore = Math.exp(-distance / distanceDecayKm);

        // Composite: distance + delivered freshness + waste-avoidance + fulfillment.
        // Heavily weight distance so ML doesn't "win" freshness by traveling 300-800km.
        let score =
          (distanceScore * 0.6 +
            (weightedDeliveredFreshness / 100) * 0.3 +
            weightedExpiryPressure * 0.05 +
            fulfillmentRatio * 0.05) *
          urgencyBoost;

        // If we had to relax freshness constraints, discourage this choice unless it materially helps.
        if (usingRelaxed) score *= 0.6;

        // Penalty for partial fulfillment
        if (fulfillmentRatio < 1.0) {
          score *= 0.3 * fulfillmentRatio;
        }

        if (score > bestScoreOverall) {
          bestScoreOverall = score;
          bestWarehouseOverall = warehouse;
          bestBatchesOverall = availableBatches;
        }

        if (distance <= maxPreferredDistanceKm && score > bestScoreInCap) {
          bestScoreInCap = score;
          bestWarehouseInCap = warehouse;
          bestBatchesInCap = availableBatches;
        }
      }

      const bestWarehouse = bestWarehouseInCap || bestWarehouseOverall;
      const bestBatches = bestWarehouseInCap
        ? bestBatchesInCap
        : bestBatchesOverall;

      if (!bestWarehouse) continue;

      // Allocate from best warehouse
      let remaining = item.required_kg;
      const usedBatches = [];

      for (const { batch } of bestBatches) {
        if (remaining <= 0) break;

        const allocatedQty = Math.min(batch.quantity_kg, remaining);
        usedBatches.push({
          batchId: batch._id,
          quantity: allocatedQty,
          freshness: calculateFreshnessPct(batch, dispatchTime),
        });

        remaining -= allocatedQty;

        const idx = unusedBatches.findIndex(
          (b) => b._id.toString() === batch._id.toString()
        );
        if (allocatedQty >= batch.quantity_kg) {
          unusedBatches.splice(idx, 1);
        } else {
          unusedBatches[idx].quantity_kg -= allocatedQty;
        }
      }

      const distance = haversineDistanceKm(
        {
          lat: ngoNode.location.coordinates[1],
          lon: ngoNode.location.coordinates[0],
        },
        {
          lat: bestWarehouse.location.coordinates[1],
          lon: bestWarehouse.location.coordinates[0],
        }
      );

      allocations.push({
        requestId: request.requestID,
        foodType: item.foodType,
        required_kg: item.required_kg,
        allocated_kg: item.required_kg - remaining,
        warehouse: bestWarehouse._id,
        warehouseName: bestWarehouse.name,
        distance_km: distance,
        batches: usedBatches,
        strategy: "ml",
      });
    }
  }

  return allocations;
}
