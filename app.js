// --- app.js (Full Code) ---
// Paste this entire block into your app.js file on GitHub

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

// Calculate age from a birthdate string
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
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, {
            method: 'DELETE',
            headers: defaultHeaders
        });
        if (!res.ok) throw new Error(await res.text());
        return true;
    } catch (e) {
        console.error(`Error deleting from ${table}:`, e);
        return false;
    }
}

// Session stays local
const KEYS = { SESSION: "stride_current_user" };

// --- AUTH LOGIC ---
const AuthService = {
    login: async (email, password) => {
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            const adminUser = {
                id: 'admin-1',
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

// --- RUNS & REGISTRATIONS LOGIC ---
const AppService = {
    getRuns: async () => {
        const rawRuns = await dbGet('stride_runs');
        if (!rawRuns || rawRuns.length === 0) return [];
        
        const now = new Date();
        const validRuns = [];
        
        for(const run of rawRuns) {
            if (run.date_label.includes('[EXPORTED]')) continue;

            if(run.date_label && run.date_label.includes('||')) {
                const parts = run.date_label.split('||');
                const runDate = new Date(parts[1]);
                
                if(runDate < now) {
                    AppService.handleExpiredRun(run.id, parts[0]);
                    continue; 
                }
                run.date_label = parts[0]; 
            }
            validRuns.push(run);
        }
        return validRuns;
    },
    
    createRun: async (dateLabel, locationName, locationLink, description) => {
        const currentUser = AuthService.getCurrentUser();
        if(!currentUser) return false;

        const newRun = {
            id: crypto.randomUUID(),
            date_label: dateLabel,
            location: locationName || 'Gateway Mall, Al Rehab City',
            location_link: locationLink || 'https://maps.app.goo.gl/tareg62PBaQJVypk7',
            description: description,
            created_by: currentUser.id
        };

        const result = await dbInsert('stride_runs', newRun);
        return result !== null;
    },

    deleteRun: async (runId) => {
        await dbDelete('stride_registrations', 'run_id', runId);
        return await dbDelete('stride_runs', 'id', runId);
    },

    handleExpiredRun: async (runId, displayLabel) => {
        if (displayLabel.includes('[EXPORTED]')) return;

        const verify = await dbGet('stride_runs', `id=eq.${runId}`);
        if(!verify || verify.length === 0) return;

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
        formData.append('document', new Blob([csvContent], {type: 'text/csv'}), `Run_Export_${displayLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
        formData.append('caption', `🏁 Auto-Export: ${displayLabel}`);
        
        try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                await dbUpdate('stride_runs', 'id', runId, { date_label: `[EXPORTED] ${displayLabel}` });
            }
        } catch(e) { console.error("AutoExport failed", e); }
    },

    registerForRun: async (runId, distance, level) => {
        const currentUser = AuthService.getCurrentUser();
        if(!currentUser) return false;

        const existing = await dbGet('stride_registrations', `run_id=eq.${runId}&user_id=eq.${currentUser.id}`);
        if(existing && existing.length > 0) return false;

        const newRegistration = {
            id: crypto.randomUUID(),
            run_id: runId,
            user_id: currentUser.id,
            distance: distance,
            level: level,
            registered_at: new Date().toISOString()
        };

        const result = await dbInsert('stride_registrations', newRegistration);
        if (result !== null) {
            const runDetails = await dbGet('stride_runs', `id=eq.${runId}`);
            if(runDetails && runDetails.length > 0) {
                AppService.sendTelegramAlert(currentUser, distance, level, runDetails[0]);
            }
            return true;
        }
        return false;
    },

    sendTelegramAlert: async (user, distance, level, run) => {
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const cleanTimestamp = run.date_label.split('||')[0];
        const age = user.age || calculateAge(user.birthdate);
        const text = `🚨 *New Runner Alert!*\n\n*${user.name}* (${age}${user.gender === 'Male'?'M':'F'}) just registered for the *${distance}*!\n📧 *Email:* ${user.email}\n🏃 *Level:* ${level || user.level}\n📅 *Run:* ${cleanTimestamp}`;
        
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
            });
        } catch (e) { console.error('Telegram alert failed', e); }
    },

    sendTelegramSuggestion: async (user, text) => {
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const msg = `💡 *New Suggestion!*\n\n*From:* ${user.name}\n📧 *Email:* ${user.email}\n\n*Message:*\n"${text}"`;
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
            });
        } catch (e) { console.error("Telegram suggestion failed", e); }
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

    // --- SHOP LOGIC ---
    getShopStatus: async () => {
        const settings = await dbGet('shop_settings');
        if (settings && settings.length > 0) return settings[0].is_open;
        return false;
    },

    getShopItems: async () => {
        const items = await dbGet('shop_items', 'is_active=eq.true');
        return items || [];
    },

    submitOrder: async (itemId, size, refNumber, phone) => {
        const currentUser = AuthService.getCurrentUser();
        if (!currentUser) return false;
        const newOrder = { id: crypto.randomUUID(), user_id: currentUser.id, item_id: itemId, size, receipt_ref: refNumber, phone_number: phone, status: 'pending' };
        const result = await dbInsert('shop_orders', newOrder);
        if (result !== null) {
            const items = await dbGet('shop_items', `id=eq.${itemId}`);
            const itemName = (items && items.length > 0) ? items[0].name : 'Unknown Item';
            const price = (items && items.length > 0) ? items[0].price : 'Unknown';
            const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
            const chatId = '1538316434';
            const text = `🛍️ *New VIP Shop Order!*\n\n*Name:* ${currentUser.name}\n*Item:* ${itemName}\n*Size:* ${size}\n*Ref:* \`${refNumber}\``;
            const replyMarkup = { inline_keyboard: [[{ text: "✅ Approve", callback_data: `shop_appr_${newOrder.id}` }, { text: "❌ Reject", callback_data: `shop_rej_${newOrder.id}` }]] };
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: replyMarkup }) });
            } catch (e) { console.error("Telegram shop alert failed", e); }
            return true;
        }
        return false;
    }
};

window.AuthService = AuthService;
window.AppService = AppService;
