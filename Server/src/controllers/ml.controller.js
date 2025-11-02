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
        nodeId: node._id.toString(),
        type: node.type,
        district: node.district,
        state: node.state || node.regionId || "Unknown",
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

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        response.data,
        "Transfer plan generated successfully."
      )
    );
});

export { sendSimulationData, getData };
