// netlify/functions/meetings.js
// ─────────────────────────────────────────────────────────────
// Serverless proxy for the Meeting Guide API.
// Runs on Netlify's servers — no CORS issues.
//
// Called from the app as:
//   /.netlify/functions/meetings?lat=X&lng=Y&miles=25
//
// Returns the exact same JSON the Meeting Guide API returns.
// ─────────────────────────────────────────────────────────────

const MG_URL = 'https://api.meetingguide.org/meetings';

exports.handler = async (event) => {
  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { lat, lng, miles = '25' } = event.queryStringParameters || {};

  if (!lat || !lng) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'lat and lng are required' }),
    };
  }

  // Validate coords are real numbers in sensible range
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  if (isNaN(latF) || isNaN(lngF) || latF < -90 || latF > 90 || lngF < -180 || lngF > 180) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid coordinates' }),
    };
  }

  const milesI = Math.min(Math.max(parseInt(miles, 10) || 25, 1), 60);

  try {
    const url = `${MG_URL}?lat=${latF}&lng=${lngF}&miles=${milesI}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Siandien-App/1.0',
        'Accept':     'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Meeting Guide API returned ${response.status}`);
    }

    const data = await response.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'public, max-age=300', // cache 5 min
      },
      body: data,
    };
  } catch (err) {
    console.error('meetings proxy error:', err.message);
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Failed to fetch from Meeting Guide', meetings: [] }),
    };
  }
};
