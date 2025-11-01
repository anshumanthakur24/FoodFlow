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
  const merged = { ...DEFAULT_PROBABILITIES, ...(input || {}) };
  const entries = Object.entries(merged).map(([key, value]) => [
    key,
    Number(value) || 0,
  ]);
  const total = entries.reduce((acc, [, value]) => acc + value, 0);
  if (!total || total <= 0) return { ...DEFAULT_PROBABILITIES };
  return entries.reduce((acc, [key, value]) => {
    acc[key] = value / total;
    return acc;
  }, {});
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

  const rows = await CropSeason.find(query)
    .sort({ state: 1, district: 1, crop: 1 })
    .limit(5000)
    .lean();

  const seen = new Set();
  const synthetic = [];
  for (const row of rows) {
    const state = row.state || null;
    const district = row.district || null;
    const key = `${state || ''}:${district || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const baseName = district || state || 'Region';
    const slugBase = [state, district]
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    const code = slugBase ? `synthetic-${slugBase}`.slice(0, 48) : null;

    synthetic.push({
      name: baseName,
      state,
      district,
      code,
      slug: slugBase || null,
      attributes: { synthetic: true, source: 'crop-season' },
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

function nodeToEmittedFrom(node) {
  const coords = extractCoordinates(node);
  return {
    nodeId: node.nodeId || null,
    type: node.type || null,
    name: node.name || null,
    state: node.state || null,
    district: node.district || null,
    location: coords
      ? {
          lat: Number(coords.lat.toFixed(6)),
          lon: Number(coords.lon.toFixed(6)),
        }
      : null,
  };
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
    event: {
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
    },
    batchId,
  };
}

function createRequestItems(rng) {
  const catalog = [
    { foodType: 'cereals', min: 350, max: 1200 },
    { foodType: 'pulses', min: 200, max: 800 },
    { foodType: 'oil', min: 150, max: 600 },
    { foodType: 'vegetables', min: 250, max: 900 },
    { foodType: 'fertilizer', min: 300, max: 900 },
    { foodType: 'seeds', min: 100, max: 400 },
    { foodType: 'logistics', min: 1, max: 3 },
  ];
  const desired = Math.max(1, Math.floor(rng() * 3) + 1);
  const items = [];
  const used = new Set();
  while (items.length < desired && used.size < catalog.length) {
    const index = Math.floor(rng() * catalog.length);
    if (used.has(index)) continue;
    used.add(index);
    const entry = catalog[index];
    const required = entry.min + rng() * (entry.max - entry.min);
    const rounded =
      entry.foodType === 'logistics'
        ? Number(required.toFixed(0))
        : Number(required.toFixed(2));
    items.push({ foodType: entry.foodType, required_kg: rounded });
  }
  return items;
}

function chooseFulfillmentCandidate(runtime, rng) {
  const candidates = [];
  if (runtime.warehouseNodes.length) candidates.push(...runtime.warehouseNodes);
  if (runtime.warehouses.length) candidates.push(...runtime.warehouses);
  if (runtime.farmNodes.length) candidates.push(...runtime.farmNodes);
  if (!candidates.length) return null;
  const index = Math.floor(rng() * candidates.length);
  return candidates[index];
}

async function createFarmEvent(runtime, rng, eventKey, eventTimestamp) {
  // Node-driven mode (preferred): generate directly from farm nodes
  if (runtime.nodeMode) {
    if (!runtime.farmNodes.length) return null;
    const node =
      runtime.farmNodes[Math.floor(rng() * runtime.farmNodes.length)];
    const quantityTonnes = Number((10 + rng() * 90).toFixed(2));
    const eventId = createEventId(eventKey);
    const quantityKg = Number((quantityTonnes * 1000).toFixed(2));
    const point = toPointCoordinates(node);
    const batchId = `batch-${eventId.slice(0, 24)}`;
    const emittedFrom = nodeToEmittedFrom(node);
    const payload = {
      eventId,
      time: eventTimestamp.toISOString(),
      type: 'farm_production',
      location: { type: 'Point', coordinates: point },
      emittedFrom,
      payload: {
        scenarioId: runtime.scenario._id.toString(),
        tickIndex: runtime.tickIndex,
        node: emittedFrom,
        quantity_kg: quantityKg,
        quantity_tonnes: quantityTonnes,
        batch: {
          parentBatchId: null,
          foodType: 'Mixed Produce',
          quantity_kg: quantityKg,
          original_quantity_kg: quantityKg,
          originNode: node.nodeId || null,
          currentNode: node.nodeId || null,
          status: 'stored',
          shelf_life_hours: 90 * 24,
          manufacture_date: eventTimestamp.toISOString(),
          expiry_iso: null,
          initial_temp_c: 20,
          freshnessPct: 100,
          history: [
            {
              time: eventTimestamp.toISOString(),
              action: 'harvested',
              from: null,
              to: node.nodeId || null,
              note: `Harvest batch for ${node.nodeId || 'farm-node'}`,
            },
          ],
          metadata: {
            scenarioId: runtime.scenario._id.toString(),
            tickIndex: runtime.tickIndex,
          },
        },
      },
    };
    runtime.farmInventory.push({
      eventId,
      node,
      availableTonnes: quantityTonnes,
      batchId,
      timestamp: eventTimestamp,
      speedKmph: 0,
      travelHours: 0,
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
  const { event: farmEvent, batchId } = buildFarmPayload(
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
    batchId,
    timestamp: eventTimestamp,
  });
  return {
    type: 'farm',
    timestamp: eventTimestamp,
    record: {
      scenarioId: runtime.scenario._id,
      type: 'farm',
      payload: farmEvent,
      tickIndex: runtime.tickIndex,
      timestamp: eventTimestamp,
    },
    apiRequest: {
      url: `${MAIN_API_URL}${MAIN_API_ROUTES.farm}`,
      body: farmEvent,
    },
  };
}

function regionToRequesterDetails(region) {
  const point = toPointCoordinates(region);
  const [lon, lat] = Array.isArray(point) ? point : [null, null];
  return {
    nodeId: null,
    type: 'region',
    name: region.name || region.district || region.state || 'Region',
    state: region.state || null,
    district: region.district || null,
    location:
      lat !== null && lon !== null
        ? { lat: Number(lat), lon: Number(lon) }
        : null,
  };
}

function createRequestAcceptanceEvent(runtime, ledgerEntry) {
  if (!ledgerEntry) return null;
  const acceptanceTimestamp = ledgerEntry.acceptAt || new Date();
  const daysOpen = Math.max(
    0,
    Math.round(
      (acceptanceTimestamp.getTime() - ledgerEntry.createdOn.getTime()) /
        86400000
    )
  );
  const history = [
    ...ledgerEntry.history,
    {
      time: acceptanceTimestamp.toISOString(),
      action: 'approved',
      note: `Request approved after ${daysOpen} day(s)`,
    },
  ];
  ledgerEntry.history = history;
  ledgerEntry.status = 'approved';
  ledgerEntry.acceptedAt = acceptanceTimestamp;
  runtime.requestLedger.set(ledgerEntry.requestId, ledgerEntry);

  const payload = {
    requestId: ledgerEntry.requestId,
    status: 'approved',
    approvedOn: acceptanceTimestamp.toISOString(),
    fulfilledBy: ledgerEntry.fulfilledBy || null,
    history,
    metadata: {
      scenarioId: runtime.scenario._id.toString(),
      tickIndex: runtime.tickIndex,
      requester: ledgerEntry.requesterDetails,
      fulfilledBy: ledgerEntry.fulfilledByDetails || null,
      daysOpen,
    },
  };

  if (ledgerEntry.requiredBefore) {
    payload.requiredBefore = ledgerEntry.requiredBefore.toISOString();
  }

  return {
    type: 'requestAccepted',
    timestamp: acceptanceTimestamp,
    record: {
      scenarioId: runtime.scenario._id,
      type: 'requestAccepted',
      payload,
      tickIndex: runtime.tickIndex,
      timestamp: acceptanceTimestamp,
    },
    apiRequest: {
      url: `${MAIN_API_URL}${MAIN_API_ROUTES.requestAccept}`,
      body: payload,
    },
  };
}

function createRequestEvent(runtime, rng, eventKey, eventTimestamp) {
  const requestKey = createEventId(`${eventKey}:request`);
  const requestId = `REQ-${requestKey.slice(0, 12).toUpperCase()}`;
  const items = createRequestItems(rng);

  let requesterNodeId;
  let requesterDetails;

  if (runtime.nodeMode) {
    if (!runtime.ngoNodes.length) return null;
    const node = runtime.ngoNodes[Math.floor(rng() * runtime.ngoNodes.length)];
    requesterDetails = nodeToEmittedFrom(node);
    const candidate =
      (node.mongoId && node.mongoId.toString()) ||
      (node._id && node._id.toString && node._id.toString()) ||
      node.nodeId ||
      requesterDetails.nodeId ||
      requestId;
    const candidateStr = String(candidate);
    const looksLikeObjectId = /^[a-f0-9]{24}$/i.test(candidateStr);
    requesterNodeId = looksLikeObjectId
      ? candidateStr
      : pseudoObjectId(`node:${candidateStr}`);
  } else {
    if (!runtime.regions.length) return null;
    const region = runtime.regions[Math.floor(rng() * runtime.regions.length)];
    requesterDetails = regionToRequesterDetails(region);
    requesterNodeId = pseudoObjectId(
      `region:${region.code || region.district || region.name || requestId}`
    );
  }

  const createdOn = eventTimestamp;
  const requiredBefore = new Date(
    eventTimestamp.getTime() + (2 + Math.floor(rng() * 5)) * 86400000
  );
  const history = [
    {
      time: createdOn.toISOString(),
      action: 'created',
      note: `Scenario ${runtime.scenario.name} request created`,
    },
  ];

  const payload = {
    requestId,
    requesterNode: requesterNodeId,
    items,
    createdOn: createdOn.toISOString(),
    requiredBefore: requiredBefore.toISOString(),
    status: 'pending',
    fulfilledBy: null,
    history,
    metadata: {
      scenarioId: runtime.scenario._id.toString(),
      tickIndex: runtime.tickIndex,
      requester: requesterDetails,
    },
  };

  const ledgerEntry = {
    requestId,
    requesterNode: requesterNodeId,
    requesterDetails,
    createdOn,
    requiredBefore,
    items,
    history: [...history],
    status: 'pending',
  };

  const acceptanceChance = 0.65;
  if (rng() < acceptanceChance) {
    const minDays = 1;
    const maxDays = 6;
    const dayOffset = minDays + Math.floor(rng() * (maxDays - minDays + 1));
    const acceptAt = new Date(eventTimestamp.getTime() + dayOffset * 86400000);
    ledgerEntry.acceptAt = acceptAt;
    const fulfillCandidate = chooseFulfillmentCandidate(runtime, rng);
    if (fulfillCandidate) {
      if (fulfillCandidate.nodeId) {
        ledgerEntry.fulfilledBy = pseudoObjectId(
          `node:${fulfillCandidate.nodeId}`
        );
        ledgerEntry.fulfilledByDetails = nodeToEmittedFrom(fulfillCandidate);
      } else {
        const coords = extractCoordinates(fulfillCandidate);
        const hasCoords =
          coords &&
          typeof coords.lat === 'number' &&
          typeof coords.lon === 'number';
        ledgerEntry.fulfilledBy = pseudoObjectId(
          `warehouse:${
            fulfillCandidate.code || fulfillCandidate.name || requestId
          }`
        );
        ledgerEntry.fulfilledByDetails = {
          nodeId: fulfillCandidate.code || fulfillCandidate.name || null,
          type: fulfillCandidate.type || 'warehouse',
          name: fulfillCandidate.name || null,
          state: fulfillCandidate.state || null,
          district: fulfillCandidate.district || null,
          location: hasCoords
            ? {
                lat: Number(coords.lat.toFixed(6)),
                lon: Number(coords.lon.toFixed(6)),
              }
            : null,
        };
      }
    }
    runtime.pendingRequests.push(ledgerEntry);
  } else {
    runtime.openRequests.set(requestId, ledgerEntry);
  }
  runtime.requestLedger.set(requestId, ledgerEntry);

  return {
    type: 'request',
    timestamp: eventTimestamp,
    record: {
      scenarioId: runtime.scenario._id,
      type: 'request',
      payload,
      tickIndex: runtime.tickIndex,
      timestamp: eventTimestamp,
    },
    apiRequest: {
      url: `${MAIN_API_URL}${MAIN_API_ROUTES.request}`,
      body: payload,
    },
  };
}

function collectRequestAcceptanceEvents(runtime, tickTimestamp) {
  if (!runtime.pendingRequests.length) return [];
  const ready = [];
  const waiting = [];
  for (const entry of runtime.pendingRequests) {
    if (entry.acceptAt && entry.acceptAt <= tickTimestamp) {
      const event = createRequestAcceptanceEvent(runtime, entry);
      if (event) ready.push(event);
      runtime.openRequests.delete(entry.requestId);
    } else {
      waiting.push(entry);
    }
  }
  runtime.pendingRequests = waiting;
  return ready;
}

async function generateEvents(runtime, tickTimestamp) {
  const events = [];
  const acceptanceEvents = collectRequestAcceptanceEvents(
    runtime,
    tickTimestamp
  );
  if (acceptanceEvents.length) events.push(...acceptanceEvents);
  const baseKey = `${runtime.scenario.seed}:${runtime.scenario._id}:${runtime.tickIndex}`;
  for (let i = 0; i < runtime.batchSize; i += 1) {
    const eventKey = `${baseKey}:${i}`;
    const rng = seedrandom(eventKey);
    const eventTimestamp = deriveEventTimestamp(runtime, tickTimestamp, i);
    const roll = rng();
    let event;
    const farmThreshold = runtime.probabilities.farm || 0;
    const requestThreshold =
      farmThreshold + (runtime.probabilities.request || 0);
    if (roll < farmThreshold) {
      event = await createFarmEvent(runtime, rng, eventKey, eventTimestamp);
    } else {
      if (roll < requestThreshold) {
        event = createRequestEvent(runtime, rng, eventKey, eventTimestamp);
      }
      if (!event) {
        event = await createFarmEvent(
          runtime,
          rng,
          `${eventKey}:fallback`,
          eventTimestamp
        );
      }
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
    nodes: Array.isArray(options.nodes) ? options.nodes : [],
    nodeMode: Array.isArray(options.nodes) && options.nodes.length > 0,
    active: false,
    timer: null,
    tickIndex: 0,
    startedAt: null,
    regions: [],
    warehouses: [],
    warehouseNodes: [],
    farmNodes: [],
    ngoNodes: [],
    farmInventory: [],
    pendingRequests: [],
    requestLedger: new Map(),
    openRequests: new Map(),
    cropCache: new Map(),
    sentEvents: 0,
    stop: async (updateStatus) => {
      if (runtime.timer) {
        clearTimeout(runtime.timer);
        runtime.timer = null;
      }
      runtime.active = false;
      runtime.pendingRequests = [];
      runtime.requestLedger.clear();
      runtime.openRequests.clear();
      runtime.farmInventory = [];
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
    if (runtime.nodeMode) {
      // Classify nodes for node-driven simulation
      runtime.farmNodes = runtime.nodes.filter(
        (n) => (n.type || '').toLowerCase() === 'farm'
      );
      runtime.warehouseNodes = runtime.nodes.filter(
        (n) => (n.type || '').toLowerCase() === 'warehouse'
      );
      runtime.ngoNodes = runtime.nodes.filter(
        (n) => (n.type || '').toLowerCase() === 'ngo'
      );
    } else {
      runtime.regions = await loadRegions(runtime.regionFilter);
      runtime.warehouses = await loadWarehouses(runtime.regions);
    }
    runtime.startedAt = Date.now();
    runtime.tickIndex = 0;
    runtime.active = true;
    runtime.pendingRequests = [];
    runtime.requestLedger.clear();
    runtime.openRequests.clear();
    runtime.farmInventory = [];
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
    nodes: Array.isArray(input.nodes) ? input.nodes : [],
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
