import axios from "axios";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

import { Node } from "../models/node.model.js";
import { Request } from "../models/request.model.js";
import { Batch } from "../models/batch.model.js";
import { Shipment } from "../models/shipment.model.js";

/* ============================================================
   Utils
============================================================ */

function resolveBaseUrl(raw, fallback) {
  const candidate = (raw && String(raw).trim()) || fallback;
  if (!candidate) return fallback;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return `http://${candidate}`;
}

/* ============================================================
   SEND DATA TO ML SERVICE
============================================================ */

const sendSimulationData = asyncHandler(async (req, res) => {
  try {
    const baseURL = resolveBaseUrl(
      process.env.SIMULATION_BASE_URL,
      "http://localhost:5050"
    );

    const endpoint = `${baseURL}/predict`;

    /* ========================================================
       MODE 1 — Direct ML inference (records provided by client)
    ======================================================== */
    if (Array.isArray(req.body?.records)) {
      const response = await axios.post(
        endpoint,
        { records: req.body.records },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 }
      );

      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            response.data,
            "Direct ML inference completed successfully."
          )
        );
    }

    /* ========================================================
       MODE 2 — Simulation inference (MongoDB → ML)
    ======================================================== */

    const [nodes, requests, shipments, batches] = await Promise.all([
      Node.find(),
      Request.find(),
      Shipment.find(),
      Batch.find(),
    ]);

    /* ---------------- Nodes ---------------- */
    const formattedNodes = nodes.map((node) => {
      const coords = Array.isArray(node.location?.coordinates)
        ? node.location.coordinates.map(Number)
        : null;

      return {
        _id: node._id.toString(),
        nodeId: node._id.toString(),
        type: node.type,
        district: node.district || null,
        state: node.state || node.regionId || "Unknown",
        location: coords ? { type: "Point", coordinates: coords } : null,
      };
    });

    /* ---------------- Requests ---------------- */
    const formattedRequests = requests.map((r) => ({
      _id: r._id.toString(),
      requestId: r._id.toString(),
      requesterNode: r.requesterNode?.toString() || null,
      items: Array.isArray(r.items)
        ? r.items
            .map((i) => ({
              foodType:
                typeof i.foodType === "string" ? i.foodType.trim() : null,
              required_kg: Number(i.required_kg),
            }))
            .filter(
              (i) =>
                i.foodType &&
                Number.isFinite(i.required_kg) &&
                i.required_kg > 0
            )
        : [],
      requiredBy_iso:
        r.requiredBefore instanceof Date
          ? r.requiredBefore.toISOString()
          : r.requiredBefore || null,
      status: r.status || "pending",
    }));

    /* ---------------- Shipments ---------------- */
    const formattedShipments = shipments.map((s) => ({
      _id: s._id.toString(),
      shipmentId: s.shipmentID?.toString() || s._id.toString(),
      batchIds: Array.isArray(s.batchIds)
        ? s.batchIds.map((id) => id.toString())
        : [],
      fromNode: s.fromNode?.toString() || null,
      toNode: s.toNode?.toString() || null,
      start_iso: s.start_iso instanceof Date ? s.start_iso.toISOString() : null,
      travel_time_minutes: Number(s.travel_time_minutes) || null,
    }));

    /* ---------------- Batches (🔥 REQUIRED `_id`) ---------------- */
    const formattedBatches = batches.map((b) => ({
      _id: b._id.toString(), // 🔥 REQUIRED BY PYTHON
      batchId: b._id.toString(),
      originNode: b.originNode?.toString() || null,
      currentNode:
        b.currentNode?.toString() || b.originNode?.toString() || null,
      quantity_kg:
        typeof b.quantity_kg === "number"
          ? b.quantity_kg
          : Number(b.quantity_kg) || 0,
      manufacture_date:
        b.manufacture_date instanceof Date
          ? b.manufacture_date.toISOString()
          : b.manufacture_date || null,
    }));

    /* ========================================================
       FINAL PAYLOAD (DO NOT OMIT ARRAYS)
    ======================================================== */
    const payload = {
      freq: "M",
      nodes: formattedNodes ?? [],
      requests: formattedRequests ?? [],
      shipments: formattedShipments ?? [],
      batches: formattedBatches ?? [],
    };

    // 🔍 Debug (keep this until stable)
    console.log("🚀 ML PAYLOAD KEYS:", Object.keys(payload));
    console.log("📦 batches length:", payload.batches.length);

    const response = await axios.post(endpoint, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          response.data,
          "Simulation data fetched from DB and sent successfully."
        )
      );
  } catch (error) {
    console.error("❌ ML ERROR:", error?.response?.data || error.message);

    if (error.response) {
      throw new ApiError(
        error.response.status,
        "External API error during simulation data send.",
        [error.response.data]
      );
    }

    if (error.request) {
      throw new ApiError(
        502,
        "No response from ML service. Check if Python server is running."
      );
    }

    throw new ApiError(500, "Failed to send simulation data.", [error.message]);
  }
});

/* ============================================================
   TRANSFER PLAN ENDPOINT
============================================================ */

const getData = asyncHandler(async (req, res) => {
  const baseURL = resolveBaseUrl(
    process.env.SIMULATION_BASE_URL,
    "http://localhost:5050"
  );

  const endpoint = `${baseURL}/transfers/plan`;

  const [nodes, batches] = await Promise.all([Node.find(), Batch.find()]);

  const formattedNodes = nodes.map((n) => ({
    _id: n._id.toString(),
    nodeId: n._id.toString(),
    type: n.type,
    state: n.state || n.regionId || null,
    district: n.district || null,
    capacity_kg: Number(n.capacity_kg) || 0,
    location: n.location || null,
  }));

  const formattedBatches = batches.map((b) => {
    const quantity =
      typeof b.quantity_kg === "number"
        ? b.quantity_kg
        : Number(b.quantity_kg) || 0;

    const initialQty =
      typeof b.initial_quantity_kg === "number"
        ? b.initial_quantity_kg
        : typeof b.original_quantity_kg === "number"
          ? b.original_quantity_kg
          : quantity;

    return {
      _id: b._id.toString(),
      batchId: b._id.toString(),

      originNode: b.originNode?.toString() || null,
      currentNode:
        b.currentNode?.toString() || b.originNode?.toString() || null,

      quantity_kg: quantity,
      initial_quantity_kg: initialQty,
      freshnessPct: typeof b.freshnessPct === "number" ? b.freshnessPct : 100,
      shelf_life_hours:
        typeof b.shelf_life_hours === "number" ? b.shelf_life_hours : 72,

      manufacture_date:
        b.manufacture_date instanceof Date
          ? b.manufacture_date.toISOString()
          : b.manufacture_date || null,
    };
  });

  const response = await axios.post(
    endpoint,
    { nodes: formattedNodes, batches: formattedBatches },
    { headers: { "Content-Type": "application/json" }, timeout: 15000 }
  );

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
