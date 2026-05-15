import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Paste your Mapbox public access token here if you want Mapbox-hosted tiles.
// A no-token OpenStreetMap fallback is used while this placeholder is unchanged.
const MAPBOX_ACCESS_TOKEN = 'PASTE_YOUR_MAPBOX_PUBLIC_TOKEN_HERE';

const BOSTON_BIKE_LANES_URL =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson';
const CAMBRIDGE_BIKE_LANES_URL =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';
const STATIONS_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRAFFIC_URL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
const MINUTES_PER_DAY = 24 * 60;
const FILTER_WINDOW = 60;

let baseStations = [];
let stationSelection;
let radiusScale = d3.scaleSqrt().range([0, 26]);
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
let departuresByMinute = Array.from({ length: MINUTES_PER_DAY }, () => []);
let arrivalsByMinute = Array.from({ length: MINUTES_PER_DAY }, () => []);
let bikeLaneSelection;

const hasMapboxToken =
  MAPBOX_ACCESS_TOKEN &&
  MAPBOX_ACCESS_TOKEN !== 'PASTE_YOUR_MAPBOX_PUBLIC_TOKEN_HERE';

mapboxgl.accessToken = hasMapboxToken ? MAPBOX_ACCESS_TOKEN : '';

const map = new mapboxgl.Map({
  container: 'map',
  style: hasMapboxToken
    ? 'mapbox://styles/mapbox/light-v11'
    : {
        version: 8,
        sources: {
          'carto-light': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
              'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
              'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          },
        },
        layers: [
          {
            id: 'carto-light',
            type: 'raster',
            source: 'carto-light',
            paint: {
              'raster-saturation': -1,
              'raster-contrast': 0.06,
              'raster-opacity': 0.86,
            },
          },
        ],
      },
  center: [-71.095, 42.36],
  zoom: 12,
  minZoom: 10,
  maxZoom: 18,
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

const svg = d3.select('#map').select('svg');
const bikeLaneLayer = svg.append('g').attr('class', 'bike-lanes-overlay');
const stationLayer = svg.append('g').attr('class', 'stations-overlay');
const status = document.querySelector('#loading-status');
const timeSlider = document.querySelector('#time-slider');
const selectedTime = document.querySelector('#selected-time');
const anyTimeLabel = document.querySelector('#any-time');

map.on('load', async () => {
  addBikeLaneLayer('boston-bike-lanes', BOSTON_BIKE_LANES_URL);
  addBikeLaneLayer('cambridge-bike-lanes', CAMBRIDGE_BIKE_LANES_URL);

  try {
    const [stationData, , bostonBikeLanes, cambridgeBikeLanes] = await Promise.all([
      d3.json(STATIONS_URL),
      d3.csv(TRAFFIC_URL, parseTrip),
      d3.json(BOSTON_BIKE_LANES_URL),
      d3.json(CAMBRIDGE_BIKE_LANES_URL),
    ]);

    baseStations = stationData.data.stations;
    const stations = computeStationTraffic(baseStations, -1);
    radiusScale.domain([0, d3.max(stations, (d) => d.totalTraffic) || 1]);

    if (!hasMapboxToken) {
      renderBikeLaneFallback([bostonBikeLanes, cambridgeBikeLanes]);
    }

    stationSelection = stationLayer
      .selectAll('circle')
      .data(stations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .attr('aria-label', (d) => d.name);

    stationSelection.append('title');

    updateStationAttributes(stations, -1);
    updatePositions();
    bindMapEvents();
    bindTimeSlider();

    status.textContent = `${stations.length} stations and bike lane layers loaded`;
  } catch (error) {
    console.error(error);
    status.textContent = 'Could not load one or more datasets. Check the console for details.';
    status.classList.add('is-error');
  }
});

function addBikeLaneLayer(id, dataUrl) {
  const paint = {
    'line-color': '#19c96f',
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 13, 3.2, 16, 6],
    'line-opacity': 0.56,
  };

  map.addSource(id, {
    type: 'geojson',
    data: dataUrl,
  });

  map.addLayer({
    id,
    type: 'line',
    source: id,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint,
  });
}

function parseTrip(trip) {
  trip.started_at = new Date(trip.started_at);
  trip.ended_at = new Date(trip.ended_at);

  const startMinute = minutesSinceMidnight(trip.started_at);
  const endMinute = minutesSinceMidnight(trip.ended_at);

  departuresByMinute[startMinute].push(trip);
  arrivalsByMinute[endMinute].push(trip);

  return trip;
}

function computeStationTraffic(stations, minute = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, minute),
    (trips) => trips.length,
    (trip) => trip.start_station_id
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, minute),
    (trips) => trips.length,
    (trip) => trip.end_station_id
  );

  return stations.map((station) => {
    const departuresCount = departures.get(station.short_name) ?? 0;
    const arrivalsCount = arrivals.get(station.short_name) ?? 0;

    return {
      ...station,
      departures: departuresCount,
      arrivals: arrivalsCount,
      totalTraffic: departuresCount + arrivalsCount,
    };
  });
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  const matchingTrips = [];

  for (let offset = -FILTER_WINDOW; offset <= FILTER_WINDOW; offset += 1) {
    const bucket = (minute + offset + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    matchingTrips.push(...tripsByMinute[bucket]);
  }

  return matchingTrips;
}

