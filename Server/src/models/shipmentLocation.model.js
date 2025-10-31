const shipmentLocationSchema = new mongoose.Schema({
    shipmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shipment',
        required: true,
        index: true
    },
    timestamp: {
        type: Date,
        required: true,
        index: true
    },
    coordinates: {
        type: [Number], // [longitude, latitude]
        required: true
    },
    speed_kmh: {
        type: Number
    },
    eta_iso: {
        type: Date // optional, recalculated ETA if provided by Dummy
    }
});

export const ShipmentLocation = mongoose.model("ShipmentLocation", shipmentLocationSchema);