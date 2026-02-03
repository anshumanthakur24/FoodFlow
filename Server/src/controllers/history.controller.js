import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Node } from "../models/node.model.js";
import { Batch } from "../models/batch.model.js";
import { Shipment } from "../models/shipment.model.js";
import { Event } from "../models/event.model.js";
import { Request } from "../models/request.model.js";
import { NGO } from "../models/NGO.model.js";
import { extractCoordinates } from "../utils/geoHelpers.js";
import { calculateFreshnessPct } from "../utils/freshness.js";
import { allocateRegular, allocateML } from "../services/simulationService.js";

/**
 * Helper function to calculate metrics from allocations
 */
const calcMetrics = (allocations, requests, context = {}) => {
  const {
    batchesById = new Map(),
    avgTempC = 25,
    avgSpeedKmh = 40,
    referenceDate = new Date(),
  } = context;

  const estimateTravelHours = (distanceKm) => {
    const baseHours = distanceKm / avgSpeedKmh;
    const breaks = Math.floor(baseHours / 4) * 0.5;
    return baseHours + breaks;
  };

  if (allocations.length === 0) {
    return {
      totalRequests: 0,
      fulfilledRequests: 0,
      totalRequired: 0,
      totalAllocated: 0,
      fulfillmentRate: 0,
      totalDistanceKm: 0,
      avgDistance: 0,
      avgFreshness: 0,
      deliveredAvgFreshness: 0,
      deliveredKg: 0,
      deliveredSpoiledKg: 0,
      deliveredAtRiskKg: 0,
    };
  }

  const totalRequired = allocations.reduce((sum, a) => sum + a.required_kg, 0);
  const totalAllocated = allocations.reduce(
    (sum, a) => sum + a.allocated_kg,
    0
  );
  const fulfillmentRate =
    totalRequired > 0 ? (totalAllocated / totalRequired) * 100 : 0;

  // Count unique requests that received at least some allocation
  const uniqueRequestIds = [...new Set(allocations.map((a) => a.requestId))];
  const fulfilledRequests = uniqueRequestIds.filter((reqId) => {
    const reqAllocations = allocations.filter((a) => a.requestId === reqId);
    const totalAllocatedForReq = reqAllocations.reduce(
      (sum, a) => sum + a.allocated_kg,
      0
    );
    return totalAllocatedForReq > 0;
  }).length;

  const totalDistanceKm = allocations.reduce(
    (sum, a) => sum + (Number(a.distance_km) || 0),
    0
  );
  const avgDistance =
    allocations.length > 0 ? totalDistanceKm / allocations.length : 0;

  const avgFreshness =
    allocations.reduce((sum, a) => {
      if (a.batches.length === 0) return sum;
      const batchAvg =
        a.batches.reduce((s, b) => s + b.freshness, 0) / a.batches.length;
      return sum + batchAvg;
    }, 0) / allocations.length || 0;

  // Delivery-time freshness/spoilage approximation
  let deliveredKg = 0;
  let deliveredFreshnessWeighted = 0;
  let deliveredSpoiledKg = 0;
  let deliveredAtRiskKg = 0;

  for (const alloc of allocations) {
    const dispatchTime = alloc?.dispatchTime
      ? new Date(alloc.dispatchTime)
      : (() => {
          const req = requests.find((r) => r.requestID === alloc.requestId);
          if (req?.createdOn) return new Date(req.createdOn);
          return referenceDate;
        })();

    const travelHours = estimateTravelHours(alloc.distance_km || 0);
    const deliveryTime = new Date(
      dispatchTime.getTime() + travelHours * 3600 * 1000
    );

    for (const used of alloc.batches || []) {
      const qty = Number(used.quantity) || 0;
      if (qty <= 0) continue;
      deliveredKg += qty;

      const batchIdStr = used.batchId?.toString?.() ?? String(used.batchId);
      const batch = batchesById.get(batchIdStr);

      const freshnessAtDelivery = batch
        ? calculateFreshnessPct(batch, deliveryTime, avgTempC)
        : Number(used.freshness) || 100;

      deliveredFreshnessWeighted += freshnessAtDelivery * qty;

      if (freshnessAtDelivery <= 0) {
        deliveredSpoiledKg += qty;
      } else if (freshnessAtDelivery < 20) {
        deliveredAtRiskKg += qty;
      }
    }
  }

  const deliveredAvgFreshness =
    deliveredKg > 0 ? deliveredFreshnessWeighted / deliveredKg : 0;

  return {
    totalRequests: requests.length,
    fulfilledRequests,
    totalRequired: Math.round(totalRequired * 100) / 100,
    totalAllocated: Math.round(totalAllocated * 100) / 100,
    fulfillmentRate: Math.round(fulfillmentRate * 100) / 100,
    totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
    avgDistance: Math.round(avgDistance * 100) / 100,
    avgFreshness: Math.round(avgFreshness * 100) / 100,
    deliveredKg: Math.round(deliveredKg * 100) / 100,
    deliveredAvgFreshness: Math.round(deliveredAvgFreshness * 100) / 100,
    deliveredSpoiledKg: Math.round(deliveredSpoiledKg * 100) / 100,
    deliveredAtRiskKg: Math.round(deliveredAtRiskKg * 100) / 100,
  };
};

