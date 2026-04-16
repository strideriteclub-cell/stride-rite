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

// --- API HELPERS ---
async function dbGet(table, query = 'select=*') {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (e) {
        console.error(`Error fetching ${table}:`, e);
        return [];
    }
}

async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: defaultHeaders,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (e) {
        console.error(`Error inserting into ${table}:`, e);
        return null;
    }
}

async function dbUpdate(table, matchColumn, matchValue, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, {
            method: 'PATCH',
            headers: defaultHeaders,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return true;
    } catch (e) {
        console.error(`Error updating ${table}:`, e);
        return false;
    }
}

async function dbDelete(table, matchColumn, matchValue) { 
    try { 
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, { method: "DELETE", headers: defaultHeaders }); 
        if (!res.ok) throw new Error(await res.text()); return true; 
    } catch (e) { console.error(`Error deleting from ${table}:`, e); return false; } 
}

const KEYS = { SESSION: "stride_current_user" };

// --- AUTH LOGIC ---
const AuthService = {
    login: async (email, password) => {
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            const adminUser = {
                id: 'd1b11111-1111-1111-1111-111111111111', // FIXED UUID
                name: 'Admin Haleem',
                email: 'tsmhaleem@gmail.com',
                is_admin: true
            };
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

    register: async (name, email, password, birthdate, gender, level) => {
        const existing = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}`);
        if (existing && existing.length > 0) return false;

        const newUser = { 
            id: crypto.randomUUID(), 
            name, email, password, 
            birthdate, gender, level, is_admin: false 
        };
        
        const inserted = await dbInsert('stride_users', newUser);
        if (inserted) {
            localStorage.setItem(KEYS.SESSION, JSON.stringify(newUser));
            return true;
        }
        return false;
    },

    logout: () => {
        localStorage.removeItem(KEYS.SESSION);
        window.location.href = 'index.html';
    },

    getCurrentUser: () => {
        return localStorage.getItem(KEYS.SESSION) ? JSON.parse(localStorage.getItem(KEYS.SESSION)) : null;
    }
};

// --- RUNS LOGIC ---
const AppService = {
    getRuns: async () => {
        const rawRuns = await dbGet('stride_runs');
        if (!rawRuns || rawRuns.length === 0) return [];
        return rawRuns.filter(r => !r.date_label.includes('[EXPORTED]'));
    },
    
    registerForRun: async (runId, distance, level) => {
        const currentUser = AuthService.getCurrentUser();
        if(!currentUser) return false;
        const newRegistration = {
            id: crypto.randomUUID(),
            run_id: runId,
            user_id: currentUser.id,
            distance: distance,
            level: level,
            registered_at: new Date().toISOString()
        };
        return await dbInsert('stride_registrations', newRegistration) !== null;
    },

    getPastUserRuns: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        if (!regs || regs.length === 0) return [];
        const allRuns = await dbGet('stride_runs');
        
        return regs.map(reg => {
            const run = allRuns.find(r => r.id === reg.run_id);
            if (!run || !run.date_label.includes('[EXPORTED]')) return null;
            return {
                ...run,
                date_display: run.date_label.replace('[EXPORTED] ', '').split('||')[0],
                user_distance: reg.distance,
                user_level: reg.level,
                is_completed: true
            };
        }).filter(r => r !== null);
    },

    getUserStats: async (userId) => {
        const pastRuns = await AppService.getPastUserRuns(userId);
        let totalKms = 0;
        pastRuns.forEach(run => {
            const num = parseFloat(run.user_distance.replace(/[^\d.]/g, ''));
            if (!isNaN(num)) totalKms += num;
        });
        return {
            totalRuns: pastRuns.length,
            totalKms: totalKms.toFixed(1),
            pastRuns: pastRuns
        };
    },

    getUserRegistrations: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return regs.map(r => r.run_id);
    }
};

window.AuthService = AuthService;
window.AppService = AppService;
