#!/usr/bin/env python3
"""
infer_seasons.py

Usage:
  python infer_seasons.py --mongo-uri mongodb://localhost:27017 --db agriculture --input_coll crops_history --out seasons.json --min_coverage 0.75 --per_district False

What it does:
 - Reads rows from MongoDB collection (crops_history)
 - Groups by (state, crop) or (state, crop, district) if --per_district
 - If 'month' data present, infers harvest month window by finding a contiguous block that covers >= min_coverage of production
 - Otherwise uses season labels (if present) and maps them to month ranges using SEASON_DEFAULTS
 - If neither present, falls back to DEFAULT_CROP_SEASON_HINTS (very low confidence)
 - Writes 'crop_seasons' collection in same DB and writes JSON file

Output structure example (one entry):
{
  "state": "Andhra Pradesh",
  "crop": "Arhar/Tur",
  "district": null,                  # present only if per_district True
  "harvest_windows": [
     { "label": "inferred", "harvest_start": 10, "harvest_end": 12, "coverage": 0.82, "method": "inferred_months" }
  ],
  "sowing_windows": [
     { "sowing_start": 7, "sowing_end": 9, "growth_months": 3 }
  ],
  "confidence": "high",
  "notes": "..."
}

"""
import argparse, json
from collections import defaultdict
from pymongo import MongoClient
from tqdm import tqdm
import math

# ---------- Configs (tweak as needed) ----------
SEASON_DEFAULTS = {
    'kharif': {'harvest': [9, 10]},   # typical harvest months (Sept-Oct)
    'rabi':   {'harvest': [2, 4]},    # Feb-Apr (wrap handled)
    'zaid':   {'harvest': [5, 6]},    # May-Jun
    'summer': {'harvest': [5, 6]},
    'autumn': {'harvest': [9, 11]},
    'winter': {'harvest': [12, 2]},   # wrap: Dec -> Feb
}

# default growth months per crop (approx months between sowing and harvest)
DEFAULT_GROWTH_MONTHS = {
    'Wheat': 5, 'Rice': 4, 'Maize': 3, 'Arhar/Tur': 4, 'Pulses': 3, 'Arecanut': 12,
    # add more crops as you like; fallback default used below
}
DEFAULT_GROWTH_MONTHS_FALLBACK = 4

# ---------- Helpers ----------
def contiguous_block_covering(dist, min_cov=0.75):
    """
    dist: list of 12 (months 1..12) numbers (nonnegative), aggregated production per month.
    Return (start_month, end_month, coverage_fraction). If no production -> (None,None,0).
    start_month and end_month in 1..12. end may be < start for wrap-around (e.g., 10..3).
    Algorithm: find shortest contiguous block (including wrap) with coverage >= min_cov.
    """
    total = sum(dist)
    if total <= 0:
        return None, None, 0.0
    n = 12
    arr = dist + dist  # double for wrap
    # try windows from smallest length to full year
    for L in range(1, n+1):
        for start in range(0, n):
            s = sum(arr[start:start+L])
            if s / total >= min_cov:
                start_m = (start % n) + 1
                end_m = ((start + L - 1) % n) + 1
                return int(start_m), int(end_m), float(s/total)
    # fallback: return whole year
    return 1, 12, 1.0

def shift_month(month, delta):
    # month 1..12, delta can be negative
    return ((month - 1 + delta) % 12) + 1

def month_in_window(month, start, end):
    if start is None or end is None:
        return False
    if start <= end:
        return start <= month <= end
    else:
        # wrap-around
        return month >= start or month <= end