/**
 * Get history frame for a specific day
 * GET /api/history/day?date=YYYY-MM-DD
 *
 * Returns a complete snapshot of the supply chain state at the end of the specified day:
 * - Nodes with current inventory levels
 * - Batches (with computed freshness at target date)
 * - Shipments (active or completed by that date)
 * - Events that occurred on or before that date
 * - KPIs (fulfilled requests, spoilage, etc.)
 */
const getHistoryDay = asyncHandler(async (req, res) => {
  const { date } = req.query;

  if (!date) {
    throw new ApiError(400, "Missing required parameter: date (YYYY-MM-DD)");
  }

  // Parse target date and set to end of day
  const targetDate = new Date(date);
  if (isNaN(targetDate.getTime())) {
    throw new ApiError(400, "Invalid date format. Use YYYY-MM-DD");
  }

  // Set to end of day
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);

  // Fetch all nodes
  const nodes = await Node.find().lean();

  // Fetch batches that existed on or before target date
  const batches = await Batch.find({
    createdAt: { $lte: dayEnd },
  })
    .populate("originNode currentNode")
    .lean();

  // Fetch shipments that were started on or before target date
  const shipments = await Shipment.find({
    start_iso: { $lte: dayEnd },
  })
    .populate("fromNode toNode")
    .lean();

  // Fetch events up to target date
  const events = await Event.find({
    time: { $lte: dayEnd },
  }).lean();

  // Fetch requests up to target date
  const requests = await Request.find({
    createdOn: { $lte: dayEnd },
  }).lean();

  // Calculate inventory per node
  const nodeInventory = {};
  for (const node of nodes) {
    nodeInventory[node._id.toString()] = {
      total_kg: 0,
      by_food_type: {},
      batch_count: 0,
    };
  }

  // Compute freshness and aggregate inventory
  const batchesWithFreshness = batches.map((batch) => {
    const batchCopy = { ...batch };

    // Calculate freshness at target date
    if (batch.shelf_life_hours && batch.manufacture_date) {
      batchCopy.freshnessPct = calculateFreshnessPct(
        batch,
        dayEnd,
        25 // Default avg temp
      );
    }

    // Update inventory if batch is stored at this node
    if (batch.status === "stored" && batch.currentNode) {
      const nodeId =
        batch.currentNode._id?.toString() || batch.currentNode.toString();
      if (nodeInventory[nodeId]) {
        nodeInventory[nodeId].total_kg += batch.quantity_kg || 0;
        nodeInventory[nodeId].batch_count += 1;

        const foodType = batch.foodType || "unknown";
        if (!nodeInventory[nodeId].by_food_type[foodType]) {
          nodeInventory[nodeId].by_food_type[foodType] = 0;
        }
        nodeInventory[nodeId].by_food_type[foodType] += batch.quantity_kg || 0;
      }
    }

    return batchCopy;
  });

  // Transform nodes to frontend format with inventory
  const nodesFormatted = nodes.map((node) => {
    const coords = extractCoordinates(node);
    const inventory = nodeInventory[node._id.toString()];

    return {
      id: node._id.toString(),
      nodeId: node._id.toString(),
      name: node.name,
      type: node.type,
      lat: coords.lat,
      lng: coords.lon,
      district: node.district,
      capacity_kg: node.capacity_kg,
      stored_kg: inventory.total_kg,
      batch_count: inventory.batch_count,
      inventory_by_type: inventory.by_food_type,
    };
  });

  // Transform shipments to frontend format
  const shipmentsFormatted = shipments.map((shipment) => {
    const fromNode = shipment.fromNode;
    const toNode = shipment.toNode;
    const fromCoords = extractCoordinates(fromNode);
    const toCoords = extractCoordinates(toNode);

    // Determine status at target date
    let status = shipment.status;
    if (shipment.arrived_iso && shipment.arrived_iso <= dayEnd) {
      status = "arrived";
    } else if (
      shipment.start_iso <= dayEnd &&
      (!shipment.arrived_iso || shipment.arrived_iso > dayEnd)
    ) {
      status = "in_transit";
    }

    return {
      id: shipment._id.toString(),
      shipmentId: shipment.shipmentID || shipment.shipmentId,
      fromNodeId: fromNode._id.toString(),
      toNodeId: toNode._id.toString(),
      startTime: shipment.start_iso,
      etaTime: shipment.eta_iso,
      arrivedTime: shipment.arrived_iso,
      status,
      fromLat: fromCoords.lat,
      fromLng: fromCoords.lon,
      toLat: toCoords.lat,
      toLng: toCoords.lon,
      foodItem: shipment.metadata?.items?.[0]?.foodType || "food",
      value:
        shipment.metadata?.items?.reduce(
          (sum, item) => sum + (item.quantity_kg || 0),
          0
        ) || 0,
    };
  });

  // Transform events to frontend format
  const eventsFormatted = events.map((event) => {
    const coords = event.location?.coordinates
      ? {
          lat: event.location.coordinates[1],
          lon: event.location.coordinates[0],
        }
      : { lat: 20.5937, lon: 78.9629 }; // Default India center

    return {
      id: event._id.toString(),
      eventId: event._id.toString(),
      time: event.time,
      type: event.type,
      lat: coords.lat,
      lng: coords.lon,
      payload: event.payload,
    };
  });

  // Calculate KPIs
  const fulfilledRequests = requests.filter(
    (r) =>
      r.status === "fulfilled" && r.fullFilledOn && r.fullFilledOn <= dayEnd
  ).length;
  const totalRequests = requests.length;
  const spoiledBatches = batchesWithFreshness.filter(
    (b) =>
      b.status === "spoiled" ||
      (b.freshnessPct !== undefined && b.freshnessPct <= 0)
  );
  const spoiledKg = spoiledBatches.reduce(
    (sum, b) => sum + (b.quantity_kg || 0),
    0
  );

  // Calculate average delivery time for arrived shipments
  const arrivedShipments = shipments.filter(
    (s) => s.arrived_iso && s.arrived_iso <= dayEnd
  );
  const avgDeliveryMinutes =
    arrivedShipments.length > 0
      ? arrivedShipments.reduce((sum, s) => {
          const deliveryTime =
            (new Date(s.arrived_iso) - new Date(s.start_iso)) / (1000 * 60);
          return sum + deliveryTime;
        }, 0) / arrivedShipments.length
      : 0;

  const kpis = {
    fulfilled_requests: fulfilledRequests,
    total_requests: totalRequests,
    fulfillment_rate:
      totalRequests > 0 ? (fulfilledRequests / totalRequests) * 100 : 0,
    spoiled_kg: spoiledKg,
    spoiled_batch_count: spoiledBatches.length,
    avg_delivery_time_minutes: Math.round(avgDeliveryMinutes),
    total_shipments: shipments.length,
    active_shipments: shipmentsFormatted.filter(
      (s) => s.status === "in_transit"
    ).length,
  };

  return res.json(
    new ApiResponse(
      200,
      {
        date: targetDate.toISOString().split("T")[0],
        timestamp: dayEnd.toISOString(),
        nodes: nodesFormatted,
        batches: batchesWithFreshness,
        shipments: shipmentsFormatted,
        events: eventsFormatted,
        kpis,
      },
      "History frame retrieved successfully"
    )
  );
});