function updateStationAttributes(stations, minute) {
  radiusScale.range(minute === -1 ? [0, 26] : [2.5, 44]);

  stationSelection = stationLayer
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .join('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', getDepartureRatio)
    .attr('opacity', (d) => (d.totalTraffic > 0 ? 1 : 0.16));

  stationSelection
    .select('title')
    .text(
      (d) =>
        `${d.name}\n${d.totalTraffic.toLocaleString()} trips (${d.departures.toLocaleString()} departures, ${d.arrivals.toLocaleString()} arrivals)`
    );
}

function getDepartureRatio(station) {
  if (!station.totalTraffic) {
    return 0.5;
  }

  return stationFlow(station.departures / station.totalTraffic);
}

function updateScatterPlot(minute) {
  const stations = computeStationTraffic(baseStations, minute);
  updateStationAttributes(stations, minute);
  updatePositions();
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function updatePositions() {
  updateBikeLaneFallback();

  if (!stationSelection) {
    return;
  }

  stationSelection
    .attr('cx', (station) => getCoords(station).cx)
    .attr('cy', (station) => getCoords(station).cy);
}

function renderBikeLaneFallback(geojsonCollections) {
  const features = geojsonCollections.flatMap((collection) => collection.features ?? []);

  bikeLaneSelection = bikeLaneLayer
    .selectAll('path')
    .data(features)
    .join('path');

  updateBikeLaneFallback();
}

function updateBikeLaneFallback() {
  if (!bikeLaneSelection) {
    return;
  }

  bikeLaneSelection.attr('d', (feature) => getBikeLanePath(feature.geometry));
}

function getBikeLanePath(geometry) {
  if (!geometry) {
    return '';
  }

  if (geometry.type === 'LineString') {
    return getLineStringPath(geometry.coordinates);
  }

  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.map(getLineStringPath).join('');
  }

  return '';
}

function getLineStringPath(coordinates) {
  return coordinates
    .map(([longitude, latitude], index) => {
      const { x, y } = map.project(new mapboxgl.LngLat(+longitude, +latitude));
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join('');
}

function bindMapEvents() {
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);
}

function bindTimeSlider() {
  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
}

function updateTimeDisplay() {
  const minute = Number(timeSlider.value);

  if (minute === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.hidden = false;
  } else {
    selectedTime.textContent = formatTime(minute);
    anyTimeLabel.hidden = true;
  }

  updateScatterPlot(minute);
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(minutes) {
  const date = new Date(2000, 0, 1, 0, minutes);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
