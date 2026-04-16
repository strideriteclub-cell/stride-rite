// --- PWA SERVICE WORKER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW error:', e));
    });
}

// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

function calculateAge(birthdate) {
    if (!birthdate) return '?';
    const birth = new Date(birthdate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
}

// --- API HELPERS ---
async function dbGet(table, query = 'select=*') {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (e) { console.error(`Error:`, e); return []; }
}

async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: defaultHeaders, body: JSON.stringify(data) });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (e) { return null; }
}

async function dbUpdate(table, matchColumn, matchValue, data) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, { method: 'PATCH', headers: defaultHeaders, body: JSON.stringify(data) });
        return true;
    } catch (e) { return false; }
}

const KEYS = { SESSION: "stride_current_user" };

// --- AUTH LOGIC ---
const AuthService = {
    login: async (email, password) => {
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            const adminUser = { id: 'admin-1', name: 'Admin Haleem', email: 'tsmhaleem@gmail.com', is_admin: true };
            localStorage.setItem(KEYS.SESSION, JSON.stringify(adminUser));
            return true;
        }
        const users = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}`);
        if (users && users.length > 0) {
            localStorage.setItem(KEYS.SESSION, JSON.stringify(users[0]));
            return true;
        }
        return false;
    },
    logout: () => {
        localStorage.removeItem(KEYS.SESSION);
        window.location.href = 'index.html';
    },
    getCurrentUser: () => JSON.parse(localStorage.getItem(KEYS.SESSION))
};

// --- CORE APP LOGIC ---
const AppService = {
    getRuns: async () => {
        const runs = await dbGet('stride_runs');
        return runs ? runs.filter(r => !r.date_label.includes('[EXPORTED]')) : [];
    },
    registerForRun: async (runId, distance, level) => {
        const user = AuthService.getCurrentUser();
        const reg = { id: crypto.randomUUID(), run_id: runId, user_id: user.id, distance, level, registered_at: new Date() };
        return await dbInsert('stride_registrations', reg) !== null;
    },
    getUserStats: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return { totalRuns: regs.length, totalKms: (regs.length * 5).toFixed(1) };
    },
    // --- VIP SHOP ---
    getShopItems: async () => await dbGet('shop_items', 'is_active=eq.true'),
    submitOrder: async (itemId, size, ref, phone) => {
        const user = AuthService.getCurrentUser();
        const order = { id: crypto.randomUUID(), user_id: user.id, item_id: itemId, size, receipt_ref: ref, phone_number: phone, status: 'pending' };
        return await dbInsert('shop_orders', order) !== null;
    }
};

window.AuthService = AuthService; window.AppService = AppService;