/**
 * Get history frames for a date range
 * GET /api/history/range?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns an array of daily frames for animation/playback
 */
const getHistoryRange = asyncHandler(async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end) {
    throw new ApiError(
      400,
      "Missing required parameters: start, end (YYYY-MM-DD)"
    );
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new ApiError(400, "Invalid date format. Use YYYY-MM-DD");
  }

  if (endDate < startDate) {
    throw new ApiError(400, "End date must be after start date");
  }

  // Limit range to prevent performance issues
  const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  if (daysDiff > 90) {
    throw new ApiError(400, "Date range too large. Maximum 90 days allowed.");
  }

  const frames = [];
  const currentDate = new Date(startDate);

  // Generate frame for each day
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split("T")[0];

    // Call getHistoryDay logic for each date
    // For efficiency, we'll return a simplified version
    // In production, this could be cached or pre-computed

    frames.push({
      date: dateStr,
      // Placeholder: full implementation would call getHistoryDay logic
      message: `Frame for ${dateStr} - implement full logic or use cached data`,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return res.json(
    new ApiResponse(
      200,
      {
        start: start,
        end: end,
        frame_count: frames.length,
        frames,
      },
      "History range retrieved successfully"
    )
  );
});

/**
 * Compare regular vs ML-driven allocation strategies
 * GET /api/history/compare?date=YYYY-MM-DD
 *
 * Runs two simulations on the same dataset:
 * 1. Regular: Nearest warehouse + FIFO batches (reactive)
 * 2. ML: Demand prediction + freshness/distance optimization (proactive)
 *
 * Returns side-by-side metrics showing ML improvements
 */
