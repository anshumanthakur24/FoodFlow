# Testing Instructions for Node CRUD Integration

## Prerequisites

1. MongoDB running locally or accessible connection string configured
2. Backend server (Server/) dependencies installed
3. Frontend (client/) dependencies installed

## Step 1: Start the Backend

```powershell
cd c:\Users\schha\ThreeService\Server
npm run dev
```

The backend should start on **port 4000**.

## Step 2: Start the Frontend

Open a new terminal:

```powershell
cd c:\Users\schha\ThreeService\client
npm run dev
```

The frontend should start on **port 3000**.

## Step 3: Test via Admin UI

1. Open http://localhost:3000/admin in your browser
2. Select a district from the dropdown (e.g., "Delhi" or "Mumbai")
3. The UI will fetch nodes from: `GET http://localhost:4000/api/v1/node/region/{district}`

### Test Adding a Node

1. Click "Add New Node" button
2. Fill in the form:
   - **Type**: Select from farm, warehouse, ngo, or processing
   - **Name**: e.g., "Green Valley Farm"
   - **Region ID**: e.g., "Delhi"
   - **Capacity (kg)**: e.g., 5000
   - **Contact**: e.g., "+91 98765 43210"
   - **Latitude**: e.g., 28.7041
   - **Longitude**: e.g., 77.1025
3. Click "Add Node"
4. The node should be created and appear in the table

### Test Deleting a Node

1. Find a node in the table
2. Click the red "Delete" button in the Actions column
3. Confirm the deletion
4. The node should be removed from the table

## Step 4: Test with curl (Backend Direct)

### Create a Node

```powershell
curl -X POST http://localhost:4000/api/v1/node/addNewNode `
  -H "Content-Type: application/json" `
  -d '{
    "type": "farm",
    "name": "Test Farm via curl",
    "regionId": "Delhi",
    "district": "Delhi",
    "location": {
      "type": "Point",
      "coordinates": [77.1025, 28.7041]
    },
    "capacity_kg": 3000,
    "contact": "+91 12345 67890"
  }'
```

Expected Response:

```json
{
  "statusCode": 201,
  "data": {
    "_id": "65abc123...",
    "nodeId": "generated-id",
    "type": "farm",
    "name": "Test Farm via curl",
    "regionId": "Delhi",
    "district": "Delhi",
    "location": {
      "type": "Point",
      "coordinates": [77.1025, 28.7041]
    },
    "capacity_kg": 3000,
    "contact": "+91 12345 67890"
  },
  "message": "Node created successfully.",
  "success": true
}
```

### Get Nodes by Region

```powershell
curl http://localhost:4000/api/v1/node/region/Delhi?limit=100
```

### Delete a Node

```powershell
# Replace <NODE_ID> with the actual MongoDB _id from the response
curl -X DELETE http://localhost:4000/api/v1/node/deleteNode/<NODE_ID>
```

## Data Format Notes

### Backend Expects (POST /addNewNode):

```json
{
  "type": "farm | warehouse | ngo | processing",
  "name": "string",
  "regionId": "string",
  "district": "string",
  "location": {
    "type": "Point",
    "coordinates": [longitude, latitude]  // Note: longitude FIRST!
  },
  "capacity_kg": number (optional, default 0),
  "contact": "string" (optional, default null)
}
```

### Backend Returns:

- MongoDB document with `_id` field
- Frontend maps `_id` → `id` for display

## Common Issues

### CORS Error

**Problem**: "CORS policy: No 'Access-Control-Allow-Origin' header"

**Solution**: Check Server/src/app.js - CORS middleware should be configured:

```javascript
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  })
);
```

### 404 Not Found

**Problem**: "Cannot POST /api/v1/node/addNewNode"

**Solution**: Verify routes are mounted correctly in Server/src/app.js:

```javascript
app.use("/api/v1/node", nodeRouter);
```

### Validation Error (400)

**Problem**: "Please provide all required fields"

**Solution**: Ensure your request includes:

- type (must be one of: farm, warehouse, ngo, processing)
- name
- regionId
- district
- location (GeoJSON format with type="Point" and coordinates=[lng, lat])

### MongoDB Connection Error

**Problem**: "Failed to create node" / MongoError

**Solution**: Check if MongoDB is running:

```powershell
# If using MongoDB installed locally
mongod --dbpath=c:\data\db

# Or check if MongoDB service is running
Get-Service MongoDB
```

## Verify in MongoDB

```powershell
# Connect to MongoDB
mongosh

# Switch to your database
use your_database_name

# List all nodes
db.nodes.find().pretty()

# Find nodes in a specific region
db.nodes.find({ regionId: "Delhi" }).pretty()

# Count nodes
db.nodes.countDocuments()
```

## Expected Behavior

1. **Load District**: Fetches nodes from backend, displays in table with stats
2. **Add Node**: POSTs to backend, receives created node with MongoDB \_id, updates UI
3. **Delete Node**: DELETEs via backend, removes from MongoDB, updates UI
4. **Loading States**: Shows spinner while fetching
5. **Error Handling**: Displays error messages if API calls fail

## Success Criteria

✅ Can select district and see nodes (or "No nodes found" if empty)
✅ Can add new node and it appears in table immediately
✅ New node persists after page refresh
✅ Can delete node and it disappears from table
✅ Deleted node does not reappear after page refresh
✅ Stats cards (Farms, Warehouses, NGOs, Processing) update correctly
✅ Error messages appear if backend is down or validation fails
