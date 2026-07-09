const path = require('path');
const express = require('express');

const vehiclesRouter = require('./routes/vehicles');
const customizationsRouter = require('./routes/customizations');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/customizations', customizationsRouter);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
