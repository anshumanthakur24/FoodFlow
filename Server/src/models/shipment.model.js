import mongoose from "mongoose";


const shipmentSchema = new mongoose.Schema({
    shipmentID: {
        type: String
    },
    batchIds:[{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Batch'
    }],
    fromNode:{
        type: mongoose.Schema.Types.ObjectId,
        ref:'Node'
    },
    toNode: {
        type: mongoose.Schema.Types.ObjectId,
        ref:'Node'
    },
    start_iso: {
        type: Date
    },
    travel_time_minutes: {
        type: String
    }
    },{ timestamps:true });

export const Shipment = mongoose.model("Shipment", shipmentSchema);