const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.TEST_SERVER_PORT || 4000;

app.use(bodyParser.json({ limit: '2mb' }));

const received = {
  farm: [],
  shipment: [],
  ngo: [],
};

function registerEvent(type, payload) {
  const record = {
    timestamp: new Date().toISOString(),
    payload,
  };
  received[type].push(record);
  console.log(`[${type}]`, JSON.stringify(record));
}

app.post('/api/farm-events', (req, res) => {
  registerEvent('farm', req.body);
  res.status(202).json({ status: 'accepted', type: 'farm' });
});

app.post('/api/shipments', (req, res) => {
  registerEvent('shipment', req.body);
  res.status(202).json({ status: 'accepted', type: 'shipment' });
});

app.post('/api/requests', (req, res) => {
  registerEvent('ngo', req.body);
  res.status(202).json({ status: 'accepted', type: 'ngo' });
});

app.get('/api/received', (req, res) => {
  res.json(received);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(port, () => {
  console.log(`Test server listening on ${port}`);
});
