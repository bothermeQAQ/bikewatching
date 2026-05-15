# Bikewatching

An interactive Mapbox GL JS and D3 visualization of BlueBike traffic patterns in the Boston area. The map shows Boston and Cambridge bike lanes, BlueBike station activity, time filtering, and whether each station has more departures or arrivals.

## Live Site

GitHub Pages: https://bothermeqaq.github.io/bikewatching/

## Run Locally

Use any static file server from this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Mapbox Token

The project intentionally does not include a private key or invented token.

If you want Mapbox-hosted tiles, open `map.js` and replace:

```js
const MAPBOX_ACCESS_TOKEN = 'PASTE_YOUR_MAPBOX_PUBLIC_TOKEN_HERE';
```

with your Mapbox public access token. While that placeholder is unchanged, the site uses an OpenStreetMap raster fallback inside Mapbox GL JS so the visualization still runs.

## Datasets

- Boston bike lanes: https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson
- Cambridge bike lanes: https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson
- BlueBike stations: https://dsc106.com/labs/lab07/data/bluebikes-stations.json
- BlueBike March 2024 traffic: https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv

## Notes

Trip departures and arrivals are pre-bucketed by minute of day. Moving the time slider only reads the relevant minute buckets instead of scanning the full CSV each time.
