import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js";

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

const newNGORequest = asyncHandler(async (req, res) => {
        

});    



const newShipment = asyncHandler(async (req, res) => {


});

const shipmentUpdate = asyncHandler(async (req, res) => {
                                                                //using web sockets , get data from dummy server on live location tracking and logs it in the events + shipmentLocation.model;;

});


export {storeEvent,newNGORequest,newShipment, shipmentUpdate};