const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const CLIENT_ID = '203804';
const CLIENT_SECRET = '4da1587c84fffb58fada71529b856825a4da9ddd';

export default async function handler(req, res) {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
        const userRes = await fetch(`${SUPABASE_URL}/rest/v1/stride_users?id=eq.${userId}&select=strava_access_token,strava_refresh_token,strava_expiry`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const users = await userRes.json();
        if (!users || users.length === 0 || !users[0].strava_access_token) {
            return res.status(404).json({ error: 'Strava not connected' });
        }

        let { strava_access_token, strava_refresh_token, strava_expiry } = users[0];
        const nowSec = Math.floor(Date.now() / 1000);

        if (nowSec > (strava_expiry - 300)) {
            const refreshRes = await fetch('https://www.strava.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
                    refresh_token: strava_refresh_token, grant_type: 'refresh_token'
                })
            });
            const refreshedData = await refreshRes.json();
            if (refreshedData.access_token) {
                strava_access_token = refreshedData.access_token;
                strava_expiry = refreshedData.expires_at;
                await fetch(`${SUPABASE_URL}/rest/v1/stride_users?id=eq.${userId}`, {
                    method: 'PATCH',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ strava_access_token, strava_refresh_token: refreshedData.refresh_token, strava_expiry })
                });
            }
        }

        const activitiesRes = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', {
            headers: { 'Authorization': `Bearer ${strava_access_token}` }
        });
        const activities = await activitiesRes.json();
        res.status(200).json(activities.filter(a => a.type === 'Run'));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
