
import React, { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";


const carIcon = new L.Icon({
  iconUrl: "/car.png", 
  iconSize: [35, 35],
  iconAnchor: [17, 17],
});

function ChangeView({ center }) {
  const map = useMap();
  map.setView(center, map.getZoom());
  return null;
}

// Map matching function using OSRM (Open Source Routing Machine)
async function snapToRoad(coordinates) {
  try {
    // Convert coordinates to OSRM format (lng,lat)
    const coordString = coordinates
      .map(coord => `${coord.lng},${coord.lat}`)
      .join(';');
    
    // OSRM Map Matching API
    const response = await fetch(
      `https://router.project-osrm.org/match/v1/driving/${coordString}?overview=full&geometries=geojson&steps=false&annotations=false`
    );
    
    if (!response.ok) {
      throw new Error('Map matching failed');
    }
    
    const data = await response.json();
    
    if (data.matchings && data.matchings.length > 0) {
      // Extract snapped coordinates from geometry
      const snappedCoords = data.matchings[0].geometry.coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0]
      }));
      return snappedCoords;
    }
    
    return coordinates; // Return original if matching fails
  } catch (error) {
    console.error('❌ Map matching error:', error);
    return coordinates; // Return original coordinates as fallback
  }
}

// Alternative: Simple road snapping using Overpass API
async function snapToNearestRoad(lat, lng) {
  try {
    const radius = 50; // meters
    const query = `
      [out:json][timeout:25];
      (
        way["highway"](around:${radius},${lat},${lng});
      );
      out geom;
    `;
    
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    
    if (!response.ok) throw new Error('Overpass API failed');
    
    const data = await response.json();
    
    if (data.elements && data.elements.length > 0) {
      // Find the closest point on the nearest road
      let closestPoint = { lat, lng };
      let minDistance = Infinity;
      
      data.elements.forEach(way => {
        if (way.geometry) {
          way.geometry.forEach(node => {
            const distance = Math.sqrt(
              Math.pow(node.lat - lat, 2) + Math.pow(node.lon - lng, 2)
            );
            if (distance < minDistance) {
              minDistance = distance;
              closestPoint = { lat: node.lat, lng: node.lon };
            }
          });
        }
      });
      
      return closestPoint;
    }
    
    return { lat, lng }; // Return original if no roads found
  } catch (error) {
    console.error('❌ Road snapping error:', error);
    return { lat, lng };
  }
}

