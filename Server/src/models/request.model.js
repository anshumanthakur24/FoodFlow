import mongoose from "mongoose";


const requestSchema = new mongoose.Schema({
    requesterNode: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Node',
        required: true
    },
    items: [{
        foodType: { type: String },
        required_kg: { type: Number }
    }],
    requiredBy_iso: {
        type: Date
    },
    status: {
        type: String,
        enum: ['open', 'fulfilled', 'pending', 'cancelled'],
        default: 'open'
    },
    fulfilledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Node'
    },
    history: [{
        time: { type: Date },
        action: { type: String },
        note: { type: String }
    }]
});

export const Request = mongoose.model("Request", requestSchema);