const compareSimulations = asyncHandler(async (req, res) => {
  const { date } = req.query;

  if (!date) {
    throw new ApiError(400, "Missing date parameter (format: YYYY-MM-DD)");
  }

  const targetDate = new Date(date);
  if (isNaN(targetDate.getTime())) {
    throw new ApiError(400, "Invalid date format. Use YYYY-MM-DD");
  }

  targetDate.setHours(23, 59, 59, 999);

  // Fetch entities at target date
  const [batches, requests, warehouses, ngos] = await Promise.all([
    Batch.find({
      manufacture_date: { $lte: targetDate },
      status: "stored",
    }).lean(),
    Request.find({
      createdOn: { $lte: targetDate },
      status: "pending",
    }).lean(),
    Node.find({ type: "warehouse" }).lean(),
    Node.find({ type: "ngo" }).lean(),
  ]);

  if (requests.length === 0) {
    throw new ApiError(404, `No pending requests found on or before ${date}`);
  }

  // Run both strategies in parallel
  const [regularAllocations, mlAllocations] = await Promise.all([
    allocateRegular(requests, batches, warehouses, ngos),
    allocateML(requests, batches, warehouses, ngos),
  ]);

  // Calculate metrics using shared helper function
  const batchesById = new Map(batches.map((b) => [b._id.toString(), b]));
  const regularMetrics = calcMetrics(regularAllocations, requests, {
    batchesById,
    referenceDate: targetDate,
  });
  const mlMetrics = calcMetrics(mlAllocations, requests, {
    batchesById,
    referenceDate: targetDate,
  });

  // Calculate improvements
  const improvements = {
    fulfillmentIncrease:
      mlMetrics.fulfillmentRate - regularMetrics.fulfillmentRate,
    distanceReduction:
      regularMetrics.avgDistance > 0
        ? ((regularMetrics.avgDistance - mlMetrics.avgDistance) /
            regularMetrics.avgDistance) *
          100
        : 0,
    freshnessIncrease: mlMetrics.avgFreshness - regularMetrics.avgFreshness,
    spoilageReduction:
      regularMetrics.deliveredSpoiledKg > 0
        ? ((regularMetrics.deliveredSpoiledKg - mlMetrics.deliveredSpoiledKg) /
            regularMetrics.deliveredSpoiledKg) *
          100
        : 0,
    foodSavedKg:
      regularMetrics.deliveredSpoiledKg - mlMetrics.deliveredSpoiledKg,
  };

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        date,
        regular: {
          strategy: "Rule-Based (Nearest + FIFO)",
          metrics: regularMetrics,
          allocations: regularAllocations.slice(0, 10), // Sample for brevity
        },
        ml: {
          strategy: "ML-Driven (Predictive + Optimized)",
          metrics: mlMetrics,
          allocations: mlAllocations.slice(0, 10),
        },
        improvements: {
          fulfillmentIncrease: `${improvements.fulfillmentIncrease >= 0 ? "+" : ""}${Math.round(improvements.fulfillmentIncrease * 100) / 100}%`,
          distanceReduction: `${Math.round(improvements.distanceReduction * 100) / 100}%`,
          freshnessIncrease: `${improvements.freshnessIncrease >= 0 ? "+" : ""}${Math.round(improvements.freshnessIncrease * 100) / 100}%`,
          spoilageReduction: `${Math.round(improvements.spoilageReduction * 100) / 100}%`,
          foodSavedKg: `${Math.round(improvements.foodSavedKg * 100) / 100} kg`,
        },
        summary: `ML-driven approach shows ${Math.round(Math.abs(improvements.fulfillmentIncrease))}% ${improvements.fulfillmentIncrease >= 0 ? "better" : "worse"} fulfillment, ${Math.round(Math.abs(improvements.distanceReduction))}% ${improvements.distanceReduction >= 0 ? "less" : "more"} distance, ${Math.round(Math.abs(improvements.freshnessIncrease))}% ${improvements.freshnessIncrease >= 0 ? "fresher" : "less fresh"} inventory at dispatch, and ${Math.round(Math.abs(improvements.spoilageReduction))}% ${improvements.spoilageReduction >= 0 ? "less" : "more"} spoilage at delivery (≈ ${Math.round(improvements.foodSavedKg * 100) / 100} kg saved).`,
      },
      "Simulation comparison completed successfully"
    )
  );
});

