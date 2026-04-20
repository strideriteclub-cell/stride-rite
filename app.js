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

// Parse Instagram handle from any format (URL, @handle, plain text)
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
            window.lastDbError = errBody;
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

const KEYS = { SESSION: "stride_user" };

// Anti-crash Migration for old session keys
(function() {
    const oldKey = "stride_current_user";
    const newKey = "stride_user";
    if (localStorage.getItem(oldKey) && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
    }
})();

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
            // Assign Bib Number if missing
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

    handleGoogleResponse: async (credential) => {
        try {
            // Decode the Google JWT (payload is the middle segment)
            const base64Url = credential.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            const googleUser = JSON.parse(jsonPayload);
            const { name, email, sub: googleId } = googleUser;

            // Check if user exists in our custom table
            let users = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}`);
            let userRecord;

            if (users && users.length > 0) {
                userRecord = users[0];
            } else {
                // First time logging in with Google -> Create profile
                userRecord = {
                    id: generateUUID(),
                    name,
                    email,
                    password: 'GOOGLE_OAUTH_ACCOUNT', // Placeholder for custom table
                    birthdate: null, age: '?', gender: 'Other', level: 'Beginner', is_admin: false
                };
                await dbInsert('stride_users', userRecord);
            }

            // Standard log-in flow: Assign Bib if missing, Save to local storage
            if (!userRecord.bib_number) {
                userRecord = await AppService.assignBibNumber(userRecord.id);
            }
            localStorage.setItem(KEYS.SESSION, JSON.stringify(userRecord));
            return true;
        } catch (e) {
            console.error("Google handle error:", e);
            return false;
        }
    },

    register: async (name, email, password, birthdate, gender, level) => {
        const existing = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}`);
        if (existing && existing.length > 0) return false;
        
        let newUser = {
            id: generateUUID(),
            name, email, password,
            birthdate,
            age: calculateAge(birthdate),
            gender, level, is_admin: false
        };
        
        const inserted = await dbInsert('stride_users', newUser);
        if (inserted) {
            // Assign sequential bib number instantly
            newUser = await AppService.assignBibNumber(newUser.id);
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

// --- APP SERVICE ---
const AppService = {
    assignBibNumber: async (userId) => {
        const users = await dbGet('stride_users', 'bib_number=not.is.null&select=bib_number&order=bib_number.desc&limit=1');
        const maxBib = (users && users.length > 0 && users[0].bib_number) ? users[0].bib_number : 99;
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
            if (!run.date_label) continue;
            // Never show exported or past runs in the upcoming list
            if (run.date_label.includes('[EXPORTED]')) continue;
            
            const parts = run.date_label.split('||');
            const runDate = parts[1] ? new Date(parts[1]) : null;
            if (runDate && runDate < now) {
                AppService.handleExpiredRun(run.id, parts[0]);
                continue;
            }
            
            // Format for display
            run.date_label = parts[0];
            run.iso_date = parts[1];
            validRuns.push(run);
        }

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

    registerForRun: async (runId, distance, level, fullName, phoneNumber) => {
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
            level: level,
            user_full_name: fullName || currentUser.name,
            phone_number: phoneNumber || null
        };
        const result = await dbInsert('stride_registrations', newRegistration);
        if (result !== null) {
            const runDetails = await dbGet('stride_runs', `id=eq.${runId}`);
            if (runDetails && runDetails.length > 0) {
                AppService.sendTelegramAlert(currentUser, distance, level, runDetails[0], isFirstTimer, phoneNumber);
            }
            return true;
        }
        return false;
    },

    cancelRunRegistration: async (runId, userId) => {
        try {
            const regs = await dbGet('stride_registrations', `run_id=eq.${runId}&user_id=eq.${userId}`);
            if (regs && regs.length > 0) {
                const regId = regs[0].id;
                await dbDelete('stride_registrations', 'id', regId);
                return true;
            }
            return false;
        } catch (e) { console.error("Cancel failed", e); return false; }
    },

    sendTelegramAlert: async (user, distance, level, run, isFirstTimer, phoneNumber) => {
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const cleanTimestamp = (run.date_label || '').split('||')[0];
        const phone = phoneNumber || 'Not provided';

        let text, parseMode;
        if (run.tour_stop_id) {
            // ── TOUR DE CAIRO REGISTRATION (HTML format) ────────────────
            parseMode = 'HTML';
            const stopNum  = String(run.tour_stop_id).padStart(2, '0');
            const stopName = run.tour_stop_name || run.location || 'Unknown Stop';
            const host     = run.partner_name || 'Stride Rite';
            text = '🏅 <b>TOUR DE CAIRO — STOP ' + stopNum + ' REGISTRATION!</b>\n\n'
                 + '📍 <b>Stop ' + stopNum + ': ' + stopName + '</b>\n'
                 + '🤝 <b>Hosted by:</b> ' + host + ' x Stride Rite\n'
                 + '📅 <b>Date:</b> ' + cleanTimestamp + '\n'
                 + '─────────────────\n'
                 + '👤 <b>Name:</b> ' + user.name + '\n'
                 + '📞 <b>Phone:</b> ' + phone + '\n'
                 + '📧 <b>Email:</b> ' + (user.email || 'N/A') + '\n'
                 + '🏃 <b>Distance:</b> ' + distance + '\n'
                 + '🎽 <b>Level:</b> ' + (level || user.level || 'N/A')
                 + (isFirstTimer ? '\n\n🎉 <b>First timer on Tour de Cairo!</b>' : '');
        } else {
            // ── REGULAR RUN REGISTRATION (Markdown format) ───────────────
            parseMode = 'Markdown';
            const age = user.birthdate ? calculateAge(user.birthdate) : (user.age || '?');
            const firstTimerBadge = isFirstTimer ? '\n\n🎉 *FIRST TIMER! Welcome them warmly!*' : '';
            const phoneLine = phoneNumber ? ('\n📞 *Phone:* ' + phoneNumber) : '';
            text = (isFirstTimer ? '🌟' : '🚨') + ' *' + (isFirstTimer ? 'First-Time' : 'New') + ' Runner Alert!*\n\n'
                 + '*' + user.name + '* (' + age + (user.gender === 'Male' ? 'M' : 'F') + ') just registered for the *' + distance + '*!' + phoneLine + '\n'
                 + '📧 *Email:* ' + user.email + '\n'
                 + '🏃 *Level:* ' + (level || user.level) + '\n'
                 + '📅 *Run:* ' + cleanTimestamp + firstTimerBadge;
        }
        try {
            const tgRes = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: parseMode })
            });
            const tgJson = await tgRes.json();
            if (!tgJson.ok) console.error('Telegram error:', JSON.stringify(tgJson));
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

    checkInRunner: async (runId, identifier) => {
        // identifier can be bib_number (number) or registrationId (uuid)
        let reg = null;
        if (identifier.length > 10) { // Likely UUID (registration ID)
            const rows = await dbGet('stride_registrations', `id=eq.${identifier}`);
            if (rows && rows.length > 0) reg = rows[0];
        } else { // Likely Bib Number
            const users = await dbGet('stride_users', `bib_number=eq.${identifier}`);
            if (users && users.length > 0) {
                const regs = await dbGet('stride_registrations', `run_id=eq.${runId}&user_id=eq.${users[0].id}`);
                if (regs && regs.length > 0) reg = regs[0];
            }
        }

        if (!reg) throw new Error("Runner not found or not registered for this stop.");
        if (reg.attended_at) throw new Error("This runner is already checked in!");

        await dbUpdate('stride_registrations', 'id', reg.id, { attended_at: new Date().toISOString() });
        
        // Fetch full info for feedback
        const userInfo = await dbGet('stride_users', `id=eq.${reg.user_id}`);
        return {
            name: userInfo[0].name,
            bib: userInfo[0].bib_number,
            time: new Date().toLocaleTimeString()
        };
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
        }).sort((a,b) => b.time.localeCompare(a.time)); // Latest first
    },

    getTourProgress: async (userId) => {
        const rawRuns = await dbGet('stride_runs');
        const userRegs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        const dbStops = await dbGet('stride_tour_stops');
        const now = new Date();

        const config = [
            { id: 1, name: 'Al Rehab',    lat: 30.065846, lng: 31.504127, small: true },
            { id: 2, name: 'Madinaty',    lat: 30.101, lng: 31.646, up: true },
            { id: 3, name: 'New Administrative Capital', lat: 30.013, lng: 31.800, left: true },
            { id: 4, name: 'New Cairo',   lat: 30.025, lng: 31.462 },
            { id: 5, name: 'Zamalek',     lat: 30.062, lng: 31.222 },
            { id: 6, name: 'Maadi',       lat: 29.959, lng: 31.250 },
            { id: 7, name: 'Giza',        lat: 29.987, lng: 31.141 },
            { id: 8, name: 'Heliopolis',  lat: 30.089, lng: 31.319, up: true }
        ];

        const currentTourConfig = config.map(def => {
            const override = (dbStops || []).find(s => Number(s.id) === Number(def.id));
            if (override) return { ...def, name: override.name, lat: override.lat, lng: override.lng };
            return def;
        });

        const progress = currentTourConfig.map(stop => {
            const stopRuns = (rawRuns || []).filter(r => r.tour_stop_id && Number(r.tour_stop_id) === Number(stop.id));
            let status = 'locked', runId = null;

            for (const r of stopRuns) {
                const parts = (r.date_label || '').split('||');
                const runDate = parts[1] ? new Date(parts[1]) : null;
                const isExported = (r.date_label || '').includes('[EXPORTED]');
                const userRegistered = userRegs.find(reg => reg.run_id === r.id);

                if (userRegistered && (isExported || (runDate && runDate < now))) {
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

        let result = await dbInsert('shop_orders', newOrder);

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
                    await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: formData });
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

// --- MOBILE MENU UTILITY ---
function initMobileMenu(user) {
    const navbar = document.querySelector('.navbar');
    const navLinks = document.getElementById('navLinks') || document.querySelector('.nav-links');
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
    btn.onclick = toggle;
    overlay.onclick = toggle;
    panel.querySelectorAll('a').forEach(a => a.onclick = toggle);
}

document.addEventListener('DOMContentLoaded', () => {
    initMobileMenu(AuthService.getCurrentUser());
});

// Global Exposure
window.AuthService = AuthService;
window.AppService = AppService;
window.Utils = Utils;
window.parseIgHandle = parseIgHandle;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
window.defaultHeaders = defaultHeaders;
