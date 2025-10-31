const { createHash } = require('crypto');
const seedrandom = require('seedrandom');
const Scenario = require('../models/Scenario');
const SimEvent = require('../models/SimEvent');
const CropSeason = require('../models/CropSeason');
const Region = require('../models/Region');
const Warehouse = require('../models/Warehouse');
const { extractCoordinates, haversineDistanceKm } = require('../utils/geo');
const {
  MAIN_API_URL,
  MAIN_API_ROUTES,
  MAIN_API_TIMEOUT_MS,
  MAX_BATCH_SIZE,
  MIN_INTERVAL_MS,
  DEFAULT_PROBABILITIES,
} = require('../config');

const activeScenarios = new Map();

const fetchApi = (...args) => {
  if (typeof fetch === 'function') return fetch(...args);
  return Promise.reject(new Error('fetch unavailable'));
};

function normalizeBatchSize(value) {
  if (!value || Number.isNaN(Number(value)))
    return Math.min(50, MAX_BATCH_SIZE);
  const numeric = Math.max(1, Math.floor(Number(value)));
  return Math.min(numeric, MAX_BATCH_SIZE);
}

function normalizeInterval(value) {
  if (!value || Number.isNaN(Number(value)))
    return Math.max(1000, MIN_INTERVAL_MS);
  const numeric = Math.max(MIN_INTERVAL_MS, Math.floor(Number(value)));
  return numeric;
}

function normalizeProbabilities(input) {
  const source = { ...DEFAULT_PROBABILITIES, ...(input || {}) };
  const sum = source.farm + source.shipment + source.ngo;
  if (!sum || sum <= 0) return { ...DEFAULT_PROBABILITIES };
  return {
    farm: source.farm / sum,
    shipment: source.shipment / sum,
    ngo: source.ngo / sum,
  };
}

function createAdhocRegions(filterList) {
  return filterList.map((value, index) => ({
    name: value,
    state: value,
    district: null,
    code: `filter-${index + 1}`,
    attributes: { synthetic: true, source: 'user-filter' },
  }));
}

