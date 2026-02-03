#!/usr/bin/env node

/**
 * Quick test script for Backend-A API endpoints
 * Verifies that routes are properly mounted and responding
 */

const axios = require("axios");

const BASE_URL = process.env.API_URL || "http://localhost:3001";
const MOCK_URL = process.env.MOCK_URL || "http://localhost:5001";

async function testEndpoint(name, method, url, data = null) {
  try {
    const config = { method, url, ...(data && { data }) };
    const response = await axios(config);
    console.log(`✅ ${name}: ${response.status} ${response.statusText}`);
    return true;
  } catch (error) {
    if (error.response) {
      console.log(
        `⚠️  ${name}: ${error.response.status} - ${error.response.data.message || error.message}`,
      );
    } else if (error.code === "ECONNREFUSED") {
      console.log(`❌ ${name}: Server not running at ${url}`);
    } else {
      console.log(`❌ ${name}: ${error.message}`);
    }
    return false;
  }
}

async function runTests() {
  console.log("🧪 Testing Backend-A API Endpoints\n");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Mock URL: ${MOCK_URL}\n`);

  let passed = 0;
  let total = 0;

  // Test health/basic endpoints
  total++;
  if (
    await testEndpoint(
      "GET Nodes",
      "GET",
      `${BASE_URL}/api/v1/node/getAllNodes`,
    )
  )
    passed++;

  total++;
  if (await testEndpoint("GET Batches", "GET", `${BASE_URL}/api/batches`))
    passed++;

  total++;
  if (
    await testEndpoint(
      "GET Batch Inventory Summary",
      "GET",
      `${BASE_URL}/api/batches/inventory/summary`,
    )
  )
    passed++;

  total++;
  if (await testEndpoint("GET Shipments", "GET", `${BASE_URL}/api/shipments`))
    passed++;

  total++;
  if (
    await testEndpoint(
      "GET History Day (should fail without date)",
      "GET",
      `${BASE_URL}/api/history/day`,
    )
  )
    passed++;

  total++;
  if (
    await testEndpoint(
      "GET History Day 2026-02-01",
      "GET",
      `${BASE_URL}/api/history/day?date=2026-02-01`,
    )
  )
    passed++;

  console.log("\n🧪 Testing Backend-C API Endpoints\n");

  total++;
  if (
    await testEndpoint(
      "GET Transport Time",
      "GET",
      `${MOCK_URL}/api/transport/time?fromLat=28.7041&fromLon=77.1025&toLat=19.0760&toLon=72.8777&start_iso=2026-02-01T10:00:00Z`,
    )
  )
    passed++;

  total++;
  if (
    await testEndpoint(
      "GET Weather",
      "GET",
      `${MOCK_URL}/api/weather?regionId=Delhi&date=2026-02-01`,
    )
  )
    passed++;

  console.log(
    `\n📊 Results: ${passed}/${total} tests passed (${Math.round((passed / total) * 100)}%)`,
  );

  if (passed === total) {
    console.log("✨ All tests passed!");
    process.exit(0);
  } else {
    console.log("⚠️  Some tests failed. Check server logs.");
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("❌ Test suite error:", error.message);
  process.exit(1);
});
