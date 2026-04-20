// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function calculateAge(birthdate) {
    if (!birthdate) return '?';
    const birth = new Date(birthdate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
}

function parseIgHandle(raw) {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts[0] || null;
    } catch (_) {
        return raw.replace(/^@/, '').trim() || null;
    }
}

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
        if (!res.ok) {
            const errBody = await res.text();
            console.error(`DB Insert Error (${table}):`, errBody);
            throw new Error(errBody);
        }
        if (res.status === 201) {
            const result = await res.json();
            return Array.isArray(result) ? result[0] : (result || true);
        }
        return true;
    } catch (e) {
        console.error(`Catch inserting into ${table}:`, e);
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

const KEYS = { SESSION: "stride_user" };

const AuthService = {
    login: async (email, password) => {
        let userRecord = null;
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            userRecord = { id: 'admin-1', name: 'Admin Haleem', email: 'tsmhaleem@gmail.com', is_admin: true };
        } else {
            const users = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}`);
            if (users && users.length > 0) userRecord = users[0];
        }

        if (userRecord) {
            if (!userRecord.bib_number) {
                userRecord = await AppService.assignBibNumber(userRecord.id);
            }
            localStorage.setItem(KEYS.SESSION, JSON.stringify(userRecord));
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/stride_users`, {
                    method: 'POST',
                    headers: { ...defaultHeaders, 'Prefer': 'resolution=merge-duplicates' },
                    body: JSON.stringify(userRecord)
                });
            } catch (e) { console.error("User sync failed", e); }
            return true;
        }
        return false;
    },

    register: async (name, email, password, birthdate, gender, level) => {
        const existing = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}`);
        if (existing && existing.length > 0) return false;
        const newUser = {
            id: generateUUID(),
            name, email, password, birthdate,
            age: calculateAge(birthdate),
            gender, level, is_admin: false
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

const DEFAULT_TOUR_CONFIG = [
    { id: 1, name: 'Al Rehab',    lat: 30.065846, lng: 31.504127, small: true },
    { id: 2, name: 'Madinaty',    lat: 30.101, lng: 31.646, up: true },
    { id: 3, name: 'New Administrative Capital', lat: 30.013, lng: 31.800, left: true },
    { id: 4, name: 'New Cairo',   lat: 30.025, lng: 31.462 },
    { id: 5, name: 'Zamalek',     lat: 30.062, lng: 31.222 },
    { id: 6, name: 'Maadi',       lat: 29.959, lng: 31.250 },
    { id: 7, name: 'Giza',        lat: 29.987, lng: 31.141 },
    { id: 8, name: 'Heliopolis',  lat: 30.089, lng: 31.319, up: true }
];

const AppService = {
    assignBibNumber: async (userId) => {
        const users = await dbGet('stride_users', 'select=bib_number&order=bib_number.desc&limit=1');
        const maxBib = (users && users.length > 0) ? (users[0].bib_number || 99) : 99;
        const nextBib = maxBib + 1;
        await dbUpdate('stride_users', 'id', userId, { bib_number: nextBib });
        const updated = await dbGet('stride_users', `id=eq.${userId}`);
        return updated[0];
    },

    getRuns: async () => {
        const rawRuns = await dbGet('stride_runs');
        if (!rawRuns || rawRuns.length === 0) return [];
        const now = new Date();
        const validRuns = [];
        for (const run of rawRuns) {
            if (!run.date_label || run.date_label.includes('[EXPORTED]')) continue;
            const parts = run.date_label.split('||');
            const runDate = parts[1] ? new Date(parts[1]) : null;
            if (runDate && runDate < now) continue;
            run.date_label = parts[0];
            run.iso_date = parts[1];
            validRuns.push(run);
        }
        return validRuns.sort((a, b) => new Date(a.iso_date) - new Date(b.iso_date));
    },

    registerForRun: async (runId, distance, level, fullName, phoneNumber) => {
        const currentUser = AuthService.getCurrentUser();
        if (!currentUser) return false;
        const newRegistration = {
            id: generateUUID(),
            run_id: runId,
            user_id: currentUser.id,
            distance: distance,
            level: level,
            user_full_name: fullName || currentUser.name,
            phone_number: phoneNumber || null,
            registered_at: new Date().toISOString()
        };
        return await dbInsert('stride_registrations', newRegistration);
    },

    checkInRunner: async (runId, identifier) => {
        let reg = null;
        if (identifier.length > 20) {
            const rows = await dbGet('stride_registrations', `id=eq.${identifier}`);
            if (rows && rows.length > 0) reg = rows[0];
        } else {
            const users = await dbGet('stride_users', `bib_number=eq.${identifier}`);
            if (users && users.length > 0) {
                const regs = await dbGet('stride_registrations', `run_id=eq.${runId}&user_id=eq.${users[0].id}`);
                if (regs && regs.length > 0) reg = regs[0];
            }
        }
        if (!reg) throw new Error("Runner not found or not registered for this stop.");
        if (reg.attended_at) throw new Error("This runner is already checked in!");
        await dbUpdate('stride_registrations', 'id', reg.id, { attended_at: new Date().toISOString() });
        const userInfo = await dbGet('stride_users', `id=eq.${reg.user_id}`);
        return { name: userInfo[0].name, bib: userInfo[0].bib_number, time: new Date().toLocaleTimeString() };
    },

    getAttendanceList: async (runId) => {
        const regs = await dbGet('stride_registrations', `run_id=eq.${runId}&attended_at=not.is.null`);
        const users = await dbGet('stride_users');
        return regs.map(r => {
            const u = users.find(user => user.id === r.user_id);
            return {
                name: u ? u.name : 'Unknown',
                bib: u ? u.bib_number : '—',
                time: new Date(r.attended_at).toLocaleTimeString()
            };
        }).sort((a,b) => b.time.localeCompare(a.time));
    },

    getUserStats: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        const tour = await AppService.getTourProgress(userId);
        let totalKms = 0;
        regs.forEach(r => {
            if (r.distance && r.distance.includes('K')) {
                totalKms += parseFloat(r.distance.replace('K',''));
            }
        });
        return {
            totalRuns: regs.length,
            totalKms: totalKms.toFixed(1),
            completionRate: Math.round((tour.filter(s => s.status === 'completed').length / 8) * 100),
            pastRuns: [], // simplified for bib fix
            tourProgress: tour
        };
    },

    getTourProgress: async (userId) => {
        const rawRuns = await dbGet('stride_runs');
        const userRegs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        const now = new Date();
        return DEFAULT_TOUR_CONFIG.map(stop => {
            const runsForStop = (rawRuns || []).filter(r => r.tour_stop_id && Number(r.tour_stop_id) === Number(stop.id));
            let status = 'locked';
            let runId = null;
            for (const r of runsForStop) {
                const parts = (r.date_label || '').split('||');
                const runDate = parts[1] ? new Date(parts[1]) : null;
                const userRegistered = userRegs.find(reg => reg.run_id === r.id);
                if (userRegistered && (r.date_label.includes('[EXPORTED]') || (runDate && runDate < now))) {
                    status = 'completed'; runId = r.id; break;
                }
                if (userRegistered && runDate && runDate >= now) {
                    status = 'unlocked'; runId = r.id; continue;
                }
                if (runDate && runDate >= now && status === 'locked') {
                    status = 'active'; runId = r.id;
                }
            }
            return { ...stop, status, runId };
        });
    }
};
