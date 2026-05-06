// netlify/functions/meetings.js
// Proxy that tries multiple AA data sources in order
// Uses built-in https module — works on all Node versions

const https = require('https');
const http  = require('http');

function get(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Siandien/1.0)',
        'Accept': 'application/json, */*',
      }
    }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, timeout).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Validate that a response looks like AA meeting JSON
function isValidMeetingJson(body) {
  try {
    const d = JSON.parse(body);
    const list = Array.isArray(d) ? d : (d.meetings || []);
    return list.length > 0 && (list[0].name || list[0].meeting_name);
  } catch { return false; }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { lat, lng, miles = '30' } = event.queryStringParameters || {};
  if (!lat || !lng) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'lat and lng required', meetings: [] }) };
  }

  const latF  = parseFloat(lat);
  const lngF  = parseFloat(lng);
  const milesI = Math.min(Math.max(parseInt(miles) || 30, 1), 60);

  if (isNaN(latF) || isNaN(lngF)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid coordinates', meetings: [] }) };
  }

  // Sources to try in order
  const sources = [
    `https://api.meetingguide.org/meetings?lat=${latF}&lng=${lngF}&miles=${milesI}`,
    `https://www.aa.org/api/meetings?lat=${latF}&lng=${lngF}&miles=${milesI}`,
  ];

  for (const url of sources) {
    try {
      console.log(`Trying: ${url}`);
      const { status, body } = await get(url);
      console.log(`Response: ${status}, body length: ${body.length}`);

      if (status === 200 && isValidMeetingJson(body)) {
        console.log(`Success from: ${url}`);
        return { statusCode: 200, headers, body };
      }
      console.log(`Source failed: status=${status}, valid=${isValidMeetingJson(body)}`);
    } catch (err) {
      console.log(`Source error: ${err.message}`);
    }
  }

  // All sources failed
  return {
    statusCode: 502,
    headers,
    body: JSON.stringify({ error: 'All AA data sources unavailable', meetings: [] }),
  };
};
