# Quick Start Guide

## Prerequisites

- Node.js v18+ installed
- MongoDB running on localhost:27017
- Python 3.8+ (for ML service)

## 1. Install Dependencies

### Backend-A (Primary API)

```bash
cd Server
npm install
```

### Backend-B (ML Service)

```bash
cd ml
npm install
pip install -r requirements.txt
```

### Backend-C (Simulator)

```bash
cd mock-server
npm install
```

### Frontend

```bash
cd client
npm install
```

## 2. Start Services (Recommended Order)

### Terminal 1: Backend-C (Mock Server / Transport API)

```bash
cd mock-server
npm start
```

**Expected**: Server listening on port 5001

### Terminal 2: Backend-B (ML Service)

```bash
cd ml
npm start
```

**Expected**: ML inference service listening on port 3002

### Terminal 3: Backend-A (Primary API)

```bash
cd Server
npm run dev
```

**Expected**:

- Server is running at port 3001
- Socket.IO ready for real-time updates

### Terminal 4: Frontend (Next.js)

```bash
cd client
npm run dev
```

**Expected**: Frontend running at http://localhost:3000

## 3. Test the Implementation

### Option A: Quick API Test

```bash
node test-api.js
```

### Option B: Manual Tests

#### Test Backend-C Transport Endpoint

```bash
curl "http://localhost:5001/api/transport/time?fromLat=28.7041&fromLon=77.1025&toLat=19.0760&toLon=72.8777&start_iso=2026-02-01T10:00:00Z"
```

#### Test Backend-A History Endpoint

```bash
curl "http://localhost:3001/api/history/day?date=2026-02-01"
```

#### Test Backend-A Batch Listing

```bash
curl "http://localhost:3001/api/batches"
```

## 4. Create Sample Data

### Create a Node (Warehouse)

```bash
curl -X POST http://localhost:3001/api/v1/node/addNewNode \
  -H "Content-Type: application/json" \
  -d '{
    "type": "warehouse",
    "name": "Delhi Warehouse",
    "district": "Delhi",
    "location": {
      "type": "Point",
      "coordinates": [77.1025, 28.7041]
    },
    "capacity_kg": 10000
  }'
```

### Create a Batch

```bash
curl -X POST http://localhost:3001/api/batches \
  -H "Content-Type: application/json" \
  -d '{
    "foodType": "rice",
    "quantity_kg": 500,
    "originNodeId": "YOUR_NODE_ID_HERE",
    "shelf_life_hours": 720,
    "manufacture_date": "2026-02-01T00:00:00Z"
  }'
```

### Create a Shipment

```bash
curl -X POST http://localhost:3001/api/shipments \
  -H "Content-Type: application/json" \
  -d '{
    "fromNodeId": "WAREHOUSE_NODE_ID",
    "toNodeId": "NGO_NODE_ID",
    "items": [
      {"foodType": "rice", "quantity_kg": 200}
    ]
  }'
```

## 5. View the Frontend

1. Open http://localhost:3000
2. The map should load with existing nodes
3. Timeline controls should appear (once HistoryPlayer component is implemented)

## Troubleshooting

### MongoDB Connection Failed

```bash
# Check if MongoDB is running
mongosh --eval "db.version()"

# Start MongoDB (Windows)
net start MongoDB

# Start MongoDB (macOS/Linux)
brew services start mongodb-community
# OR
sudo systemctl start mongod
```

### Port Already in Use

```bash
# Find process on port 3001
netstat -ano | findstr :3001

# Kill process (Windows)
taskkill /PID <PID> /F

# Kill process (macOS/Linux)
lsof -ti:3001 | xargs kill -9
```

### ML Service Fails to Start

```bash
# Verify Python installation
python --version

# Install dependencies
cd ml
pip install -r requirements.txt

# Check if model artifacts exist
ls ml/artifacts/
```

### Frontend Build Errors

```bash
# Clear cache and reinstall
cd client
rm -rf node_modules .next
npm install
npm run dev
```

## Environment Setup

Create `.env` files in each service:

### Server/.env

```
PORT=3001
MONGODB_URI=mongodb://localhost:27017/food_supply_chain
BACKEND_C_URL=http://localhost:5001
ML_SERVICE_URL=http://localhost:3002
FRONTEND_URL=http://localhost:3000
```

### ml/.env

```
PORT=3002
ARTIFACTS_DIR=./artifacts
PYTHON_BIN=python3
ROUTE_SERVICE_URL=http://localhost:5001
```

### mock-server/.env

```
PORT=5001
MONGO_URI=mongodb://localhost:27017/mock_server
```

## Next Steps

1. **Implement Frontend Components**:
   - History Player with date controls
   - Socket.IO client integration
   - Live vs Replay mode toggle

2. **Create Demo Data Seed Script**:
   - 10 nodes (farms, warehouses, NGOs)
   - 50 batches across different food types
   - 20 requests (fulfilled and pending)
   - 30 shipments with various statuses

3. **Add Advanced Features**:
   - Auto-fulfill requests based on inventory
   - Spoilage detection cron job
   - ML-driven pre-positioning suggestions
   - Capacity constraint validation

## API Documentation

Full endpoint documentation is in [IMPLEMENTATION.md](./IMPLEMENTATION.md)

Key endpoints:

- `GET /api/history/day?date=YYYY-MM-DD` - Daily frame snapshot
- `POST /api/shipments` - Create shipment with batch splitting
- `GET /api/suggest/for-batch/:batchId` - ML allocation suggestions
- `GET /api/transport/time` - Deterministic ETA calculation

## Support

For issues or questions:

1. Check [IMPLEMENTATION.md](./IMPLEMENTATION.md) for detailed architecture
2. Review server logs in each terminal
3. Verify all services are running on correct ports
4. Ensure MongoDB connection is active
