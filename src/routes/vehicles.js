const express = require('express');
const fs = require('fs');
const path = require('path');

const VEHICLES_PATH = path.join(__dirname, '..', '..', 'data', 'vehicles.json');

const router = express.Router();

router.get('/', (req, res) => {
  if (!fs.existsSync(VEHICLES_PATH)) {
    return res.status(500).json({
      error: 'vehicles.json not found. Run `npm run discover` first.',
    });
  }

  const vehicles = JSON.parse(fs.readFileSync(VEHICLES_PATH, 'utf8'));
  res.json(vehicles);
});

module.exports = router;