# ---------- Main inference ----------
def infer_seasons_from_mongo(mongo_uri, dbname, input_coll='crops_history', per_district=False, min_coverage=0.75, out_file='seasons.json'):
    client = MongoClient(mongo_uri)
    db = client[dbname]
    coll = db[input_coll]

    # Read all docs but project only required fields to reduce memory
    projection = {'state':1, 'crop':1, 'district':1, 'year':1, 'month':1, 'season':1, 'production_tonnes':1, 'area_hectare':1}
    cursor = coll.find({}, projection)

    # Group rows by key
    groups = defaultdict(list)
    for doc in cursor:
        state = doc.get('state') or 'UNKNOWN'
        crop = doc.get('crop') or 'UNKNOWN'
        district = doc.get('district') if per_district else None
        key = (state.strip(), crop.strip(), district.strip() if district else None)
        groups[key].append(doc)

    print(f"Found {len(groups)} groups (per_district={per_district})")

    results = []
    for key, rows in tqdm(groups.items(), desc='Groups'):
        state, crop, district = key
        # check if any row has month info
        has_month = any(('month' in r and r.get('month') is not None) for r in rows)
        # check if season labels present
        season_labels = [r.get('season') for r in rows if r.get('season')]
        season_labels = [str(s).strip().lower() for s in season_labels if s]
        # aggregate by month if months present
        entry = {
            'state': state,
            'crop': crop,
            'district': district,
            'harvest_windows': [],
            'sowing_windows': [],
            'confidence': None,
            'notes': ''
        }

        if has_month:
            # build per-month sums (1..12)
            monthly = [0.0]*12
            for r in rows:
                m = r.get('month')
                p = r.get('production_tonnes') or 0.0
                if m is None:
                    # can't use this row for month-based counts
                    continue
                try:
                    mi = int(m)
                    if 1 <= mi <= 12:
                        monthly[mi-1] += float(p)
                except Exception:
                    continue
            # infer contiguous harvest
            hstart, hend, cov = contiguous_block_covering(monthly, min_cov=min_coverage)
            entry['harvest_windows'].append({'label':'inferred_from_months', 'harvest_start': hstart, 'harvest_end': hend, 'coverage': cov})
            # compute sowing by shift using growth months map
            gm = DEFAULT_GROWTH_MONTHS.get(crop, DEFAULT_GROWTH_MONTHS_FALLBACK)
            sow_s = shift_month(hstart, -gm) if hstart is not None else None
            sow_e = shift_month(hend, -gm) if hend is not None else None
            entry['sowing_windows'].append({'sowing_start': sow_s, 'sowing_end': sow_e, 'growth_months': gm})
            entry['confidence'] = 'high'
            entry['notes'] = f'inferred from month data; coverage={cov:.2f}'
        elif season_labels:
            # Use season labels mapping
            # Count occurrences per season token
            cnt = {}
            for s in season_labels:
                # normalize token: look for known tokens inside label
                s_low = s.lower()
                matched = None
                for tok in SEASON_DEFAULTS.keys():
                    if tok in s_low:
                        matched = tok
                        break
                if matched is None:
                    # fallback: if 'rabi' present
                    matched = s_low
                cnt[matched] = cnt.get(matched, 0) + 1
            # Use most common season(s)
            sorted_seasons = sorted(cnt.items(), key=lambda x: x[1], reverse=True)
            total_counts = sum(cnt.values())
            # add windows for top seasons
            for season_token, cval in sorted_seasons:
                rng = SEASON_DEFAULTS.get(season_token)
                if rng:
                    hstart, hend = rng['harvest'][0], rng['harvest'][1]
                    entry['harvest_windows'].append({'label': season_token, 'harvest_start': int(hstart), 'harvest_end': int(hend), 'coverage_est_count': cval, 'method':'from_season_label'})
                    gm = DEFAULT_GROWTH_MONTHS.get(crop, DEFAULT_GROWTH_MONTHS_FALLBACK)
                    entry['sowing_windows'].append({'sowing_start': shift_month(hstart, -gm), 'sowing_end': shift_month(hend, -gm), 'growth_months': gm})
            entry['confidence'] = 'medium'
            entry['notes'] = f'used season labels frequency (top counts: {sorted_seasons[:3]})'
        else:
            # no month or season label — fallback to default hints (very low confidence)
            hint = None
            for tok, val in SEASON_DEFAULTS.items():
                # if crop name contains token? try to pick nothing - fallback to first default if available
                pass
            # fallback: choose default mapping from DEFAULT_GROWTH_MONTHS or SEASON_DEFAULTS first entry
            # pick SEASON_DEFAULTS first key
            any_key = next(iter(SEASON_DEFAULTS))
            rng = SEASON_DEFAULTS.get(any_key)
            hstart, hend = rng['harvest'][0], rng['harvest'][1]
            entry['harvest_windows'].append({'label': 'fallback_generic', 'harvest_start': int(hstart), 'harvest_end': int(hend), 'coverage_est_count': 0, 'method':'fallback_defaults'})
            gm = DEFAULT_GROWTH_MONTHS.get(crop, DEFAULT_GROWTH_MONTHS_FALLBACK)
            entry['sowing_windows'].append({'sowing_start': shift_month(hstart, -gm), 'sowing_end': shift_month(hend, -gm), 'growth_months': gm})
            entry['confidence'] = 'low'
            entry['notes'] = 'no month or season labels found; used fallback defaults'

        results.append(entry)

    # Write results back to MongoDB and JSON
    out_coll = db['crop_seasons']
    # optional: drop existing? we will upsert by (state,crop,district)
    for r in results:
        query = {'state': r['state'], 'crop': r['crop']}
        if per_district:
            query['district'] = r['district']
        out_coll.update_one(query, {'$set': r}, upsert=True)

    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(results)} season records to collection 'crop_seasons' and file '{out_file}'")
    client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mongo-uri', default='mongodb://localhost:27017')
    parser.add_argument('--db', default='agriculture')
    parser.add_argument('--input_coll', default='crops_history')
    parser.add_argument('--per_district', action='store_true', help='Infer seasons per district (state,crop,district) instead of per state,crop')
    parser.add_argument('--min_coverage', type=float, default=0.75)
    parser.add_argument('--out', default='seasons.json')
    args = parser.parse_args()

    infer_seasons_from_mongo(args.mongo_uri, args.db, args.input_coll, per_district=args.per_district, min_coverage=args.min_coverage, out_file=args.out)
