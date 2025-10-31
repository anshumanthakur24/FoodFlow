const mongoose = require('mongoose');

const ScenarioSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    seed: { type: String, required: true },
    startDate: { type: Date, required: true },
    config: {
      batchSize: { type: Number, required: true },
      intervalMs: { type: Number, required: true },
      regionFilter: [{ type: String }],
    },
    probabilities: {
      farm: { type: Number, default: 0.7 },
      shipment: { type: Number, default: 0.25 },
      ngo: { type: Number, default: 0.05 },
    },
    status: {
      type: String,
      enum: ['running', 'stopped'],
      default: 'running',
      index: true,
    },
    stats: {
      totalEventsSent: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Scenario', ScenarioSchema);