/**
 * Simulate supply chain allocations for visualization
 * GET /api/history/simulate?date=YYYY-MM-DD
 *
 * Returns detailed simulation data with node coordinates for map visualization
 */
const simulateAllocations = asyncHandler(async (req, res) => {
  // Fetch current data from database - get any recent requests and batches
  const [requests, batches, warehouses, ngoNodes, ngoOrgs] = await Promise.all([
    Request.find().sort({ createdOn: -1 }).limit(100).lean(),
    Batch.find().limit(200).lean(),
    Node.find({ type: "warehouse" }).lean(),
    Node.find({ type: "ngo" }).lean(),
    NGO.find().lean(),
  ]);

  if (requests.length === 0) {
    throw new ApiError(404, "No requests found in database");
  }

  if (batches.length === 0) {
    throw new ApiError(404, "No batches found in database");
  }

  // Run both allocations - pass ngoNodes as 4th parameter
  const regularAllocations = await allocateRegular(
    requests,
    batches,
    warehouses,
    ngoNodes
  );
  const mlAllocations = await allocateML(
    requests,
    batches,
    warehouses,
    ngoNodes
  );

  // Calculate metrics
  const batchesById = new Map(batches.map((b) => [b._id.toString(), b]));
  const regularMetrics = calcMetrics(regularAllocations, requests, {
    batchesById,
    referenceDate: new Date(),
  });
  const mlMetrics = calcMetrics(mlAllocations, requests, {
    batchesById,
    referenceDate: new Date(),
  });

  // Convert to visualization format with coordinates
  const convertToVisualization = (allocations, strategyName, metrics) => {
    return {
      strategy: strategyName,
      metrics: metrics,
      allocations: allocations.map((alloc) => {
        const warehouse = warehouses.find(
          (w) => w._id.toString() === alloc.warehouse.toString()
        );
        const request = requests.find((r) => r.requestID === alloc.requestId);

        // Look up NGO organization first, then find matching Node
        const ngoOrg = request
          ? ngoOrgs.find(
              (org) => org._id.toString() === request.requesterNode.toString()
            )
          : null;

        const ngo = ngoOrg
          ? ngoNodes.find((n) => n.name === ngoOrg.name)
          : null;

        return {
          ...alloc,
          warehouseCoords: warehouse ? warehouse.location.coordinates : [0, 0],
          ngoCoords: ngo ? ngo.location.coordinates : [0, 0],
          ngoName: ngoOrg ? ngoOrg.name : "Unknown NGO",
          warehouseName: warehouse ? warehouse.name : "Unknown Warehouse",
        };
      }),
    };
  };

  // Use earliest request time as start time
  const startTime =
    requests.length > 0
      ? new Date(
          Math.min(...requests.map((r) => new Date(r.createdOn).getTime()))
        )
      : new Date();

  const endTime =
    requests.length > 0
      ? new Date(
          Math.max(...requests.map((r) => new Date(r.createdOn).getTime()))
        )
      : new Date();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        startTime,
        endTime,
        totalRequests: requests.length,
        totalBatches: batches.length,
        regular: convertToVisualization(
          regularAllocations,
          "Regular",
          regularMetrics
        ),
        ml: convertToVisualization(mlAllocations, "ML", mlMetrics),
      },
      "Simulation data generated successfully"
    )
  );
});

export {
  getHistoryDay,
  getHistoryRange,
  compareSimulations,
  simulateAllocations,
};
