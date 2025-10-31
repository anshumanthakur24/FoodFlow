import mongoose from "mongoose";

const shipmentSchema = new mongoose.Schema({
    shipmentId: {
        type: String,
        required: true,
        unique: true
    },
    batchIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Batch'
    }],
    fromNode: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Node',
        required: true
    },
    toNode: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Node',
        required: true
    },
    start_iso: {
        type: Date,
        required: true
    },
    eta_iso: {
        type: Date
    },
    arrived_iso: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ['in_transit', 'arrived', 'delayed', 'cancelled'],
        default: 'in_transit'
    },
    vehicleId: {
        type: String
    },
    travel_time_minutes: {
        type: Number
    },
    breaks: [{
        start_iso: { type: Date },
        end_iso: { type: Date },
        reason: { type: String }
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
});

export const Shipment = mongoose.model("Shipment", shipmentSchema);
