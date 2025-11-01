import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js";
import {Event} from "../models/event.model.js";
import {Request} from "../models/request.model.js";

const storeEvent = asyncHandler(async (req, res) => {   
    try {
        const { eventId, time, type, location, payload } = req.body;

        if (!eventId || !time || !type || !location || !payload) {
            throw new ApiError(
                400,
                "Missing required fields. 'eventId', 'time', 'type', 'location', and 'payload' are mandatory."
            );
        }

        
        if (!location.type ||location.type !== 'Point' ||!Array.isArray(location.coordinates) || location.coordinates.length !== 2) 
            {
            throw new ApiError(
                400,
                "Invalid 'location' format. Must include type: 'Point' and [longitude, latitude] coordinates."
            );
        }

        const existingEvent = await Event.findOne({ eventId });
        if (existingEvent) {
            throw new ApiError(409, `Event with ID '${eventId}' already exists.`);
        }

        const newEvent = await Event.create({
            eventId,
            time: new Date(time), 
            type,
            location,
            payload
        });

        return res
            .status(201)
            .json(
                new ApiResponse(
                    201,
                    newEvent,
                    "Event stored successfully."
                )
            );

    } catch (error) {
        if (error instanceof ApiError) {
            throw error; 
        } else {
            throw new ApiError(
                500,
                "Failed to store event data.",
                [error.message],
                error.stack
            );
        }
    }
});

const createNGORequest = asyncHandler(async (req, res) => {
    try {
        const { requestId, requesterNode, items, requiredBy_iso, status, fulfilledBy, history } = req.body;

        if (!requestId || !requesterNode || !items || !Array.isArray(items) || items.length === 0) {
            throw new ApiError(
                400,
                "Missing required fields. 'requestId', 'requesterNode', and 'items' (non-empty array) are mandatory."
            );
        }

        const existingRequest = await Request.findOne({ requestId });
        if (existingRequest) {
            throw new ApiError(409, `Request with ID '${requestId}' already exists.`);
        }

        for (const item of items) {
            if (!item.foodType || typeof item.required_kg !== 'number') {
                throw new ApiError(
                    400,
                    "Each item must include a valid 'foodType' and numeric 'required_kg'."
                );
            }
        }

        const newRequest = await Request.create({
            requestId,
            requesterNode,
            items,
            requiredBy_iso: requiredBy_iso ? new Date(requiredBy_iso) : null,
            status: status || 'open',
            fulfilledBy: fulfilledBy || null,
            history: history || [{
                time: new Date(),
                action: "created",
                note: "Request created successfully."
            }]
        });

        return res
            .status(201)
            .json(
                new ApiResponse(
                    201,
                    newRequest,
                    "NGO request stored successfully."
                )
            );

    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        } else {
            throw new ApiError(
                500,
                "Failed to store NGO request.",
                [error.message],
                error.stack
            );
        }
    }
});  



const newShipment = asyncHandler(async (req, res) => {
    return res
            .status(500)
            .json(
                new ApiResponse(
                    500,
                    {},
                    "No need for Shipment data"
                )
            )

});

const shipmentUpdate = asyncHandler(async (req, res) => {
                                                                //using web sockets , get data from dummy server on live location tracking and logs it in the events + shipmentLocation.model;;

});


export {storeEvent,createNGORequest,newShipment};