import axios from "axios";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Node } from "../models/node.model.js";
import { Request } from "../models/request.model.js";
import { Batch } from "../models/batch.model.js";
import { Shipment } from "../models/shipment.model.js"; // assuming you have this model

const sendSimulationData = asyncHandler(async (req, res) => {
  try {
    const baseURL = process.env.SIMULATION_BASE_URL || req.body.baseURL;
    if (!baseURL) {
      throw new ApiError(400, "Missing 'baseURL'. Please provide the target endpoint base URL.");
    }

    const endpoint = `${baseURL}/simulation/data`;

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

const getData=asyncHandler(async (req, res) => {
    const data=fetch("{baseURl}/transfers/plan");
    console.log(data);
})

export { sendSimulationData , getData};
