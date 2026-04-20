/* --- CORE CONFIGURATION --- */
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

const KEYS = { SESSION: "stride_user" };

/* --- BASE UTILITIES --- */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}
function calculateAge(b) {
    if(!b) return '?';
    const birth = new Date(b), now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    return age;
}
function parseIgHandle(raw) {
    if (!raw) return null;
    try { const url = new URL(raw); return url.pathname.split('/').filter(Boolean)[0] || null; }
    catch (_) { return raw.replace(/^@/, '').trim() || null; }
}

/* --- DATABASE SERVICES --- */
async function dbGet(table, query = 'select=*') {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        return res.ok ? await res.json() : [];
    } catch (e) { return []; }
}
async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST', headers: defaultHeaders, body: JSON.stringify(data)
        });
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}
async function dbUpdate(table, mCol, mVal, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${mCol}=eq.${mVal}`, {
            method: 'PATCH', headers: defaultHeaders, body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) { return false; }
}

/* --- AUTH SERVICE --- */
const AuthService = {
    login: async (email, password) => {
        let user = null;
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            user = { id: 'admin-1', name: 'Admin Haleem', email: 'tsmhaleem@gmail.com', is_admin: true };
        } else {
            const rows = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}`);
            if (rows.length > 0) user = rows[0];
        }
        if (user) {
            if (!user.bib_number) user = await AppService.assignBibNumber(user.id);
            localStorage.setItem(KEYS.SESSION, JSON.stringify(user));
            return true;
        }
        return false;
    },
    getCurrentUser: () => {
        try { return JSON.parse(localStorage.getItem(KEYS.SESSION)); } catch(e) { return null; }
    },
    logout: () => { localStorage.removeItem(KEYS.SESSION); window.location.href = 'index.html'; }
};

