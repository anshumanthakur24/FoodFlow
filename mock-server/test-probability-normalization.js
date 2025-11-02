// Test script to verify probability normalization
const { normalizeProbabilities } = require('./src/services/scenarioManager');

console.log('Testing probability normalization...\n');

const tests = [
  { input: { farm: 0.7, request: 0.3 }, desc: 'Normal values (0.7, 0.3)' },
  { input: { farm: 0.9, request: 0.3 }, desc: 'Values sum > 1 (0.9, 0.3)' },
  { input: { farm: 0, request: 0 }, desc: 'Both zero (0, 0)' },
  { input: { farm: -0.5, request: -0.2 }, desc: 'Both negative (-0.5, -0.2)' },
  { input: { farm: 1.0, request: 0 }, desc: 'Only farm (1.0, 0)' },
  { input: { farm: 0, request: 1.0 }, desc: 'Only request (0, 1.0)' },
  { input: { farm: 0.01, request: 0.99 }, desc: 'Minimum farm (0.01, 0.99)' },
  { input: null, desc: 'Null input' },
  { input: {}, desc: 'Empty object' },
  { input: { farm: 'invalid', request: 'values' }, desc: 'Invalid strings' },
];

tests.forEach(({ input, desc }) => {
  try {
    const result = normalizeProbabilities(input);
    const sum = result.farm + result.request;
    const valid =
      Math.abs(sum - 1.0) < 0.0001 &&
      result.farm >= 0.01 &&
      result.request >= 0.01;
    console.log(`${valid ? '✓' : '✗'} ${desc}`);
    console.log(`   Input: ${JSON.stringify(input)}`);
    console.log(
      `   Output: farm=${result.farm.toFixed(
        3
      )}, request=${result.request.toFixed(3)}, sum=${sum.toFixed(3)}`
    );
    console.log('');
  } catch (err) {
    console.log(`✗ ${desc}`);
    console.log(`   Error: ${err.message}`);
    console.log('');
  }
});

console.log('Test complete!');
