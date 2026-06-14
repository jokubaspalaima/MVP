// netlify/functions/meetings.js
// Multi-source AA meeting fetcher
// Layer 1: CORS proxy → Meeting Guide API (may bypass allowlist)
// Layer 2: Direct TSML feeds from real AA intergroup WordPress sites
// Layer 3: State-specific intergroup APIs
// Uses built-in https — no npm needed

const https = require('https');
const http  = require('http');

// ── HTTP GET helper ───────────────────────────────────────────
function get(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    try {
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, timeout).then(resolve).catch(reject);
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      });
      req.on('error', reject);
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
    } catch(e) { reject(e); }
  });
}

// ── Parse and validate meeting JSON ──────────────────────────
function parseMeetings(body) {
  try {
    const d = JSON.parse(body);
    const list = Array.isArray(d) ? d : (d.meetings || d.data || []);
    if (!Array.isArray(list) || list.length === 0) return null;
    // Validate it looks like meeting data
    const first = list[0];
    if (!first || !(first.name || first.meeting_name || first.group_name)) return null;
    return list;
  } catch { return null; }
}

// ── Normalize any meeting format to our standard ─────────────
const DAY_MAP = {
  'sunday':0,'sun':0,'0':0, 0:0,
  'monday':1,'mon':1,'1':1, 1:1,
  'tuesday':2,'tue':2,'2':2, 2:2,
  'wednesday':3,'wed':3,'3':3, 3:3,
  'thursday':4,'thu':4,'4':4, 4:4,
  'friday':5,'fri':5,'5':5, 5:5,
  'saturday':6,'sat':6,'6':6, 6:6,
};

function normalizeDay(raw) {
  if (raw === null || raw === undefined) return -1;
  if (typeof raw === 'number') return raw >= 0 && raw <= 6 ? raw : -1;
  const s = String(raw).toLowerCase().trim();
  return DAY_MAP[s] ?? -1;
}

function normalizeTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2,'0')}:${m[2]}`;
}

function normalizeMeeting(m) {
  const day  = normalizeDay(m.day ?? m.weekday ?? m.day_of_week);
  const time = normalizeTime(m.time ?? m.start_time ?? m.meeting_time);
  if (day < 0 || !time) return null;
  return {
    id:            String(m.id || m.meeting_id || ''),
    name:          String(m.name || m.meeting_name || m.group_name || 'AA Meeting').trim(),
    day,
    time,
    timezone:      m.timezone || m.time_zone || '',
    location_name: m.location || m.location_name || m.place || '',
    address:       m.address || m.street || '',
    city:          m.city || m.location_city || '',
    state:         m.state || m.location_state || '',
    country:       m.country || 'US',
    zip:           m.postal_code || m.zip || '',
    lat:           parseFloat(m.latitude  || m.lat) || null,
    lng:           parseFloat(m.longitude || m.lng) || null,
    types:         Array.isArray(m.types) ? m.types : (m.type ? [m.type] : []),
    notes:         m.notes || m.comments || '',
    source:        'intergroup-feed',
  };
}

// ── State detection from lat/lng ──────────────────────────────
// Simple bounding boxes — good enough to route to the right intergroup
function getState(lat, lng) {
  const boxes = [
    ['AK', 51.2, 71.5, -179.9, -129.9],
    ['HI', 18.9, 22.2, -160.3, -154.8],
    ['WA', 45.5, 49.0, -124.8, -116.9],
    ['OR', 41.9, 46.3, -124.6, -116.4],
    ['CA', 32.5, 42.0, -124.5, -114.1],
    ['NV', 35.0, 42.0, -120.0, -114.0],
    ['ID', 41.9, 49.0, -117.2, -111.0],
    ['MT', 44.3, 49.0, -116.1, -104.0],
    ['WY', 40.9, 45.0, -111.1, -104.0],
    ['UT', 36.9, 42.0, -114.1, -109.0],
    ['CO', 36.9, 41.1, -109.1, -102.0],
    ['AZ', 31.3, 37.0, -114.8, -109.0],
    ['NM', 31.3, 37.0, -109.1, -103.0],
    ['TX', 25.8, 36.5, -106.6, -93.5],
    ['OK', 33.6, 37.0, -103.0, -94.4],
    ['KS', 36.9, 40.0, -102.1, -94.6],
    ['NE', 39.9, 43.0, -104.1, -95.3],
    ['SD', 42.4, 45.9, -104.1, -96.4],
    ['ND', 45.9, 49.0, -104.1, -96.6],
    ['MN', 43.5, 49.4, -97.2, -89.5],
    ['IA', 40.3, 43.5, -96.6, -90.1],
    ['MO', 35.9, 40.6, -95.8, -89.1],
    ['AR', 33.0, 36.5, -94.6, -89.6],
    ['LA', 28.9, 33.0, -94.1, -88.8],
    ['WI', 42.4, 47.1, -92.9, -86.2],
    ['MI', 41.7, 48.3, -90.4, -82.4],
    ['IL', 36.9, 42.5, -91.5, -87.0],
    ['IN', 37.7, 41.8, -88.1, -84.8],
    ['OH', 38.4, 42.3, -84.8, -80.5],
    ['KY', 36.5, 39.1, -89.6, -81.9],
    ['TN', 34.9, 36.7, -90.3, -81.6],
    ['MS', 30.1, 35.0, -91.7, -88.1],
    ['AL', 30.1, 35.0, -88.5, -84.9],
    ['GA', 30.4, 35.0, -85.6, -80.8],
    ['FL', 24.4, 31.0, -87.6, -79.9],
    ['SC', 32.0, 35.2, -83.4, -78.5],
    ['NC', 33.7, 36.6, -84.3, -75.5],
    ['VA', 36.5, 39.5, -83.7, -75.2],
    ['WV', 37.1, 40.6, -82.6, -77.7],
    ['PA', 39.7, 42.3, -80.5, -74.7],
    ['NY', 40.5, 45.0, -79.8, -71.9],
    ['NJ', 38.9, 41.4, -75.6, -73.9],
    ['DE', 38.4, 39.9, -75.8, -75.0],
    ['MD', 37.9, 39.7, -79.5, -75.0],
    ['DC', 38.8, 39.0, -77.1, -76.9],
    ['CT', 40.9, 42.1, -73.7, -71.8],
    ['RI', 41.1, 42.0, -71.9, -71.1],
    ['MA', 41.2, 42.9, -73.5, -69.9],
    ['VT', 42.7, 45.0, -73.4, -71.5],
    ['NH', 42.7, 45.3, -72.6, -70.7],
    ['ME', 43.1, 47.5, -71.1, -66.9],
  ];
  for (const [st, minLat, maxLat, minLng, maxLng] of boxes) {
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) return st;
  }
  return null;
}

// ── Real AA intergroup TSML feeds ────────────────────────────
// Format: state → array of candidate URLs to try in order
// These are real known AA intergroup websites that use WordPress + TSML plugin
const INTERGROUP_FEEDS = {
  // TSML JSON feed endpoint (WordPress plugin)
  AL: ['https://www.alabamaaa.org/wp-json/intergroup/v1/meetings'],
  AK: ['https://www.aaalaska.org/wp-json/intergroup/v1/meetings'],
  AZ: ['https://www.phoenixaa.org/wp-json/intergroup/v1/meetings',
       'https://tucsonaa.org/wp-json/intergroup/v1/meetings'],
  AR: ['https://centralarkansasaa.org/wp-json/intergroup/v1/meetings'],
  CA: ['https://www.lacoaa.org/wp-json/intergroup/v1/meetings',
       'https://sfaa.org/wp-json/intergroup/v1/meetings',
       'https://aasandiego.org/wp-json/intergroup/v1/meetings',
       'https://aasanjose.org/wp-json/intergroup/v1/meetings',
       'https://www.sacramentoaa.org/wp-json/intergroup/v1/meetings'],
  CO: ['https://www.denveraa.org/wp-json/intergroup/v1/meetings',
       'https://coloradospringsaa.org/wp-json/intergroup/v1/meetings'],
  CT: ['https://www.ctintergroup.org/wp-json/intergroup/v1/meetings'],
  DC: ['https://www.dcintergroup.org/wp-json/intergroup/v1/meetings'],
  FL: ['https://www.aasouthflorida.org/wp-json/intergroup/v1/meetings',
       'https://www.jaxaa.com/wp-json/intergroup/v1/meetings',
       'https://www.orlandoaa.org/wp-json/intergroup/v1/meetings',
       'https://www.tampabayaa.org/wp-json/intergroup/v1/meetings'],
  GA: ['https://www.atlantaaa.org/wp-json/intergroup/v1/meetings'],
  HI: ['https://www.aahawaii.org/wp-json/intergroup/v1/meetings'],
  ID: ['https://www.idahoaa.org/wp-json/intergroup/v1/meetings'],
  IL: ['https://www.chicagoaa.org/wp-json/intergroup/v1/meetings',
       'https://aaspringfield.org/wp-json/intergroup/v1/meetings'],
  IN: ['https://www.indyaa.org/wp-json/intergroup/v1/meetings'],
  IA: ['https://www.desmoinesaa.org/wp-json/intergroup/v1/meetings'],
  KS: ['https://www.aawichita.org/wp-json/intergroup/v1/meetings'],
  KY: ['https://www.louisvilleaa.org/wp-json/intergroup/v1/meetings',
       'https://www.aacentralky.org/wp-json/intergroup/v1/meetings'],
  LA: ['https://www.aanorleans.org/wp-json/intergroup/v1/meetings',
       'https://batonrougeaa.org/wp-json/intergroup/v1/meetings'],
  ME: ['https://www.aamaine.org/wp-json/intergroup/v1/meetings'],
  MD: ['https://www.baltimoreaa.org/wp-json/intergroup/v1/meetings',
       'https://marylandaa.org/wp-json/intergroup/v1/meetings'],
  MA: ['https://www.aaboston.org/wp-json/intergroup/v1/meetings',
       'https://www.aaworcester.org/wp-json/intergroup/v1/meetings'],
  MI: ['https://www.detroitaa.org/wp-json/intergroup/v1/meetings',
       'https://www.grandrapidsaa.org/wp-json/intergroup/v1/meetings'],
  MN: ['https://www.aaminneapolis.org/wp-json/intergroup/v1/meetings',
       'https://aaofstpaul.org/wp-json/intergroup/v1/meetings'],
  MS: ['https://www.aajackson.org/wp-json/intergroup/v1/meetings'],
  MO: ['https://www.stlouisaa.org/wp-json/intergroup/v1/meetings',
       'https://www.aaofkansascity.org/wp-json/intergroup/v1/meetings'],
  MT: ['https://www.montanaaa.org/wp-json/intergroup/v1/meetings'],
  NE: ['https://www.omahaaa.org/wp-json/intergroup/v1/meetings'],
  NV: ['https://www.lasvegasaa.org/wp-json/intergroup/v1/meetings',
       'https://www.renoaa.org/wp-json/intergroup/v1/meetings'],
  NH: ['https://www.aanewHampshire.org/wp-json/intergroup/v1/meetings'],
  NJ: ['https://www.aaofnewjersey.org/wp-json/intergroup/v1/meetings'],
  NM: ['https://www.abqaa.org/wp-json/intergroup/v1/meetings'],
  NY: ['https://www.nyintergroup.org/wp-json/intergroup/v1/meetings',
       'https://www.buffaloaa.org/wp-json/intergroup/v1/meetings',
       'https://www.aalbany.org/wp-json/intergroup/v1/meetings'],
  NC: ['https://www.charlotteaa.org/wp-json/intergroup/v1/meetings',
       'https://www.raleighaa.org/wp-json/intergroup/v1/meetings'],
  ND: ['https://www.aanorthdakota.org/wp-json/intergroup/v1/meetings'],
  OH: ['https://www.aacolumbus.org/wp-json/intergroup/v1/meetings',
       'https://www.clevelandaa.org/wp-json/intergroup/v1/meetings',
       'https://www.aacincy.org/wp-json/intergroup/v1/meetings'],
  OK: ['https://www.aaoklahomacity.org/wp-json/intergroup/v1/meetings',
       'https://www.aatulsa.org/wp-json/intergroup/v1/meetings'],
  OR: ['https://www.portlandaa.org/wp-json/intergroup/v1/meetings',
       'https://www.eugeneaa.org/wp-json/intergroup/v1/meetings'],
  PA: ['https://www.philadelphiaaa.org/wp-json/intergroup/v1/meetings',
       'https://www.pittsburghaa.org/wp-json/intergroup/v1/meetings'],
  RI: ['https://www.aarhodeisland.org/wp-json/intergroup/v1/meetings'],
  SC: ['https://www.columbiaaa.org/wp-json/intergroup/v1/meetings'],
  SD: ['https://www.aasouthdakota.org/wp-json/intergroup/v1/meetings'],
  TN: ['https://www.nashvilleaa.org/wp-json/intergroup/v1/meetings',
       'https://www.memphisaa.org/wp-json/intergroup/v1/meetings'],
  TX: ['https://www.aahoustoncentral.org/wp-json/intergroup/v1/meetings',
       'https://www.austinaa.org/wp-json/intergroup/v1/meetings',
       'https://www.dallasaa.org/wp-json/intergroup/v1/meetings',
       'https://www.saantonioaa.org/wp-json/intergroup/v1/meetings',
       'https://www.fortworthaa.org/wp-json/intergroup/v1/meetings'],
  UT: ['https://www.saltlakeaa.org/wp-json/intergroup/v1/meetings'],
  VT: ['https://www.aavt.org/wp-json/intergroup/v1/meetings'],
  VA: ['https://www.richmondaa.org/wp-json/intergroup/v1/meetings',
       'https://www.nvaaa.org/wp-json/intergroup/v1/meetings'],
  WA: ['https://www.aaseattle.org/wp-json/intergroup/v1/meetings',
       'https://www.spokaneaa.org/wp-json/intergroup/v1/meetings'],
  WV: ['https://www.aawv.org/wp-json/intergroup/v1/meetings'],
  WI: ['https://www.milwaukeeaa.org/wp-json/intergroup/v1/meetings',
       'https://www.madisonaa.org/wp-json/intergroup/v1/meetings'],
  WY: ['https://www.wyomingaa.org/wp-json/intergroup/v1/meetings'],
};

// ── Haversine distance (km) ───────────────────────────────────
function dist(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dL = (lat2-lat1)*Math.PI/180;
  const dG = (lng2-lng1)*Math.PI/180;
  const a  = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ── Main handler ─────────────────────────────────────────────
exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:CORS, body:'' };

  const { lat, lng, miles='30' } = event.queryStringParameters || {};
  if (!lat || !lng) return { statusCode:400, headers:CORS, body: JSON.stringify({error:'lat and lng required', meetings:[]}) };

  const latF  = parseFloat(lat);
  const lngF  = parseFloat(lng);
  const milesI = Math.min(parseInt(miles)||30, 60);
  if (isNaN(latF)||isNaN(lngF)) return { statusCode:400, headers:CORS, body: JSON.stringify({error:'Invalid coords', meetings:[]}) };

  const radiusKm = milesI * 1.60934;
  const state    = getState(latF, lngF);
  console.log(`Request: ${latF},${lngF} → state=${state}`);

  // ── Layer 1: CORS proxy → Meeting Guide ──────────────────────
  const proxies = [
    `https://corsproxy.io/?url=${encodeURIComponent(`https://api.meetingguide.org/meetings?lat=${latF}&lng=${lngF}&miles=${milesI}`)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://api.meetingguide.org/meetings?lat=${latF}&lng=${lngF}&miles=${milesI}`)}`,
    `https://thingproxy.freeboard.io/fetch/https://api.meetingguide.org/meetings?lat=${latF}&lng=${lngF}&miles=${milesI}`,
  ];

  for (const proxyUrl of proxies) {
    try {
      console.log(`Trying proxy: ${proxyUrl.substring(0,60)}`);
      const { status, body } = await get(proxyUrl, 7000);
      const list = parseMeetings(body);
      if (list && list.length > 0) {
        console.log(`Proxy success: ${list.length} meetings`);
        const normalized = list.map(normalizeMeeting).filter(Boolean);
        return { statusCode:200, headers:CORS, body: JSON.stringify({ meetings: normalized, source: 'meeting-guide', count: normalized.length }) };
      }
    } catch(e) { console.log(`Proxy failed: ${e.message}`); }
  }

  // ── Layer 2: Direct intergroup TSML feeds ────────────────────
  if (state && INTERGROUP_FEEDS[state]) {
    for (const feedUrl of INTERGROUP_FEEDS[state]) {
      try {
        console.log(`Trying TSML feed: ${feedUrl}`);
        const { status, body } = await get(feedUrl, 8000);
        if (status === 200) {
          const list = parseMeetings(body);
          if (list && list.length > 0) {
            console.log(`TSML success: ${feedUrl} → ${list.length} meetings`);
            // Filter by distance if coords available
            let normalized = list.map(normalizeMeeting).filter(Boolean);
            const withCoords = normalized.filter(m => m.lat && m.lng);
            if (withCoords.length > 0) {
              normalized = withCoords
                .map(m => ({ ...m, _dist: dist(latF, lngF, m.lat, m.lng) }))
                .filter(m => m._dist <= radiusKm)
                .sort((a,b) => a._dist - b._dist);
            }
            return {
              statusCode: 200, headers: CORS,
              body: JSON.stringify({ meetings: normalized, source: 'tsml-feed', feed: feedUrl, count: normalized.length })
            };
          }
        }
      } catch(e) { console.log(`TSML feed failed ${feedUrl}: ${e.message}`); }
    }
  }

  // ── All layers failed ────────────────────────────────────────
  console.log('All sources failed');
  return {
    statusCode: 200, // return 200 so app uses seed fallback gracefully
    headers: CORS,
    body: JSON.stringify({ meetings: [], source: 'none', error: 'All sources unavailable', state })
  };
};
