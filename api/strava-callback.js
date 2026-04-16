const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const CLIENT_ID = '203804';
const CLIENT_SECRET = '4da1587c84fffb58fada71529b856825a4da9ddd';

export default async function handler(req, res) {
    const { code, state: userId, error } = req.query;

    if (error) {
        return res.redirect(`/profile.html?strava=error&msg=${encodeURIComponent(error)}`);
    }

    if (!code || !userId) {
        return res.redirect('/profile.html?strava=error&msg=Missing+code+or+user+ID');
    }

    try {
        const tokenRes = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code'
            })
        });

        const data = await tokenRes.json();

        if (data.errors) {
            return res.redirect('/profile.html?strava=error&msg=Token+exchange+failed');
        }

        const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/stride_users?id=eq.${userId}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                strava_id: data.athlete.id.toString(),
                strava_access_token: data.access_token,
                strava_refresh_token: data.refresh_token,
                strava_expiry: data.expires_at
            })
        });

        res.redirect('/profile.html?strava=success');
    } catch (err) {
        res.redirect(`/profile.html?strava=error&msg=${encodeURIComponent(err.message)}`);
    }
}
