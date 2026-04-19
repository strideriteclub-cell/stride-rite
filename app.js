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
        if (!res.ok) {
            const errBody = await res.text();
            console.error(`DB Insert Error (${table}):`, errBody);
            window.lastDbError = errBody; // Expose for UI
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

async function dbDelete(table, matchColumn, matchValue) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, {
            method: 'DELETE', headers: defaultHeaders
        });
        if (!res.ok) throw new Error(await res.text());
        return true;
    } catch (e) {
        console.error(`Error deleting from ${table}:`, e);
        return false;
    }
}

const KEYS = { SESSION: "stride_current_user" };

// --- AUTH LOGIC ---
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
            localStorage.setItem(KEYS.SESSION, JSON.stringify(userRecord));
            // Sync to DB to ensure FKs work
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
            name, email, password,
            birthdate,
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

const TOUR_STOPS_COUNT = 8;
const TOUR_CONFIG = [
    { id: 1, name: 'Al Rehab',    lat: 30.062, lng: 31.594, small: true },
    { id: 2, name: 'Madinaty',    lat: 30.101, lng: 31.646, up: true },
    { id: 3, name: 'New Administrative Capital', lat: 30.013, lng: 31.800, left: true },
    { id: 4, name: 'New Cairo',   lat: 30.025, lng: 31.462 },
    { id: 5, name: 'Zamalek',     lat: 30.062, lng: 31.222 },
    { id: 6, name: 'Maadi',       lat: 29.959, lng: 31.250 },
    { id: 7, name: 'Giza',        lat: 29.987, lng: 31.141 },
    { id: 8, name: 'Heliopolis',  lat: 30.089, lng: 31.319, up: true, path: [
        [29.987, 31.141], [30.025, 31.160], [30.055, 31.185], [30.080, 31.205],
        [30.095, 31.222], [30.098, 31.245], [30.095, 31.275], [30.089, 31.319]
    ]}
];

