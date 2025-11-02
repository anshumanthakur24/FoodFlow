import axios from "axios";
import {asyncHandler} from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Node } from "../models/node.model.js";
import { Request } from "../models/request.model.js";
import { Batch } from "../models/batch.model.js";
import { Shipment } from "../models/shipment.model.js"; // assuming you have this model

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
      throw new ApiError(400, "Missing 'baseURL'. Please provide the target endpoint base URL.");
    }

    const endpoint = `${baseURL}/predict`;

    // 🟢 Fetch all data from MongoDB
    const [nodes, requests, shipments, batches] = await Promise.all([
      Node.find(),
      Request.find(),
      Shipment.find(),
      Batch.find(),
    ]);

    const formattedNodes = nodes.map((node) => ({
      nodeId: node._id.toString(),
      type: node.type,
      district: node.district,
      state: node.regionId || "Unknown",
      location: node.location,
    }));

    const formattedRequests = requests.map((req) => ({
      requestId: req._id.toString(),
      requesterNode: req.requesterNode.toString(),
      items: req.items || [],
      requiredBy_iso: req.requiredBefore || req.requiredBy_iso,
      status: req.status,
    }));

    const formattedShipments = shipments.map((s) => ({
      shipmentId: s._id.toString(),
      batchIds: s.batchIds?.map((id) => id.toString()) || [],
      fromNode: s.fromNode?.toString(),
      toNode: s.toNode?.toString(),
      start_iso: s.start_iso,
      travel_time_minutes: s.travel_time_minutes,
    }));

    const formattedBatches = batches.map((b) => ({
      batchId: b._id.toString(),
      originNode: b.originNode?.toString(),
      quantity_kg: b.quantity_kg,
      manufacture_date: b.manufacture_date,
    }));

    const payload = {
      runId: `RUN-${Date.now()}`,
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
  const [nodes, batches] = await Promise.all([
    Node.find(),
    Batch.find(),
  ]);

  // Shape nodes for ML transfer planner
  const formattedNodes = nodes.map((node) => ({
    _id: node._id.toString(),
    nodeId: node._id.toString(),
    type: node.type,
    name: node.name,
    state: null, // optional, not present in Node schema
    district: node.district || null,
    regionId: node.regionId || null,
    capacity_kg: typeof node.capacity_kg === 'number' ? node.capacity_kg : 0,
    location: node.location, // { type: 'Point', coordinates: [lon, lat] }
  }));

  // Shape batches; prefer currentNode/current_quantity_kg when present
  const formattedBatches = batches.map((b) => ({
    batchId: b._id.toString(),
    originNode: b.originNode ? b.originNode.toString() : null,
    currentNode: b.currentNode ? b.currentNode.toString() : (b.originNode ? b.originNode.toString() : null),
    status: b.status || 'stored',
    current_quantity_kg: typeof b.quantity_kg === 'number' ? b.quantity_kg : (typeof b.original_quantity_kg === 'number' ? b.original_quantity_kg : 0),
    quantity_kg: typeof b.quantity_kg === 'number' ? b.quantity_kg : undefined,
    original_quantity_kg: typeof b.original_quantity_kg === 'number' ? b.original_quantity_kg : undefined,
    manufacture_date: b.manufacture_date || null,
    expiry_iso: b.expiry_iso || null,
    freshnessPct: typeof b.freshnessPct === 'number' ? b.freshnessPct : undefined,
  }));

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
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  return res.status(200).json(
    new ApiResponse(200, response.data, 'Transfer plan generated successfully.')
  );
});

export { sendSimulationData , getData};