async function synthesizeRegions(filterList) {
  const query = {};
  if (filterList.length) {
    query.$or = [
      { state: { $in: filterList } },
      { district: { $in: filterList } },
      { crop: { $in: filterList } },
    ];
  }
  const seasons = await CropSeason.find(query)
    .sort({ state: 1, district: 1, crop: 1 })
    .limit(500)
    .lean();
  if (!seasons.length) return [];
  const seen = new Set();
  const synthetic = [];
  for (const entry of seasons) {
    const state = entry.state || null;
    const district = entry.district || null;
    const key = `${state || ''}|${district || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = [district, state].filter(Boolean);
    const name = parts.join(', ') || entry.crop || 'Synthetic Region';
    const code =
      district || state || entry.crop || `synthetic-${synthetic.length + 1}`;
    synthetic.push({
      name,
      state,
      district,
      code,
      attributes: { synthetic: true, source: 'crop-seasons' },
    });
    if (synthetic.length >= 100) break;
  }
  return synthetic;
}

async function loadRegions(regionFilter) {
  const filterList = Array.isArray(regionFilter)
    ? regionFilter.filter(Boolean)
    : [];
  if (filterList.length) {
    const regions = await Region.find({
      $or: [
        { code: { $in: filterList } },
        { slug: { $in: filterList } },
        { name: { $in: filterList } },
      ],
    })
      .sort({ name: 1 })
      .lean();
    if (regions.length) return regions;
    const syntheticFromFilter = await synthesizeRegions(filterList);
    if (syntheticFromFilter.length) return syntheticFromFilter;
    const adhocFromFilter = createAdhocRegions(filterList);
    if (adhocFromFilter.length) return adhocFromFilter;
  }
  const fallback = await Region.find({}).sort({ name: 1 }).lean();
  if (fallback.length) return fallback;
  const syntheticAll = await synthesizeRegions([]);
  if (syntheticAll.length) return syntheticAll;
  const defaultRegions = createAdhocRegions([
    'Andhra Pradesh',
    'Bihar',
    'Gujarat',
    'Karnataka',
    'Maharashtra',
    'Uttar Pradesh',
  ]);
  if (defaultRegions.length) return defaultRegions;
  throw new Error('No regions available for simulation');
}

async function loadWarehouses(regions) {
  const regionCodes = regions.map((r) => r.code).filter(Boolean);
  let warehouses = [];
  if (regionCodes.length) {
    warehouses = await Warehouse.find({ regionCode: { $in: regionCodes } })
      .sort({ name: 1 })
      .lean();
  }
  if (warehouses.length) return warehouses;
  const fallback = await Warehouse.find({}).sort({ name: 1 }).lean();
  return fallback;
}

function createEventId(key) {
  return createHash('sha1').update(key).digest('hex');
}

function pseudoObjectId(seed) {
  return createHash('sha1').update(String(seed)).digest('hex').slice(0, 24);
}

function toPointCoordinates(source) {
  const coords = extractCoordinates(source);
  if (
    coords &&
    typeof coords.lon === 'number' &&
    typeof coords.lat === 'number'
  ) {
    return [Number(coords.lon.toFixed(6)), Number(coords.lat.toFixed(6))];
  }
  return [0, 0];
}

function deriveEventTimestamp(runtime, tickTimestamp, eventIndex) {
  if (runtime.batchSize <= 1) return new Date(tickTimestamp.getTime());
  const spacing = Math.max(
    1,
    Math.floor(runtime.intervalMs / runtime.batchSize)
  );
  return new Date(tickTimestamp.getTime() + spacing * eventIndex);
}

function parseCropYear(sourceFile, fallbackDate) {
  if (typeof sourceFile === 'string') {
    const match = sourceFile.match(/(19|20)\d{2}/);
    if (match) return Number(match[0]);
  }
  return fallbackDate.getUTCFullYear();
}

function isInSeason(entry, month) {
  const sowStart =
    entry.season_sowing_start_month || entry.season_harvest_start_month;
  const harvestEnd =
    entry.season_harvest_end_month || entry.season_harvest_start_month;
  if (!sowStart || !harvestEnd) return true;
  if (sowStart <= harvestEnd) return month >= sowStart && month <= harvestEnd;
  return month >= sowStart || month <= harvestEnd;
}

function resolveRegionForShipment(runtime, rng) {
  const available = runtime.farmInventory.filter(
    (item) => item.availableTonnes > 0
  );
  if (!available.length) return null;
  const index = Math.floor(rng() * available.length);
  return available[index];
}

function resolveWarehouse(runtime, regionEntry, rng) {
  if (!runtime.warehouses.length) return { warehouse: null, distanceKm: null };
  const sourceCoords = extractCoordinates(regionEntry.region || regionEntry);
  let selected = null;
  let minDistance = Number.POSITIVE_INFINITY;
  if (sourceCoords) {
    for (const warehouse of runtime.warehouses) {
      const coords = extractCoordinates(warehouse);
      if (!coords) continue;
      const distance = haversineDistanceKm(sourceCoords, coords);
      if (distance === null) continue;
      if (distance < minDistance) {
        minDistance = distance;
        selected = warehouse;
      }
    }
  }
  if (selected) return { warehouse: selected, distanceKm: minDistance };
  const index = Math.floor(rng() * runtime.warehouses.length);
  return { warehouse: runtime.warehouses[index], distanceKm: null };
}

async function fetchCropEntries(runtime, region) {
  const cacheKey = region._id
    ? region._id.toString()
    : `${region.state || ''}:${region.district || ''}:${region.name || ''}`;
  if (runtime.cropCache.has(cacheKey)) return runtime.cropCache.get(cacheKey);
  const query = {};
  if (region.state) query.state = region.state;
  if (region.district) query.district = region.district;
  const entries = await CropSeason.find(query)
    .sort({ district: 1, crop: 1, source_file: 1 })
    .limit(500)
    .lean();
  runtime.cropCache.set(cacheKey, entries);
  return entries;
}

function buildFarmPayload(
  runtime,
  region,
  cropEntry,
  producedTonnes,
  eventTimestamp,
  eventId
) {
  const quantityKg = Number((producedTonnes * 1000).toFixed(2));
  const regionCode = region.code || region.slug || region.name || eventId;
  const nodeObjectId = pseudoObjectId(`farm-node:${regionCode}`);
  const cropName = cropEntry
    ? cropEntry.crop || 'Mixed Produce'
    : 'Mixed Produce';
  const point = toPointCoordinates(region);
  const batchId = `batch-${eventId.slice(0, 24)}`;
  const batch = {
    batchId,
    parentBatchId: null,
    foodType: cropName,
    quantity_kg: quantityKg,
    original_quantity_kg: quantityKg,
    originNode: nodeObjectId,
    currentNode: nodeObjectId,
    status: 'stored',
    shelf_life_hours: cropEntry
      ? (cropEntry.season_growth_months || 4) * 30 * 24
      : 90 * 24,
    manufacture_date: eventTimestamp.toISOString(),
    expiry_iso: cropEntry
      ? new Date(
          eventTimestamp.getTime() +
            (cropEntry.season_growth_months || 6) * 30 * 24 * 3600000
        ).toISOString()
      : null,
    initial_temp_c: 18 + Math.random() * 6,
    freshnessPct: 100,
    history: [
      {
        time: eventTimestamp.toISOString(),
        action: 'harvested',
        from: null,
        to: nodeObjectId,
        note: `Harvest batch for ${regionCode}`,
      },
    ],
    metadata: {
      scenarioId: runtime.scenario._id.toString(),
      tickIndex: runtime.tickIndex,
    },
  };

  return {
    eventId,
    time: eventTimestamp.toISOString(),
    type: 'farm_production',
    location: { type: 'Point', coordinates: point },
    payload: {
      scenarioId: runtime.scenario._id.toString(),
      tickIndex: runtime.tickIndex,
      region: {
        id: region._id ? region._id.toString() : null,
        name: region.name || null,
        state: region.state || null,
        district: region.district || null,
        code: region.code || null,
      },
      crop: {
        name: cropName,
        season: cropEntry ? cropEntry.season || null : null,
        year: parseCropYear(
          cropEntry ? cropEntry.source_file : null,
          eventTimestamp
        ),
        sowingWindow: {
          startMonth: cropEntry
            ? cropEntry.season_sowing_start_month || null
            : null,
          endMonth: cropEntry
            ? cropEntry.season_sowing_end_month || null
            : null,
        },
        harvestWindow: {
          startMonth: cropEntry
            ? cropEntry.season_harvest_start_month || null
            : null,
          endMonth: cropEntry
            ? cropEntry.season_harvest_end_month || null
            : null,
        },
      },
      quantity_kg: quantityKg,
      quantity_tonnes: Number(producedTonnes.toFixed(2)),
      metrics: {
        area_hectare: cropEntry ? cropEntry.area_hectare || null : null,
        yield_tonha: cropEntry ? cropEntry.yield_tonha || null : null,
        production_tonnes: cropEntry
          ? cropEntry.production_tonnes || null
          : null,
      },
      batch,
    },
  };
}

function buildShipmentPayload(
  runtime,
  batch,
  warehouse,
  distanceKm,
  quantity,
  eventTimestamp,
  eta,
  eventId
) {
  const regionCode = batch.region.code || batch.region.name || batch.eventId;
  const fromNodeId = pseudoObjectId(`farm-node:${regionCode}`);
  const warehouseCode = warehouse
    ? warehouse.code || warehouse.name || 'warehouse'
    : 'warehouse';
  const toNodeId = pseudoObjectId(`warehouse-node:${warehouseCode}`);
  const travelHours = Number(batch.travelHours.toFixed(2));
  const point = warehouse
    ? toPointCoordinates(warehouse)
    : toPointCoordinates(batch.region);
  return {
    shipmentId: eventId,
    batchIds: [],
    fromNode: fromNodeId,
    toNode: toNodeId,
    start_iso: eventTimestamp.toISOString(),
    eta_iso: eta.toISOString(),
    arrived_iso: null,
    status: 'in_transit',
    vehicleId: `vehicle-${eventId.slice(0, 6)}`,
    travel_time_minutes: Math.max(30, Math.round(travelHours * 60)),
    breaks: [],
    createdBy: null,
    latest_location: {
      coordinates: point,
      timestamp: eventTimestamp.toISOString(),
    },
    metadata: {
      scenarioId: runtime.scenario._id.toString(),
      tickIndex: runtime.tickIndex,
      quantity_kg: Number((quantity * 1000).toFixed(2)),
      distance_km: distanceKm !== null ? Number(distanceKm.toFixed(2)) : null,
      sourceFarmEventId: batch.eventId,
    },
  };
}

function buildNgoPayload(
  runtime,
  region,
  severity,
  needs,
  eventTimestamp,
  deadline,
  eventId
) {
  const regionCode = region.code || region.name || eventId;
  const requesterNode = pseudoObjectId(`ngo-node:${regionCode}`);
  return {
    requestId: eventId,
    requesterNode,
    items: needs.map((item) => ({
      foodType: item.item,
      required_kg: item.requiredKg,
    })),
    requiredBy_iso: deadline.toISOString(),
    status: 'open',
    fulfilledBy: null,
    history: [
      {
        time: eventTimestamp.toISOString(),
        action: 'created',
        note: `Scenario ${runtime.scenario.name} severity ${severity}`,
      },
    ],
    metadata: {
      scenarioId: runtime.scenario._id.toString(),
      tickIndex: runtime.tickIndex,
      region: {
        id: region._id ? region._id.toString() : null,
        name: region.name || null,
        state: region.state || null,
        district: region.district || null,
        code: region.code || null,
      },
      severity,
    },
  };
}

async function createFarmEvent(runtime, rng, eventKey, eventTimestamp) {
  if (!runtime.regions.length) return null;
  const regionIndex = Math.floor(rng() * runtime.regions.length);
  const region = runtime.regions[regionIndex];
  const entries = await fetchCropEntries(runtime, region);
  const month = eventTimestamp.getUTCMonth() + 1;
  const inSeason = entries.filter((entry) => isInSeason(entry, month));
  const pool = inSeason.length ? inSeason : entries;
  const cropEntry = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  const baseProduction =
    cropEntry && cropEntry.area_hectare && cropEntry.yield_tonha
      ? cropEntry.area_hectare * cropEntry.yield_tonha
      : 0;
  const scale = 0.85 + rng() * 0.3;
  const fallback = 40 + rng() * 120;
  const producedTonnes = baseProduction > 0 ? baseProduction * scale : fallback;
  const eventId = createEventId(eventKey);
  const payload = buildFarmPayload(
    runtime,
    region,
    cropEntry,
    producedTonnes,
    eventTimestamp,
    eventId
  );
  runtime.farmInventory.push({
    eventId,
    region,
    crop: cropEntry ? cropEntry.crop || null : null,
    season: cropEntry ? cropEntry.season || null : null,
    availableTonnes: Number(producedTonnes.toFixed(2)),
    batchId:
      payload.payload && payload.payload.batch
        ? payload.payload.batch.batchId
        : null,
    timestamp: eventTimestamp,
  });
  return {
    type: 'farm',
    timestamp: eventTimestamp,
    record: {
      scenarioId: runtime.scenario._id,
      type: 'farm',
      payload,
      tickIndex: runtime.tickIndex,
      timestamp: eventTimestamp,
    },
    apiRequest: {
      url: `${MAIN_API_URL}${MAIN_API_ROUTES.farm}`,
      body: payload,
    },
  };
}

async function createShipmentEvent(runtime, rng, eventKey, eventTimestamp) {
  const batch = resolveRegionForShipment(runtime, rng);
  if (!batch) return null;
  const fraction = 0.25 + rng() * 0.5;
  const maxQuantity = Math.max(1, batch.availableTonnes * fraction);
  const quantity = Math.min(batch.availableTonnes, maxQuantity);
  batch.availableTonnes = Number(
    Math.max(0, batch.availableTonnes - quantity).toFixed(2)
  );
  const { warehouse, distanceKm } = resolveWarehouse(runtime, batch, rng);
  const distanceValue = distanceKm !== null ? distanceKm : 50 + rng() * 300;
  const speedKmph = 40 + rng() * 30;
  const travelHours = distanceValue / speedKmph;
  batch.speedKmph = Number(speedKmph.toFixed(2));
  batch.travelHours = Number(travelHours.toFixed(2));
  const eta = new Date(eventTimestamp.getTime() + travelHours * 3600000);
  const eventId = createEventId(eventKey);
  const payload = buildShipmentPayload(
    runtime,
    batch,
    warehouse,
    distanceValue,
    quantity,
    eventTimestamp,
    eta,
    eventId
  );
  return {
    type: 'shipment',
    timestamp: eventTimestamp,
    record: {
      scenarioId: runtime.scenario._id,
      type: 'shipment',
      payload,
      tickIndex: runtime.tickIndex,
      timestamp: eventTimestamp,
    },
    apiRequest: {
      url: `${MAIN_API_URL}${MAIN_API_ROUTES.shipment}`,
      body: payload,
    },
  };
}

async function createNgoEvent(runtime, rng, eventKey, eventTimestamp) {
  if (!runtime.regions.length) return null;
  const targetIndex = Math.floor(rng() * runtime.regions.length);
  const region = runtime.regions[targetIndex];
  const severity = Math.min(5, Math.max(1, Math.floor(rng() * 5) + 1));
  const needsPool = ['cereals', 'pulses', 'fertilizer', 'seeds', 'logistics'];
  const needsCount = Math.max(1, Math.floor(rng() * needsPool.length));
  const needs = Array.from({ length: needsCount }, (_, idx) => {
    const choice =
      needsPool[
        (idx + Math.floor(rng() * needsPool.length)) % needsPool.length
      ];
    const quantityTonnes = Number((10 + rng() * 90).toFixed(2));
    return {
      item: choice,
      quantityTonnes,
      requiredKg: Number((quantityTonnes * 1000).toFixed(2)),
    };
  });
  const deadline = new Date(
    eventTimestamp.getTime() + (2 + rng() * 5) * 86400000
  );
  const eventId = createEventId(eventKey);
  const payload = buildNgoPayload(
    runtime,
    region,
    severity,
    needs,
    eventTimestamp,
    deadline,
    eventId
  );
  return {
    type: 'ngo',
    timestamp: eventTimestamp,
    record: {
      scenarioId: runtime.scenario._id,
      type: 'ngo',
      payload,
      tickIndex: runtime.tickIndex,
      timestamp: eventTimestamp,
    },
    apiRequest: {
      url: `${MAIN_API_URL}${MAIN_API_ROUTES.ngo}`,
      body: payload,
    },
  };
}

async function generateEvents(runtime, tickTimestamp) {
  const events = [];
  const baseKey = `${runtime.scenario.seed}:${runtime.scenario._id}:${runtime.tickIndex}`;
  for (let i = 0; i < runtime.batchSize; i += 1) {
    const eventKey = `${baseKey}:${i}`;
    const rng = seedrandom(eventKey);
    const eventTimestamp = deriveEventTimestamp(runtime, tickTimestamp, i);
    const roll = rng();
    let event;
    if (roll < runtime.probabilities.farm) {
      event = await createFarmEvent(runtime, rng, eventKey, eventTimestamp);
    } else if (
      roll <
      runtime.probabilities.farm + runtime.probabilities.shipment
    ) {
      event = await createShipmentEvent(runtime, rng, eventKey, eventTimestamp);
      if (!event)
        event = await createFarmEvent(
          runtime,
          rng,
          `${eventKey}:fallback`,
          eventTimestamp
        );
    } else {
      event = await createNgoEvent(runtime, rng, eventKey, eventTimestamp);
      if (!event)
        event = await createFarmEvent(
          runtime,
          rng,
          `${eventKey}:fallback`,
          eventTimestamp
        );
    }
    if (event) events.push(event);
  }
  return events;
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAIN_API_TIMEOUT_MS);
  try {
    const response = await fetchApi(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('Main API error', response.status, text);
    }
  } catch (err) {
    console.error('Main API error', err.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function dispatchEvents(events) {
  if (!events.length) return;
  const tasks = events.map((event) =>
    postJson(event.apiRequest.url, event.apiRequest.body)
  );
  await Promise.allSettled(tasks);
}

async function persistEvents(events) {
  if (!events.length) return;
  const docs = events.map((event) => ({
    scenarioId: event.record.scenarioId,
    type: event.record.type,
    payload: event.record.payload,
    tickIndex: event.record.tickIndex,
    timestamp: event.record.timestamp,
  }));
  await SimEvent.insertMany(docs, { ordered: false });
}

function scheduleNext(runtime) {
  if (!runtime.active) return;
  runtime.timer = setTimeout(async () => {
    try {
      if (!runtime.active) return;
      if (
        runtime.durationMs &&
        Date.now() - runtime.startedAt >= runtime.durationMs
      ) {
        await runtime.stop(true);
        return;
      }
      const tickTimestamp = new Date(
        runtime.scenario.startDate.getTime() +
          runtime.tickIndex * runtime.intervalMs
      );
      const events = await generateEvents(runtime, tickTimestamp);
      if (events.length) {
        await persistEvents(events);
        await Scenario.updateOne(
          { _id: runtime.scenario._id },
          { $inc: { 'stats.totalEventsSent': events.length } }
        );
        runtime.sentEvents += events.length;
        await dispatchEvents(events);
      }
      runtime.tickIndex += 1;
      scheduleNext(runtime);
    } catch (err) {
      console.error('Scenario tick error', err.message);
      runtime.active = false;
      if (runtime.timer) clearTimeout(runtime.timer);
      await Scenario.updateOne(
        { _id: runtime.scenario._id },
        { status: 'stopped' }
      );
      activeScenarios.delete(runtime.scenario._id.toString());
    }
  }, runtime.intervalMs);
}

function createRuntime(scenario, options) {
  const runtime = {
    scenario,
    batchSize: options.batchSize,
    intervalMs: options.intervalMs,
    probabilities: options.probabilities,
    durationMs: options.durationMs,
    regionFilter: options.regionFilter,
    active: false,
    timer: null,
    tickIndex: 0,
    startedAt: null,
    regions: [],
    warehouses: [],
    farmInventory: [],
    cropCache: new Map(),
    sentEvents: 0,
    stop: async (updateStatus) => {
      if (runtime.timer) {
        clearTimeout(runtime.timer);
        runtime.timer = null;
      }
      runtime.active = false;
      activeScenarios.delete(runtime.scenario._id.toString());
      if (updateStatus) {
        await Scenario.updateOne(
          { _id: runtime.scenario._id },
          { status: 'stopped' }
        );
      }
    },
  };

  runtime.start = async () => {
    runtime.regions = await loadRegions(runtime.regionFilter);
    runtime.warehouses = await loadWarehouses(runtime.regions);
    runtime.startedAt = Date.now();
    runtime.tickIndex = 0;
    runtime.active = true;
    scheduleNext(runtime);
  };

  return runtime;
}

async function startScenario(input) {
  const name = input && input.name ? String(input.name).trim() : '';
  const seed = input && input.seed ? String(input.seed).trim() : '';
  if (!name) throw new Error('Scenario name is required');
  if (!seed) throw new Error('Scenario seed is required');
  const existing = await Scenario.findOne({ name, status: 'running' }).lean();
  if (existing) throw new Error('Scenario with this name is already running');
  const batchSize = normalizeBatchSize(input.batchSize);
  const intervalMs = normalizeInterval(input.intervalMs);
  const probabilities = normalizeProbabilities(input.probabilities);
  const startDateInput = input.startDate
    ? new Date(input.startDate)
    : new Date();
  if (Number.isNaN(startDateInput.getTime()))
    throw new Error('Invalid startDate');
  const durationMs = input.durationMinutes
    ? Math.max(0, Number(input.durationMinutes)) * 60000
    : null;
  const scenario = await Scenario.create({
    name,
    seed,
    startDate: startDateInput,
    config: {
      batchSize,
      intervalMs,
      regionFilter: Array.isArray(input.regions) ? input.regions : [],
    },
    probabilities,
    status: 'running',
    stats: { totalEventsSent: 0 },
  });
  const runtime = createRuntime(scenario, {
    batchSize,
    intervalMs,
    probabilities,
    durationMs,
    regionFilter: Array.isArray(input.regions) ? input.regions : [],
  });
  activeScenarios.set(scenario._id.toString(), runtime);
  try {
    await runtime.start();
  } catch (err) {
    await runtime.stop(true);
    throw err;
  }
  return scenario;
}

async function stopScenario(scenarioId) {
  if (!scenarioId) throw new Error('scenarioId is required');
  const id = scenarioId.toString();
  const runtime = activeScenarios.get(id);
  if (runtime) await runtime.stop(true);
  const scenario = await Scenario.findById(id);
  if (!scenario) throw new Error('Scenario not found');
  if (scenario.status !== 'stopped') {
    scenario.status = 'stopped';
    await scenario.save();
  }
  return scenario;
}

async function getScenarioStatus(id) {
  if (!id) throw new Error('Scenario id is required');
  const scenario = await Scenario.findById(id).lean();
  if (!scenario) throw new Error('Scenario not found');
  return scenario;
}

async function getScenarioEvents(id, limit) {
  if (!id) throw new Error('Scenario id is required');
  const capped = Math.max(1, Math.min(Number(limit) || 100, 500));
  const events = await SimEvent.find({ scenarioId: id })
    .sort({ timestamp: -1 })
    .limit(capped)
    .lean();
  return events;
}

module.exports = {
  startScenario,
  stopScenario,
  getScenarioStatus,
  getScenarioEvents,
};
