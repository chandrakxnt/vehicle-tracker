const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

app.use(cors());
app.use(express.json());

// Function to snap coordinates to roads using OSRM
async function snapToRoads(coordinates) {
  try {
    console.log('🛣️ Snapping coordinates to roads...');

    const maxCoords = 100;
    const coords = coordinates.length > maxCoords
      ? coordinates.filter((_, index) => index % Math.ceil(coordinates.length / maxCoords) === 0)
      : coordinates;

    const coordString = coords
      .map(coord => `${coord.lng},${coord.lat}`)
      .join(';');

    const response = await fetch(
      `https://router.project-osrm.org/match/v1/driving/${coordString}?overview=full&geometries=geojson&steps=false&annotations=false&radiuses=${coords.map(() => '50').join(';')}`
    );

    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.matchings && data.matchings.length > 0) {
      const snappedCoords = data.matchings[0].geometry.coordinates.map((coord, index) => ({
        lat: coord[1],
        lng: coord[0],
        timestamp: coordinates[Math.floor(index * coordinates.length / data.matchings[0].geometry.coordinates.length)]?.timestamp
      }));

      console.log(`✅ Successfully snapped ${snappedCoords.length} coordinates`);
      return snappedCoords;
    }

    console.log('⚠️ No matching roads found, returning original coordinates');
    return coordinates;

  } catch (error) {
    console.error('❌ Road snapping failed:', error.message);
    return coordinates;
  }
}

function smoothCoordinates(coordinates, factor = 0.3) {
  if (coordinates.length < 3) return coordinates;

  const smoothed = [coordinates[0]];

  for (let i = 1; i < coordinates.length - 1; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    const next = coordinates[i + 1];

    const smoothedLat = curr.lat + factor * (prev.lat + next.lat - 2 * curr.lat);
    const smoothedLng = curr.lng + factor * (prev.lng + next.lng - 2 * curr.lng);

    smoothed.push({
      lat: smoothedLat,
      lng: smoothedLng,
      timestamp: curr.timestamp
    });
  }

  smoothed.push(coordinates[coordinates.length - 1]);
  return smoothed;
}

function filterGPSNoise(coordinates, maxSpeedKmh = 200) {
  if (coordinates.length < 2) return coordinates;

  const filtered = [coordinates[0]];

  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];

    const distance = calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);

    const timeDiff = curr.timestamp ?
      (new Date(curr.timestamp) - new Date(prev.timestamp)) / 1000 : 1;

    const speedKmh = timeDiff > 0 ? (distance / 1000) / (timeDiff / 3600) : 0;

    if (speedKmh <= maxSpeedKmh) {
      filtered.push(curr);
    } else {
      console.log(`⚠️ Filtered out point with speed: ${speedKmh.toFixed(2)} km/h`);
    }
  }

  return filtered;
}

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

app.get('/api/route/:date', async (req, res) => {
  const { date } = req.params;
  const { snap = 'false', smooth = 'false' } = req.query;

  const filePath = path.join(__dirname, 'routes', `${date}.json`);

  fs.readFile(filePath, 'utf8', async (err, data) => {
    if (err) {
      console.error('❌ File not found or error reading:', err.message);
      return res.status(500).json({ error: 'Failed to read route data file.' });
    }

    try {
      const json = JSON.parse(data);
      let coordinates = json.coordinates;

      if (!Array.isArray(coordinates)) {
        return res.status(400).json({ error: 'Invalid coordinates format' });
      }

      coordinates = coordinates.filter(
        p => p &&
          typeof p.lat === 'number' &&
          typeof p.lng === 'number' &&
          !isNaN(p.lat) &&
          !isNaN(p.lng)
      );

      if (coordinates.length === 0) {
        return res.json({ coordinates: [] });
      }

      console.log(`📍 Processing ${coordinates.length} coordinates for ${date}`);

      coordinates = filterGPSNoise(coordinates);
      console.log(`🔍 After noise filtering: ${coordinates.length} coordinates`);

      if (smooth === 'true') {
        coordinates = smoothCoordinates(coordinates);
        console.log(`🔄 Applied coordinate smoothing`);
      }

      if (snap === 'true') {
        coordinates = await snapToRoads(coordinates);
        console.log(`🛣️ Applied road snapping`);
      }

      res.json({
        coordinates,
        metadata: {
          originalCount: json.coordinates.length,
          processedCount: coordinates.length,
          roadSnapped: snap === 'true',
          smoothed: smooth === 'true'
        }
      });

    } catch (parseError) {
      console.error('❌ JSON Parse Error:', parseError.message);
      res.status(500).json({ error: 'Invalid JSON format in file.' });
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Use dynamic port for hosting platforms like Render/Vercel
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});
