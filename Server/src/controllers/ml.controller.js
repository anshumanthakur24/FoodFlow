import axios from "axios";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Node } from "../models/node.model.js";
import { Request } from "../models/request.model.js";
import { Batch } from "../models/batch.model.js";
import { Shipment } from "../models/shipment.model.js";

function resolveBaseUrl(raw, fallback) {
  const candidate = (raw && String(raw).trim()) || fallback;
  if (!candidate) {
    return fallback;
  }
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return `http://${candidate}`;
}

const sendSimulationData = asyncHandler(async (req, res) => {
  try {
    const baseURL = resolveBaseUrl(
      process.env.SIMULATION_BASE_URL,
      "http://localhost:5050"
    );
    if (!baseURL) {
      throw new ApiError(
        400,
        "Missing 'baseURL'. Please provide the target endpoint base URL."
      );
    }

    const endpoint = `${baseURL}/transfers/plan`;

    // 🟢 Fetch all data from MongoDB
    const [nodes, requests, shipments, batches] = await Promise.all([
      Node.find(),
      Request.find(),
      Shipment.find(),
      Batch.find(),
    ]);

    const formattedNodes = nodes.map((node) => {
      const rawLocation = node.location && node.location.coordinates;
      const coordinates = Array.isArray(rawLocation)
        ? rawLocation.map((value) => Number(value) || 0)
        : null;
      return {
        _id: node._id.toString(),
        nodeId: node._id.toString(),
        type: node.type,
        district: node.district,
        state: node.state || node.regionId || "Unknown",
        capacity_kg:
          typeof node.capacity_kg === "number"
            ? node.capacity_kg
            : Number(node.capacity_kg) || 0,
        location: coordinates
          ? { type: "Point", coordinates }
          : node.location || null,
      };
    });

    const formattedRequests = requests.map((req) => {
      const items = Array.isArray(req.items)
        ? req.items
            .map((item) => ({
              foodType:
                item && typeof item.foodType === "string"
                  ? item.foodType.trim()
                  : null,
              required_kg: Number(item?.required_kg),
            }))
            .filter(
              (item) =>
                item.foodType &&
                Number.isFinite(item.required_kg) &&
                item.required_kg > 0
            )
        : [];
      const requiredIso =
        req.requiredBefore instanceof Date
          ? req.requiredBefore.toISOString()
          : req.requiredBefore || req.requiredBy_iso || null;
      return {
        requestId: req._id.toString(),
        requesterNode: req.requesterNode.toString(),
        items,
        requiredBy_iso: requiredIso,
        status: req.status,
      };
    });

    const formattedShipments = shipments.map((s) => {
      const travelMinutes = Number(s.travel_time_minutes);
      return {
        shipmentId: (s.shipmentID || s._id || "").toString(),
        mongoId: s._id.toString(),
        batchIds: Array.isArray(s.batchIds)
          ? s.batchIds.map((id) => id.toString())
          : [],
        fromNode: s.fromNode ? s.fromNode.toString() : null,
        toNode: s.toNode ? s.toNode.toString() : null,
        start_iso:
          s.start_iso instanceof Date
            ? s.start_iso.toISOString()
            : s.start_iso || null,
        travel_time_minutes: Number.isFinite(travelMinutes)
          ? travelMinutes
          : null,
      };
    });

    const formattedBatches = batches.map((b) => ({
      batchId: b._id.toString(),
      originNode: b.originNode?.toString(),
      capacity_kg:
        typeof b.capacity_kg === "number"
          ? b.capacity_kg
          : Number(b.capacity_kg) || 0,
      quantity_kg:
        typeof b.quantity_kg === "number"
          ? b.quantity_kg
          : Number(b.quantity_kg) || 0,
      manufacture_date:
        b.manufacture_date instanceof Date
          ? b.manufacture_date.toISOString()
          : b.manufacture_date || null,
    }));

    const payload = {
      // runId: `RUN-${Date.now()}`,
      freq: "M",
      nodes: formattedNodes,
      requests: formattedRequests,
      shipments: formattedShipments,
      batches: formattedBatches,
    };

    const response = await axios.post(endpoint, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          sentPayload: payload,
          externalResponse: response.data,
        },
        "Simulation data fetched from DB and sent successfully."
      )
    );
  } catch (error) {
    console.log(error);
    if (error.response) {
      throw new ApiError(
        error.response.status,
        "External API error during simulation data send.",
        [error.response.data]
      );
    } else if (error.request) {
      throw new ApiError(
        502,
        "No response from external API. Please check the baseURL or network connection."
      );
    } else if (error instanceof ApiError) {
      throw error;
    } else {
      throw new ApiError(
        500,
        "Failed to send simulation data.",
        [error.message],
        error.stack
      );
    }
  }
});