function App() {
  const [selectedDate, setSelectedDate] = useState("2024-06-25");
  const [routeData, setRouteData] = useState([]);
  const [snappedRouteData, setSnappedRouteData] = useState([]);
  const [playIdx, setPlayIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [useRoadSnapping, setUseRoadSnapping] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const intervalRef = useRef(null);

  // Fetch route data when selected date changes
  useEffect(() => {
    if (selectedDate) {
      setIsProcessing(true);
      fetch(`http://localhost:5000/api/route/${selectedDate}`)
        .then((res) => res.json())
        .then(async (data) => {
          console.log("📦 Fetched data:", data);
          if (Array.isArray(data.coordinates)) {
            // Filter out invalid coordinates
            const cleanData = data.coordinates.filter(
              p => p && 
                   typeof p.lat === 'number' && 
                   typeof p.lng === 'number' &&
                   !isNaN(p.lat) && 
                   !isNaN(p.lng)
            );
            
            console.log("✅ Clean route data:", cleanData);
            setRouteData(cleanData);
            
            // Apply road snapping if enabled
            if (useRoadSnapping && cleanData.length > 0) {
              console.log("🛣️ Applying road snapping...");
              try {
                // Option 1: Use OSRM map matching (recommended for full routes)
                const snapped = await snapToRoad(cleanData);
                setSnappedRouteData(snapped);
                console.log("✅ Road snapped data:", snapped);
              } catch (error) {
                console.error("❌ Road snapping failed, using original data");
                setSnappedRouteData(cleanData);
              }
            } else {
              setSnappedRouteData(cleanData);
            }
            
            setPlayIdx(0);
          } else {
            console.error("❌ Invalid coordinates array:", data.coordinates);
            setRouteData([]);
            setSnappedRouteData([]);
          }
          setIsProcessing(false);
        })
        .catch((error) => {
          console.error("❌ Fetch error:", error.message);
          setRouteData([]);
          setSnappedRouteData([]);
          setIsProcessing(false);
        });
    }
  }, [selectedDate, useRoadSnapping]);

  // Handle animation when route data changes
  useEffect(() => {
    if (snappedRouteData.length > 0) {
      setPlayIdx(0);
      if (isPlaying) {
        startAnimation();
      }
    }
  }, [snappedRouteData]);

  // Handle speed or play/pause toggle
  useEffect(() => {
    if (!snappedRouteData.length) return;
    
    clearInterval(intervalRef.current);
    
    if (isPlaying) {
      startAnimation();
    }
  }, [speed, isPlaying]);

  const startAnimation = () => {
    clearInterval(intervalRef.current);
    
    if (snappedRouteData.length === 0) return;
    
    intervalRef.current = setInterval(() => {
      setPlayIdx((prev) => {
        const nextIdx = prev + 1;
        if (nextIdx >= snappedRouteData.length) {
          clearInterval(intervalRef.current);
          return prev;
        }
        return nextIdx;
      });
    }, 1000 / speed);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const resetAnimation = () => {
    setPlayIdx(0);
    if (isPlaying) {
      startAnimation();
    }
  };

  const currentPosition = snappedRouteData.length > 0 ? snappedRouteData[playIdx] : { lat: 18.52, lng: 73.85 };
  
  // Create polyline paths
  const polylinePath = snappedRouteData
    .slice(0, playIdx + 1)
    .map((p) => [p.lat, p.lng]);

  const fullRoutePath = snappedRouteData.map((p) => [p.lat, p.lng]);
  
  // Original route path for comparison
  const originalRoutePath = routeData.map((p) => [p.lat, p.lng]);

  return (
    <div className="p-4 flex flex-col items-center min-h-screen bg-gray-200">
      <h1 className="text-2xl font-bold mb-4 bg-gray-500 p-2 rounded-md text-white hover:scale-110 ease-in-out duration-150">
        🚗 Vehicle Route Tracker {isProcessing && "⏳"}
      </h1>

      <div className="mb-4 flex gap-4 items-center flex-wrap">
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="p-2 border rounded bg-gray-500 text-white hover:bg-gray-600 transition-colors"
          disabled={isProcessing}
        >
          <option value="2024-06-25">Route Segment 1</option>
          <option value="2024-06-26">Route Segment 2</option>
          <option value="2024-06-27">Route Segment 3</option>
        </select>

        <button
          onClick={() => setIsPlaying((prev) => !prev)}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          disabled={isProcessing}
        >
          {isPlaying ? "⏸️ Pause" : "▶️ Play"}
        </button>

        <button
          onClick={resetAnimation}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          disabled={isProcessing}
        >
          🔄 Reset
        </button>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useRoadSnapping}
            onChange={(e) => setUseRoadSnapping(e.target.checked)}
            disabled={isProcessing}
          />
          <span className="text-sm">🛣️ Snap to roads</span>
        </label>
      </div>

      <div className="mb-4 w-64">
        <label className="block text-sm font-medium mb-1">
          Speed: {speed}x
        </label>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.5"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="w-full"
          disabled={isProcessing}
        />
      </div>

      <div className="mb-4 text-sm text-gray-600">
        Progress: {playIdx + 1} / {snappedRouteData.length} waypoints
        {routeData[playIdx]?.timestamp && (
          <span className="ml-2">
            | Time: {new Date(routeData[playIdx].timestamp).toLocaleTimeString()}
          </span>
        )}
        {useRoadSnapping && (
          <span className="ml-2 text-green-600">| 🛣️ Road-snapped</span>
        )}
      </div>

       {snappedRouteData.length === 0 && !isProcessing && (
        <div className="mt-4 text-red-500">
          ⚠️ No route data available for selected date
        </div>
      )}
      
      {isProcessing && (
        <div className="mt-4 text-blue-500">
          ⏳ Processing route data...
        </div>
      )}

      <div className="w-full h-[400px] max-w-4xl border rounded-lg overflow-hidden">
        <MapContainer
          center={[currentPosition.lat, currentPosition.lng]}
          zoom={15}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap contributors"
          />
          {snappedRouteData.length > 0 && (
            <>
              {/* Show original route in red (if road snapping is enabled) */}
              {useRoadSnapping && (
                <Polyline 
                  positions={originalRoutePath} 
                  color="red" 
                  weight={2} 
                  opacity={0.3}
                  dashArray="5, 5"
                />
              )}
              
              {/* Full route path (grayed out) */}
              <Polyline 
                positions={fullRoutePath} 
                color="lightgray" 
                weight={3} 
                opacity={0.5}
              />
              
              {/* Traveled path (blue) */}
              <Polyline 
                positions={polylinePath} 
                color="blue" 
                weight={4} 
                opacity={0.8}
              />
              
              {/* Car marker */}
              <Marker
                position={[currentPosition.lat, currentPosition.lng]}
                icon={carIcon}
              />
              
              {/* Auto-center map on car */}
              <ChangeView center={[currentPosition.lat, currentPosition.lng]} />
            </>
          )}
        </MapContainer>
      </div>

     
    </div>
  );
}

export default App;


