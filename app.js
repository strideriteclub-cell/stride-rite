// --- SUPABASE CONFIGURATION ---
// Deployment Heartbeat: 2026-04-17T22:19:00Z (Restoration V4.2)
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
window.supabaseClient = supabase;

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- API HELPERS ---
async function dbGet(table, query = 'select=*') {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (e) { console.error(`Fetch ${table} failed`, e); return []; }
}

async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST', headers: defaultHeaders, body: JSON.stringify(data)
        });
        return res.ok ? await res.json() : null;
    } catch (e) { console.error(`Insert ${table} failed`, e); return null; }
}

// --- SERVICES ---
const AuthService = {
    getCurrentUser: () => JSON.parse(localStorage.getItem('stride_current_user')),
    login: async (email, password) => {
        const users = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}`);
        if (users && users.length > 0) {
            localStorage.setItem('stride_current_user', JSON.stringify(users[0]));
            return true;
        }
        return false;
    },
    logout: () => {
        localStorage.removeItem('stride_current_user');
        window.location.href = 'index.html';
    }
};

const AppService = {
    getUpcomingRuns: async () => {
        const runs = await dbGet('stride_runs');
        return (runs || []).filter(r => !r.date_label.includes('[EXPORTED]'));
    },
    registerForRun: async (runId, dist, level) => {
        const user = AuthService.getCurrentUser();
        if (!user) return false;
        return await dbInsert('stride_registrations', {
            id: generateUUID(), user_id: user.id, run_id: runId, distance: dist, level: level
        });
    }
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Stride Rite V4.2 Initialized");
    const runsContainer = document.getElementById('upcoming-runs-grid');
    if (runsContainer) {
        const runs = await AppService.getUpcomingRuns();
        if (runs.length === 0) {
            runsContainer.innerHTML = '<p style="color:#888; grid-column:1/-1; text-align:center;">No upcoming runs found.</p>';
        } else {
            runsContainer.innerHTML = runs.map(r => `
                <div class="card run-card">
                    <h4>${r.date_label.split('||')[0]}</h4>
                    <p>📍 ${r.location}</p>
                    <button class="btn btn-primary" onclick="window.location.href='dashboard.html?run=${r.id}'">View Details</button>
                </div>
            `).join('');
        }
        const section = document.getElementById('upcoming-runs-section');
        if (section) section.style.display = 'block';
    }
});

// Global exposure
window.AuthService = AuthService;
window.AppService = AppService;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
