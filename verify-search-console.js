const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const KEY_FILE = path.join(__dirname, 'google-service-account.json');

async function getAccessToken(key) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedToken = `${base64url(header)}.${base64url(claimSet)}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  sign.end();
  const signature = sign.sign(key.private_key, 'base64url');
  const jwt = `${unsignedToken}.${signature}`;

  const postData = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.access_token) {
            resolve(data.access_token);
          } else {
            reject(new Error(`Failed to obtain access token: ${body}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function fetchGoogleApi(endpoint, token, options = {}) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const postData = options.body ? JSON.stringify(options.body) : null;

    const headers = {
      'Authorization': `Bearer ${token}`
    };
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(endpoint, { method, headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(KEY_FILE)) {
    console.error(`Key file not found at ${KEY_FILE}`);
    process.exit(1);
  }

  const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  console.log(`Authenticating as: ${key.client_email}`);

  const token = await getAccessToken(key);
  console.log('Authentication successful!\n');

  // 1. List sites
  console.log('--- Checking Accessible Sites ---');
  const sitesRes = await fetchGoogleApi('https://www.googleapis.com/webmasters/v3/sites', token);
  const sites = sitesRes.data?.siteEntry || [];
  for (const s of sites) {
    console.log(` • ${s.siteUrl} (${s.permissionLevel})`);
  }

  const targetProperty = 'sc-domain:jocassidy.com';
  const hasTarget = sites.some(s => s.siteUrl === targetProperty);
  console.log(`\nTarget Property [${targetProperty}]: ${hasTarget ? 'FOUND with full access' : 'NOT FOUND'}`);

  if (hasTarget) {
    const encodedSite = encodeURIComponent(targetProperty);

    // 2. Sitemaps
    console.log('\n--- Registered Sitemaps ---');
    const sitemapsRes = await fetchGoogleApi(`https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps`, token);
    const sitemaps = sitemapsRes.data?.sitemap || [];
    if (sitemaps.length) {
      for (const sm of sitemaps) {
        console.log(` • ${sm.path}`);
        console.log(`   Submitted: ${sm.lastSubmitted || 'N/A'} | Pending: ${sm.isPending ?? false} | Errors: ${sm.errors || 0}`);
      }
    } else {
      console.log(' No sitemaps found.');
    }

    // 3. Query Search Analytics
    console.log('\n--- Recent Search Analytics (Last 30 Days) ---');
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const analyticsRes = await fetchGoogleApi(
      `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`,
      token,
      {
        method: 'POST',
        body: {
          startDate,
          endDate,
          dimensions: ['query'],
          rowLimit: 10
        }
      }
    );

    if (analyticsRes.data?.rows?.length) {
      console.log('Top Queries:');
      for (const row of analyticsRes.data.rows) {
        console.log(` - "${row.keys.join(', ')}": ${row.clicks} clicks, ${row.impressions} impressions, avg pos ${row.position.toFixed(1)}`);
      }
    } else {
      console.log('No recent query data available.');
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