// --- APP SERVICE ---
const AppService = {
    getRuns: async () => {
        const rawRuns = await dbGet('stride_runs');
        if (!rawRuns || rawRuns.length === 0) return [];
        const now = new Date();
        const validRuns = [];
        
        for (const run of rawRuns) {
            if (run.date_label.includes('[EXPORTED]')) continue;
            if (run.date_label && run.date_label.includes('||')) {
                const parts = run.date_label.split('||');
                const runDate = new Date(parts[1]);
                if (runDate < now) {
                    AppService.handleExpiredRun(run.id, parts[0]);
                    continue;
                }
                run.date_label = parts[0];
                run.iso_date = parts[1]; // Store for sorting
            } else {
                continue; // Skip runs without a valid ISO part
            }
            validRuns.push(run);
        }

        // Sort chronologically ascending
        return validRuns.sort((a, b) => new Date(a.iso_date) - new Date(b.iso_date));
    },

    handleExpiredRun: async (runId, displayLabel) => {
        if (displayLabel.includes('[EXPORTED]')) return;
        const verify = await dbGet('stride_runs', `id=eq.${runId}`);
        if (!verify || verify.length === 0) return;
        const participants = await AppService.getParticipantsForRun(runId);
        if (participants.length === 0) {
            await dbUpdate('stride_runs', 'id', runId, { date_label: `[EXPORTED] ${displayLabel}` });
            return;
        }
        let csvContent = "Name,Email,Age,Gender,Distance,Level,Registration Timestamp\n";
        participants.forEach(p => {
            csvContent += `"${p.name}","${p.email}","${p.age}","${p.gender}","${p.distance}","${p.level}","${new Date(p.registeredAt).toLocaleString()}"\n`;
        });
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', new Blob([csvContent], { type: 'text/csv' }), `Run_Export_${displayLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
        formData.append('caption', `🏁 Auto-Export: ${displayLabel}`);
        try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: formData });
            if (res.ok) {
                await dbUpdate('stride_runs', 'id', runId, { date_label: `[EXPORTED] ${displayLabel}` });
            }
        } catch (e) { console.error("AutoExport failed", e); }
    },

    registerForRun: async (runId, distance, level) => {
        const currentUser = AuthService.getCurrentUser();
        if (!currentUser) return false;
        const existing = await dbGet('stride_registrations', `run_id=eq.${runId}&user_id=eq.${currentUser.id}`);
        if (existing && existing.length > 0) return false;
        const allRegs = await dbGet('stride_registrations', `user_id=eq.${currentUser.id}`);
        const isFirstTimer = !allRegs || allRegs.length === 0;
        const newRegistration = {
            id: generateUUID(),
            run_id: runId,
            user_id: currentUser.id,
            distance: distance,
            level: level
        };
        const result = await dbInsert('stride_registrations', newRegistration);
        if (result !== null) {
            const runDetails = await dbGet('stride_runs', `id=eq.${runId}`);
            if (runDetails && runDetails.length > 0) {
                AppService.sendTelegramAlert(currentUser, distance, level, runDetails[0], isFirstTimer);
            }
            return true;
        }
        return false;
    },

    sendTelegramAlert: async (user, distance, level, run, isFirstTimer = false) => {
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const cleanTimestamp = run.date_label.split('||')[0];
        const age = user.birthdate ? calculateAge(user.birthdate) : (user.age || '?');
        const firstTimerBadge = isFirstTimer ? '\n\n🎉 *FIRST TIMER! Welcome them warmly!*' : '';
        const text = `${isFirstTimer ? '🌟' : '🚨'} *${isFirstTimer ? 'First-Time' : 'New'} Runner Alert!*\n\n*${user.name}* (${age}${user.gender === 'Male' ? 'M' : 'F'}) just registered for the *${distance}*!\n📧 *Email:* ${user.email}\n🏃 *Level:* ${level || user.level}\n📅 *Run:* ${cleanTimestamp}${firstTimerBadge}`;
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
            });
        } catch (e) { console.error('Telegram alert failed', e); }
    },

    getUserRegistrations: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return regs.map(r => r.run_id);
    },

    getParticipantsForRun: async (runId) => {
        const regs = await dbGet('stride_registrations', `run_id=eq.${runId}`);
        const users = await dbGet('stride_users');
        return regs.map(r => {
            const user = users.find(u => u.id === r.user_id);
            return {
                name: user ? user.name : 'Unknown',
                email: user ? user.email : 'Unknown',
                age: user ? (user.age || 'N/A') : 'N/A',
                gender: user ? (user.gender || 'N/A') : 'N/A',
                distance: r.distance || 'N/A',
                level: r.level || (user ? user.level : 'N/A'),
                registeredAt: r.registered_at
            };
        });
    },

    getPastUserRuns: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        if (!regs || regs.length === 0) return [];
        const allRuns = await dbGet('stride_runs');
        return regs.map(reg => {
            const run = allRuns.find(r => r.id === reg.run_id);
            if (!run) return null;
            const isExported = run.date_label.includes('[EXPORTED]');
            return {
                ...run,
                date_display: run.date_label.replace('[EXPORTED] ', '').split('||')[0],
                user_distance: reg.distance,
                user_level: reg.level,
                is_completed: isExported
            };
        }).filter(r => r !== null && r.is_completed);
    },

    getTourProgress: async (userId) => {
        const rawRuns = await dbGet('stride_runs');
        const userRegs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        
        // Filter to current month tour stops
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const progress = TOUR_CONFIG.map(stop => {
            const runForStop = (rawRuns || []).find(r => {
                if (!r.tour_stop_id || Number(r.tour_stop_id) !== Number(stop.id)) return false;
                const dateStr = r.iso_date || (r.date_label && r.date_label.includes('||') ? r.date_label.split('||')[1] : null);
                if (!dateStr) return false;
                const runDate = new Date(dateStr);
                return runDate.getMonth() === currentMonth && runDate.getFullYear() === currentYear;
            });

            const registration = runForStop ? userRegs.find(reg => reg.run_id === runForStop.id) : null;

            return {
                ...stop,
                status: registration ? 'unlocked' : (runForStop ? 'active' : 'locked'),
                runId: runForStop ? runForStop.id : null
            };
        });

        return progress;
    },

    getUserStats: async (userId) => {
        const pastRuns = await AppService.getPastUserRuns(userId);
        let totalKms = 0;
        pastRuns.forEach(run => {
            const distStr = run.user_distance || '0K';
            const num = parseFloat(distStr.replace(/[^\d.]/g, ''));
            if (!isNaN(num)) totalKms += num;
        });

        const tourProgress = await AppService.getTourProgress(userId);
        const unlockedCount = tourProgress.filter(s => s.status === 'unlocked').length;

        return {
            totalRuns: pastRuns.length,
            totalKms: totalKms.toFixed(1),
            pastRuns: pastRuns,
            tourProgress: tourProgress,
            completionRate: Math.round((unlockedCount / TOUR_STOPS_COUNT) * 100)
        };
    },

    // --- SHOP ---
    getShopStatus: async () => {
        const settings = await dbGet('shop_settings');
        if (settings && settings.length > 0) return settings[0].is_open;
        return false;
    },

    getShopItems: async () => {
        const items = await dbGet('shop_items', 'is_active=eq.true');
        return items || [];
    },
    submitOrder: async (itemId, size, refNumber, phone, paymentMethod, screenshotFile) => {
        const currentUser = AuthService.getCurrentUser();
        if (!currentUser) return false;

        const newOrder = {
            id: generateUUID(),
            user_id: currentUser.id,
            item_id: itemId,
            size: size,
            payment_method: paymentMethod || 'InstaPay/Telda',
            payment_detail: refNumber,
            phone_number: phone,
            status: 'pending'
        };

        console.log("Saving order to database...", newOrder);
        let result = await dbInsert('shop_orders', newOrder);

        // Handle common schema fallback
        if (result === null && window.lastDbError && window.lastDbError.includes('receipt_ref')) {
            const fallbackOrder = { ...newOrder, receipt_ref: refNumber };
            result = await dbInsert('shop_orders', fallbackOrder);
        }

        if (result !== null) {
            const items = await dbGet('shop_items', `id=eq.${itemId}`);
            const item = (items && items.length > 0) ? items[0] : { name: 'Unknown Item', price: '?' };

            const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
            const chatId = '1538316434';

            const caption = `🛍️ *NEW ORDER: ${item.name}*\n\n👤 *Customer:* ${currentUser.name}\n📧 *Email:* ${currentUser.email}\n📞 *Phone:* ${phone}\n📏 *Size:* ${size}\n💰 *Price:* ${item.price} EGP\n\n💳 *Method:* ${paymentMethod}\n🔢 *${paymentMethod} Ref:* \`${refNumber}\`\n\n👇 *Review and Approve:*`;

            const replyMarkup = JSON.stringify({
                inline_keyboard: [[
                    { text: "✅ Approve", callback_data: `shop_appr_${newOrder.id}` },
                    { text: "❌ Reject", callback_data: `shop_rej_${newOrder.id}` }
                ]]
            });

            try {
                if (screenshotFile) {
                    const formData = new FormData();
                    formData.append('chat_id', chatId);
                    formData.append('photo', screenshotFile);
                    formData.append('caption', caption);
                    formData.append('parse_mode', 'Markdown');
                    formData.append('reply_markup', replyMarkup);

                    await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                        method: 'POST',
                        body: formData
                    });
                } else {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'Markdown', reply_markup: JSON.parse(replyMarkup) })
                    });
                }
            } catch (e) {
                console.error("Telegram alert failed", e);
            }
            return true;
        }
        return false;
    }
};

const Utils = {
    animateNumber: (el, start, end, duration = 1000) => {
        if (!el) return;
        let s = null;
        const step = (t) => {
            if (!s) s = t;
            const p = Math.min((t - s) / duration, 1);
            el.innerText = Math.floor(p * (end - start) + start);
            if (p < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }
};

// --- HAMBURGER MENU ---
document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.querySelector('.navbar');
    const navLinks = document.querySelector('.nav-links');
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
    panel.innerHTML = navLinks.innerHTML;
    document.body.appendChild(panel);
    const toggle = () => {
        [btn, overlay, panel].forEach(el => el.classList.toggle('open'));
        document.body.style.overflow = btn.classList.contains('open') ? 'hidden' : '';
    };
    btn.onclick = toggle;
    overlay.onclick = toggle;
    panel.querySelectorAll('a').forEach(a => a.onclick = toggle);
});

// Global Exposure
window.AuthService = AuthService;
window.AppService = AppService;
window.Utils = Utils;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
window.defaultHeaders = defaultHeaders;