/* --- APP SERVICE --- */
const AppService = {
    assignBibNumber: async (uid) => {
        const users = await dbGet('stride_users', 'select=bib_number&order=bib_number.desc&limit=1');
        const nextBib = ((users[0] && users[0].bib_number) || 99) + 1;
        await dbUpdate('stride_users', 'id', uid, { bib_number: nextBib });
        const updated = await dbGet('stride_users', `id=eq.${uid}`);
        return updated[0] || { bib_number: nextBib };
    },
    getRuns: async () => {
        const rows = await dbGet('stride_runs'), now = new Date(), valid = [];
        for (const r of rows) {
            if (!r.date_label || r.date_label.includes('[EXPORTED]')) continue;
            const parts = r.date_label.split('||'), runDate = parts[1] ? new Date(parts[1]) : null;
            if (runDate && runDate < now) continue;
            r.date_label = parts[0]; r.iso_date = parts[1];
            valid.push(r);
        }
        return valid.sort((a,b) => new Date(a.iso_date) - new Date(b.iso_date));
    },
    getUserRegistrations: async (uid) => {
        const rows = await dbGet('stride_registrations', `user_id=eq.${uid}`);
        return rows.map(r => r.run_id);
    },
    getUserStats: async (uid) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${uid}`);
        const tour = await AppService.getTourProgress(uid);
        let kms = 0;
        regs.forEach(r => { if(r.distance) kms += parseFloat(r.distance) || 0; });
        return { totalRuns: regs.length, totalKms: kms.toFixed(1), completionRate: Math.round((tour.filter(s => s.status === 'completed').length / 8) * 100), tourProgress: tour, pastRuns: [] };
    },
    getTourProgress: async (uid) => {
        const raw = await dbGet('stride_runs'), regs = await dbGet('stride_registrations', `user_id=eq.${uid}`), now = new Date();
        const config = [
            { id: 1, name: 'Al Rehab', lat: 30.065846, lng: 31.504127, small: true },
            { id: 2, name: 'Madinaty', lat: 30.101, lng: 31.646, up: true },
            { id: 3, name: 'New Administrative Capital', lat: 30.013, lng: 31.800, left: true },
            { id: 4, name: 'New Cairo', lat: 30.025, lng: 31.462 },
            { id: 5, name: 'Zamalek', lat: 30.062, lng: 31.222 },
            { id: 6, name: 'Maadi', lat: 29.959, lng: 31.250 },
            { id: 7, name: 'Giza', lat: 29.987, lng: 31.141 },
            { id: 8, name: 'Heliopolis', lat: 30.089, lng: 31.319, up: true }
        ];
        return config.map(stop => {
            const stopRuns = raw.filter(r => Number(r.tour_stop_id) === stop.id);
            let status = 'locked', runId = null;
            for (const r of stopRuns) {
                const rDate = r.iso_date ? new Date(r.iso_date) : null;
                const isReg = regs.find(reg => reg.run_id === r.id);
                if (isReg && (r.date_label.includes('[EXPORTED]') || (rDate && rDate < now))) { status = 'completed'; runId = r.id; break; }
                if (isReg && rDate && rDate >= now) { status = 'unlocked'; runId = r.id; continue; }
                if (rDate && rDate >= now && status === 'locked') { status = 'active'; runId = r.id; }
            }
            return { ...stop, status, runId };
        });
    },
    checkInRunner: async (runId, identifier) => {
        let reg = null;
        if (identifier.length > 20) {
            const rows = await dbGet('stride_registrations', `id=eq.${identifier}`);
            if (rows.length > 0) reg = rows[0];
        } else {
            const users = await dbGet('stride_users', `bib_number=eq.${identifier}`);
            if (users.length > 0) {
                const rs = await dbGet('stride_registrations', `run_id=eq.${runId}&user_id=eq.${users[0].id}`);
                if (rs.length > 0) reg = rs[0];
            }
        }
        if (!reg) throw new Error("Not found or not registered.");
        if (reg.attended_at) throw new Error("Already checked in.");
        await dbUpdate('stride_registrations', 'id', reg.id, { attended_at: new Date().toISOString() });
        const user = (await dbGet('stride_users', `id=eq.${reg.user_id}`))[0];
        return { name: user.name, bib: user.bib_number, time: new Date().toLocaleTimeString() };
    },
    getAttendanceList: async (runId) => {
        const regs = await dbGet('stride_registrations', `run_id=eq.${runId}&attended_at=not.is.null`), users = await dbGet('stride_users');
        return regs.map(r => {
            const u = users.find(user => user.id === r.user_id);
            return { name: u ? u.name : 'Unknown', bib: u ? u.bib_number : '—', time: new Date(r.attended_at).toLocaleTimeString() };
        }).sort((a,b) => b.time.localeCompare(a.time));
    }
};

/* --- MOBILE MENU --- */
function initMobileMenu(user) {
    const navbar = document.querySelector('.navbar'), navLinks = document.querySelector('.nav-links');
    if (!navbar || !navLinks) return;
    const btn = document.createElement('button');
    btn.className = 'hamburger-btn';
    btn.innerHTML = '<span></span><span></span><span></span>';
    navbar.appendChild(btn);
    const overlay = document.createElement('div');
    overlay.className = 'mobile-nav-overlay';
    document.body.appendChild(overlay);
    const panel = document.createElement('nav');
    panel.className = 'mobile-nav-panel';
    let linksHtml = navLinks.innerHTML;
    if (user && user.email === 'tsmhaleem@gmail.com') {
        linksHtml = '<a href="admin-scanner.html" style="color:var(--peach-accent); font-weight:800;">📡 Admin Scan</a>' + linksHtml;
    }
    panel.innerHTML = linksHtml;
    document.body.appendChild(panel);
    const toggle = () => { [btn, overlay, panel].forEach(el => el.classList.toggle('open')); };
    btn.onclick = toggle; overlay.onclick = toggle;
    panel.querySelectorAll('a').forEach(a => a.onclick = toggle);
}

document.addEventListener('DOMContentLoaded', () => initMobileMenu(AuthService.getCurrentUser()));

/* --- GLOBAL EXPOSURE --- */
window.AuthService = AuthService;
window.AppService = AppService;
window.parseIgHandle = parseIgHandle;