const getData = asyncHandler(async (req, res) => {
  const baseURL = resolveBaseUrl(
    process.env.SIMULATION_BASE_URL,
    "http://localhost:5050"
  );
  const endpoint = `${baseURL}/transfers/plan`;

  // Optional tuning parameters can be passed via body
  const {
    mode,
    maxPairs,
    minTransferKg,
    overstockRatio,
    understockRatio,
    targetRatio,
    intervalKm,
    filters,
  } = req.body || {};

  // Load current graph state from DB
  const [nodes, batches] = await Promise.all([Node.find(), Batch.find()]);

  // Shape nodes for ML transfer planner
  const formattedNodes = nodes.map((node) => {
    const rawLocation = node.location && node.location.coordinates;
    const coordinates = Array.isArray(rawLocation)
      ? rawLocation.map((value) => Number(value) || 0)
      : null;
    return {
      _id: node._id.toString(),
      nodeId: node._id.toString(),
      type: node.type,
      name: node.name,
      state: node.state || node.regionId || null,
      district: node.district || null,
      regionId: node.regionId || null,
      capacity_kg:
        typeof node.capacity_kg === "number"
          ? node.capacity_kg
          : Number(node.capacity_kg) || 0,
      location: coordinates
        ? { type: "Point", coordinates }
        : node.location || null,
    };
  });

  // Shape batches; prefer currentNode/current_quantity_kg when present
  const formattedBatches = batches.map((b) => {
    const quantity =
      typeof b.quantity_kg === "number" ? b.quantity_kg : Number(b.quantity_kg);
    const originalQuantity =
      typeof b.original_quantity_kg === "number"
        ? b.original_quantity_kg
        : Number(b.original_quantity_kg);
    const freshness =
      typeof b.freshnessPct === "number"
        ? b.freshnessPct
        : Number(b.freshnessPct);
    return {
      batchId: b._id.toString(),
      originNode: b.originNode ? b.originNode.toString() : null,
      currentNode: b.currentNode
        ? b.currentNode.toString()
        : b.originNode
        ? b.originNode.toString()
        : null,
      status: b.status || "stored",
      current_quantity_kg: Number.isFinite(quantity)
        ? quantity
        : Number.isFinite(originalQuantity)
        ? originalQuantity
        : 0,
      quantity_kg: Number.isFinite(quantity) ? quantity : undefined,
      original_quantity_kg: Number.isFinite(originalQuantity)
        ? originalQuantity
        : undefined,
      manufacture_date:
        b.manufacture_date instanceof Date
          ? b.manufacture_date.toISOString()
          : b.manufacture_date || null,
      expiry_iso:
        b.expiry_iso instanceof Date
          ? b.expiry_iso.toISOString()
          : b.expiry_iso || null,
      freshnessPct: Number.isFinite(freshness) ? freshness : undefined,
    };
  });

  const payload = {
    mode,
    maxPairs,
    minTransferKg,
    overstockRatio,
    understockRatio,
    targetRatio,
    intervalKm,
    filters: filters || {},
    nodes: formattedNodes,
    batches: formattedBatches,
  };

  const response = await axios.post(endpoint, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  // Extract farm_to_warehouse and warehouse_to_warehouse data
  const { farm_to_warehouse = [], warehouse_to_warehouse = [] } = response.data || {};
  
  // Combine both arrays with transfer type marker and create Shipment documents
  const allTransfers = [
    ...(Array.isArray(farm_to_warehouse) ? farm_to_warehouse.map(t => ({ ...t, _transferType: 'farm_to_warehouse' })) : []),
    ...(Array.isArray(warehouse_to_warehouse) ? warehouse_to_warehouse.map(t => ({ ...t, _transferType: 'warehouse_to_warehouse' })) : [])
  ];

  const createdShipments = [];
  const errors = [];

  for (const transfer of allTransfers) {
    try {
      const sourceMongoId = transfer?.source?.mongoId;
      const sourceNodeId = transfer?.source?.nodeId;
      const targetMongoId = transfer?.target?.mongoId;
      const targetNodeId = transfer?.target?.nodeId;

      if (!sourceMongoId && !sourceNodeId) {
        console.warn("Skipping transfer with missing source mongoId/nodeId:", transfer);
        continue;
      }

      if (!targetMongoId && !targetNodeId) {
        console.warn("Skipping transfer with missing target mongoId/nodeId:", transfer);
        continue;
      }

      // Find nodes - prefer mongoId, fallback to nodeId
      let fromNode = null;
      let toNode = null;

      if (sourceMongoId) {
        try {
          fromNode = await Node.findById(sourceMongoId);
        } catch (err) {
          // If mongoId is not a valid ObjectId format, try nodeId
        }
      }

      if (!fromNode && sourceNodeId) {
        fromNode = await Node.findOne({ nodeId: sourceNodeId });
      }

      if (targetMongoId) {
        try {
          toNode = await Node.findById(targetMongoId);
        } catch (err) {
          // If mongoId is not a valid ObjectId format, try nodeId
        }
      }

      if (!toNode && targetNodeId) {
        toNode = await Node.findOne({ nodeId: targetNodeId });
      }

      if (!fromNode || !toNode) {
        console.warn(`Skipping transfer: Node not found. From: ${sourceMongoId || sourceNodeId}, To: ${targetMongoId || targetNodeId}`);
        continue;
      }

      // Use the actual node _id from database
      const fromNodeId = fromNode._id;
      const toNodeId = toNode._id;

      // Calculate travel time from distance (assuming average speed of 60 km/h)
      // travel_time_minutes = (distance_km / 60) * 60
      const distanceKm = transfer?.distance_km || 0;
      const estimatedTravelMinutes = distanceKm > 0 ? Math.round((distanceKm / 60) * 60) : null;

      // Generate shipmentID if not present
      const shipmentID = `SH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Determine transfer type (use transfer.type field or fallback to marker)
      const transferType = transfer?.type || transfer?._transferType || null;

      // Create shipment document
      const shipmentData = {
        shipmentID,
        fromNode: fromNodeId,
        toNode: toNodeId,
        start_iso: new Date(), // Current date/time as start
        travel_time_minutes: estimatedTravelMinutes ? String(estimatedTravelMinutes) : null,
        transfer_type: transferType,
        suggested_quantity_kg: transfer?.suggested_quantity_kg || null,
        distance_km: distanceKm || null,
        notes: transfer?.notes || null,
        routing: transfer?.route || transfer?.waypoints || null,
        batchIds: [] // Empty initially, batches can be added later
      };

      const shipment = await Shipment.create(shipmentData);
      createdShipments.push(shipment);
    } catch (error) {
      console.error("Error creating shipment:", error);
      errors.push({
        transfer,
        error: error.message
      });
    }
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {
          plan: response.data,
          createdShipments: createdShipments.length,
          shipments: createdShipments.map(s => ({
            id: s._id,
            shipmentID: s.shipmentID,
            fromNode: s.fromNode,
            toNode: s.toNode,
            transfer_type: s.transfer_type,
            suggested_quantity_kg: s.suggested_quantity_kg
          })),
          errors: errors.length > 0 ? errors : undefined
        },
        `Transfer plan generated successfully. ${createdShipments.length} shipment(s) created.`
      )
    );
});

export { sendSimulationData, getData };
