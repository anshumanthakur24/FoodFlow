import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js";

const getAllEvents=asyncHandler(async(req,res)=>{
    const { start, end } = req.query;

    if (!start || !end) {
        throw new ApiError(400, "Please provide both 'start' and 'end' query parameters (YYYY-MM-DD).");
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    // Query events within the range
    const events = await Event.find({
        time: { $gte: startDate, $lte: endDate }
    }).sort({ time: 1 });

    // Return wrapped response
    return res
    .status(200)
    .json(new ApiResponse(200,{
                    count: events.length,
                    start: startDate,
                    end: endDate,
                    events
                },
                "Events fetched successfully"
            )
        );
})

export {getAllEvents};