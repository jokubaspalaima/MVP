// netlify/functions/meetings.js
// Proxy for Meeting Guide API using built-in https (no npm needed)

const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Siandien-App/1.0',
        'Accept':     'application/json',
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { lat, lng, miles = '30' } = event.queryStringParameters || {};

  if (!lat || !lng) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'lat and lng required' }),
    };
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  if (isNaN(latF) || isNaN(lngF)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid coordinates' }),
    };
  }

  const milesI = Math.min(Math.max(parseInt(miles, 10) || 30, 1), 60);
  const url = `https://api.meetingguide.org/meetings?lat=${latF}&lng=${lngF}&miles=${milesI}`;

  try {
    const { status, body } = await httpsGet(url);

    if (status !== 200) {
      throw new Error(`Meeting Guide returned ${status}`);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=300',
      },
      body,
    };
  } catch (err) {
    console.error('Proxy error:', err.message);
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, meetings: [] }),
    };
  }
};
