import mongoose from "mongoose";

const eventSchema = new mongoose.Schema({
    eventId: {
        type: String,
        required: true,
        unique: true
    },
    time: {
        type: Date,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    payload: {
        type: Object // Flexible JSON data
    }
});

export const Event = mongoose.model("Event", eventSchema);