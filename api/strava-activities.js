const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const CLIENT_ID = '203804';
const CLIENT_SECRET = '4da1587c84fffb58fada71529b856825a4da9ddd';

export default async function handler(req, res) {
    const { userId } = req.query;
    if (!userId) return res.status(400).end();

    try {
        const userRes = await fetch(`${SUPABASE_URL}/rest/v1/stride_users?id=eq.${userId}&select=*`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }});
        const users = await userRes.json();
        if (!users[0]?.strava_access_token) return res.status(404).end();

        let { strava_access_token, strava_refresh_token, strava_expiry } = users[0];

        if (Math.floor(Date.now()/1000) > (strava_expiry - 300)) {
            const ref = await fetch('https://www.strava.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: strava_refresh_token, grant_type: 'refresh_token' })
            });
            const d = await ref.json();
            strava_access_token = d.access_token;
            await fetch(`${SUPABASE_URL}/rest/v1/stride_users?id=eq.${userId}`, {
                method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ strava_access_token, strava_refresh_token: d.refresh_token, strava_expiry: d.expires_at })
            });
        }

        const act = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', { headers: { 'Authorization': `Bearer ${strava_access_token}` }});
        const list = await act.json();
        res.status(200).json(list.filter(a => a.type === 'Run'));
    } catch (e) { res.status(500).end(); }
}
