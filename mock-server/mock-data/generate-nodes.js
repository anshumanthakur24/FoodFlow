#!/usr/bin/env node
/*
  Generate Node documents for MongoDB.

  - Reads a CSV of (state,district) pairs (defaults to ../../ml/data/census2011.csv)
  - For each district, fetches a bounding box via OSM Nominatim (free), caches results locally
  - Samples 6-10 random points per district (ensures >=3 farms and >=3 warehouses)
  - Writes a JSON array suitable for mongoimport or insertMany

  Usage examples (PowerShell):

  # From CSV (filter by states)
  node generate-nodes.js --states Maharashtra,Gujarat --output nodes.maha-guj.json
  # From CSV (offline bbox fallback)
  node generate-nodes.js --input ..\\..\\ml\\data\\census2011.csv --offline --output nodes.offline.json
  # From Mongo (agriculte.crops_history, using distinct state/district)
  node generate-nodes.js --from-mongo --mongo-uri "mongodb://127.0.0.1:27017/agriculte" --mongo-coll crops_history --output nodes.mongo.json

  Notes:
  - Respect Nominatim usage policy. This script throttles requests (1 req/sec) and caches to geocode-cache.json.
  - If geocoding fails or --offline is set, falls back to India-wide bbox sampling with deterministic seeding.
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_INPUT = path.resolve(
  __dirname,
  '..',
  '..',
  'ml',
  'data',
  'census2011.csv'
);
const DEFAULT_OUTPUT = path.resolve(__dirname, 'nodes.generated.json');
const CACHE_FILE = path.resolve(__dirname, 'geocode-cache.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    states: null,
    min: 6,
    max: 10,
    offline: false,
    fromMongo: false,
    mongoUri: null,
    mongoDb: null,
    mongoColl: 'crops_history',
    stateField: 'state',
    districtField: 'district',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input' && args[i + 1])
      out.input = path.resolve(process.cwd(), args[++i]);
    else if (a === '--output' && args[i + 1])
      out.output = path.resolve(process.cwd(), args[++i]);
    else if (a === '--states' && args[i + 1])
      out.states = args[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === '--min' && args[i + 1])
      out.min = Math.max(6, Number(args[++i]) || 6);
    else if (a === '--max' && args[i + 1])
      out.max = Math.max(out.min, Number(args[++i]) || out.min);
    else if (a === '--offline') out.offline = true;
    else if (a === '--from-mongo') out.fromMongo = true;
    else if (a === '--mongo-uri' && args[i + 1]) out.mongoUri = args[++i];
    else if (a === '--mongo-db' && args[i + 1]) out.mongoDb = args[++i];
    else if (a === '--mongo-coll' && args[i + 1]) out.mongoColl = args[++i];
    else if (a === '--state-field' && args[i + 1]) out.stateField = args[++i];
    else if (a === '--district-field' && args[i + 1])
      out.districtField = args[++i];
  }
  // ensure min/max support at least 3 per type
  if (out.min < 6) out.min = 6;
  if (out.max < out.min) out.max = out.min;
  return out;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function seededRng(seed) {
  const h = crypto.createHash('sha1').update(String(seed)).digest();
  let i = 0;
  return () => {
    // xorshift-like from hash bytes
    const v =
      (h[i % h.length] ^ h[(i + 7) % h.length] ^ h[(i + 13) % h.length]) / 255;
    i += 1;
    return v;
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCsvPairs(filePath) {
  const csv = fs.readFileSync(filePath, 'utf8');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idxState = header.indexOf('state');
  const idxDistrict = header.indexOf('district');
  if (idxState < 0 || idxDistrict < 0) {
    throw new Error(
      `CSV must have state,district columns. Headers found: ${header.join(',')}`
    );
  }
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < Math.max(idxState, idxDistrict) + 1) continue;
    const state = cols[idxState].replace(/^\"|\"$/g, '').trim();
    const district = cols[idxDistrict].replace(/^\"|\"$/g, '').trim();
    if (!state || !district) continue;
    const key = `${state}::${district}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ state, district });
  }
  return rows;
}

async function readMongoPairs(options) {
  // Dynamically require MongoDB driver
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (e) {
    try {
      ({ MongoClient } = await import('mongodb'));
    } catch (err) {
      throw new Error(
        'The "mongodb" package is required. Install with: npm i mongodb'
      );
    }
  }
  const uri = options.mongoUri;
  if (!uri) throw new Error('--mongo-uri is required when using --from-mongo');
  const dbName =
    options.mongoDb ||
    uri.replace(/^.*\/(?!.*\/)/, '').replace(/\?.*$/, '') ||
    undefined;
  if (!dbName || dbName.toLowerCase().startsWith('mongodb')) {
    throw new Error(
      'Could not infer database name from URI. Provide --mongo-db explicitly.'
    );
  }
  const collName = options.mongoColl || 'crops_history';
  const stateField = options.stateField || 'state';
  const districtField = options.districtField || 'district';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const coll = client.db(dbName).collection(collName);
    const pipeline = [
      {
        $match: { [stateField]: { $ne: null }, [districtField]: { $ne: null } },
      },
      {
        $group: {
          _id: { state: `$${stateField}`, district: `$${districtField}` },
        },
      },
      { $project: { _id: 0, state: '$_id.state', district: '$_id.district' } },
      { $sort: { state: 1, district: 1 } },
    ];
    const docs = await coll
      .aggregate(pipeline, { allowDiskUse: true })
      .toArray();
    const rows = [];
    const seen = new Set();
    for (const d of docs) {
      const state = (d.state || '').toString().trim();
      const district = (d.district || '').toString().trim();
      if (!state || !district) continue;
      const key = `${state}::${district}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ state, district });
    }
    return rows;
  } finally {
    await client.close().catch(() => {});
  }
}

function loadCache() {
  try {
    const txt = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(txt);
  } catch (_) {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function fetchJson(url) {
  let f = typeof fetch !== 'undefined' ? fetch : null;
  if (!f) {
    try {
      f = (await import('node-fetch')).default;
    } catch (_) {
      throw new Error('fetch is not available and node-fetch is not installed');
    }
  }
  const res = await f(url, {
    headers: {
      'User-Agent': 'arcanix-mock-node-generator/1.0 (+https://github.com/)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function geocodeDistrict(cache, state, district, offline) {
  const key = `${state}|${district}`;
  if (cache[key]) return cache[key];
  if (offline) return null;
  const q = encodeURIComponent(`${district}, ${state}, India`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`;
  try {
    const data = await fetchJson(url);
    await delay(1100); // be gentle with Nominatim
    if (Array.isArray(data) && data.length) {
      const d = data[0];
      const bbox = d.boundingbox || null; // [south, north, west, east]
      const lat = parseFloat(d.lat);
      const lon = parseFloat(d.lon);
      if (bbox && bbox.length === 4) {
        const south = parseFloat(bbox[0]);
        const north = parseFloat(bbox[1]);
        const west = parseFloat(bbox[2]);
        const east = parseFloat(bbox[3]);
        cache[key] = {
          bbox: { south, north, west, east },
          center: { lat, lon },
        };
        return cache[key];
      }
      cache[key] = { bbox: null, center: { lat, lon } };
      return cache[key];
    }
  } catch (err) {
    // fallthrough to null
  }
  return null;
}

function indiaFallbackBBox(state, district) {
  // India approximate bbox
  const IN = { south: 6.5, north: 35.5, west: 68.0, east: 97.5 };
  // Slightly tighten by seeding on state/district so distinct areas per district
  const rng = seededRng(`${state}|${district}`);
  const latMargin = 2 + rng() * 4; // degrees
  const lonMargin = 2 + rng() * 4;
  const south = IN.south + latMargin * rng();
  const north = IN.north - latMargin * rng();
  const west = IN.west + lonMargin * rng();
  const east = IN.east - lonMargin * rng();
  return { south, north, west, east };
}

function samplePoint(bbox, rng) {
  const lon = bbox.west + (bbox.east - bbox.west) * rng();
  const lat = bbox.south + (bbox.north - bbox.south) * rng();
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

function uniqueNodeId(state, district, type, index) {
  const base = `${state}-${district}-${type}-${index}-${Date.now()}-${Math.random()}`;
  const short = crypto
    .createHash('sha1')
    .update(base)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  return `${type === 'warehouse' ? 'WH' : 'FARM'}-${slugify(
    district
  ).toUpperCase()}-${short}`;
}

function buildNodeDoc(point, state, district, type, idx) {
  const nodeId = uniqueNodeId(state, district, type, idx);
  const name = `${type === 'warehouse' ? 'Warehouse' : 'Farm'} ${district} ${
    idx + 1
  }`;
  const regionId = `${slugify(state)}:${slugify(district)}`;
  const capacity_kg =
    type === 'warehouse'
      ? Math.round(10000 + 40000 * Math.random())
      : Math.round(1000 + 4000 * Math.random());
  return {
    nodeId,
    type,
    name,
    regionId,
    district,
    state,
    location: { type: 'Point', coordinates: [point.lon, point.lat] },
    capacity_kg,
  };
}

async function main() {
  const opts = parseArgs();
  let allPairs = [];
  if (opts.fromMongo) {
    try {
      allPairs = await readMongoPairs(opts);
    } catch (err) {
      console.error('Mongo load failed:', err.message);
      process.exit(1);
    }
  } else {
    if (!fs.existsSync(opts.input)) {
      console.error(`Input CSV not found: ${opts.input}`);
      process.exit(1);
    }
    allPairs = readCsvPairs(opts.input);
  }
  const pairs = opts.states
    ? allPairs.filter((r) => opts.states.includes(r.state))
    : allPairs;
  if (!pairs.length) {
    console.error('No (state,district) pairs found after filtering.');
    process.exit(1);
  }
  const cache = loadCache();
  const results = [];
  for (const { state, district } of pairs) {
    const geo = await geocodeDistrict(cache, state, district, opts.offline);
    const bbox =
      geo && geo.bbox ? geo.bbox : indiaFallbackBBox(state, district);
    const rng = seededRng(`${state}|${district}`);
    // ensure at least 6 so we can have >=3 each type
    const count = Math.max(
      opts.min,
      Math.min(opts.max, 6 + Math.floor(rng() * (opts.max - 5)))
    );
    const minPerType = 3;
    let farms = Math.max(minPerType, Math.floor(count / 2));
    let warehouses = Math.max(minPerType, count - farms);
    // Adjust if we exceeded count due to minimums
    if (farms + warehouses > count) {
      const excess = farms + warehouses - count;
      if (warehouses > farms) warehouses -= excess;
      else farms -= excess;
    }
    // First guarantee minPerType, then fill remaining randomly
    const nodePoints = Array.from({ length: count }, () =>
      samplePoint(bbox, rng)
    );
    const types = [];
    for (let i = 0; i < farms; i++) types.push('farm');
    for (let i = 0; i < warehouses; i++) types.push('warehouse');
    // If still fewer than count due to rounding, add random types
    while (types.length < count) types.push(rng() < 0.5 ? 'farm' : 'warehouse');
    // Shuffle types with seeded rng
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    nodePoints.forEach((pt, idx) => {
      const type = types[idx] || (rng() < 0.5 ? 'farm' : 'warehouse');
      results.push(buildNodeDoc(pt, state, district, type, idx));
    });
  }
  saveCache(cache);
  fs.writeFileSync(opts.output, JSON.stringify(results, null, 2));
  console.log(`\nGenerated ${results.length} node documents`);
  console.log(`Output: ${opts.output}`);
  console.log('\nImport into MongoDB with:');
  console.log(
    'mongoimport --uri "mongodb://127.0.0.1:27017/arcanix" --collection nodes --jsonArray --file "' +
      opts.output +
      '"'
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
