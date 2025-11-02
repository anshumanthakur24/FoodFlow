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
    },
    transfer_type: {
        type: String,
        enum: ['farm_to_warehouse', 'warehouse_to_warehouse'],
        default: null
    },
    suggested_quantity_kg: {
        type: Number
    },
    distance_km: {
        type: Number
    },
    notes: {
        type: String
    },
    routing: {
        type: mongoose.Schema.Types.Mixed
    }
    },{ timestamps:true });

export const Shipment = mongoose.model("Shipment", shipmentSchema);