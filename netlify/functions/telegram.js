const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const BOT_TOKEN = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
const ADMIN_CHAT_ID = '1538316434';

const defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

async function dbGet(table, query = 'select=*') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
    return await res.json();
}

async function dbInsert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(data)
    });
    return await res.json();
}

async function sendMessage(chatId, text, replyMarkup = null) {
    const body = { 
        chat_id: chatId, 
        text: text, 
        parse_mode: 'Markdown'
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

async function answerCallbackQuery(callbackQueryId, text = null) {
    const body = { callback_query_id: callbackQueryId };
    if (text) body.text = text;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

async function sendDocument(chatId, content, filename) {
    const boundary = '----TelegramBotBoundary12345';
    let bodyText = `--${boundary}\r\n`;
    bodyText += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
    bodyText += `--${boundary}\r\n`;
    bodyText += `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n`;
    bodyText += `Content-Type: text/csv\r\n\r\n${content}\r\n`;
    bodyText += `--${boundary}--\r\n`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: bodyText
    });
}

const crypto = require('crypto');

exports.handler = async function(event, context) {
    if (event.httpMethod !== "POST") return { statusCode: 200, body: "Alive" };

    try {
        const body = JSON.parse(event.body);
        
        // Handle Callback Queries (Button Clicks)
        if (body.callback_query) {
            const callbackQuery = body.callback_query;
            const chatId = callbackQuery.message.chat.id.toString();
            const data = callbackQuery.data;

            if (chatId !== ADMIN_CHAT_ID) return { statusCode: 200, body: 'ok' };

            await answerCallbackQuery(callbackQuery.id);

            if (data === 'cmd_stats') {
                await handleStats(chatId);
            } else if (data === 'cmd_export') {
                await handleExport(chatId);
            } else if (data === 'cmd_create_info') {
                await sendMessage(chatId, "🆕 *To create a new run:* \nType `/create YYYY-MM-DD HH:MM`\n\nExample: `/create 2026-10-31 07:00` ");
            }
            return { statusCode: 200, body: 'ok' };
        }

        // Handle Messages
        if (!body.message || !body.message.text) return { statusCode: 200, body: 'ok' };

        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) return { statusCode: 200, body: 'ok' };

        const text = body.message.text.trim();
        const parts = text.split(' ');
        const cmd = parts[0].toLowerCase();

        if (cmd === '/start' || cmd === '/help' || cmd === 'menu') {
            await sendMenu(chatId);
        } else if (cmd === '/stats' || cmd === '/status') {
            await handleStats(chatId);
        } else if (cmd === '/export') {
            await handleExport(chatId);
        } else if (cmd === '/create') {
            await handleCreate(chatId, parts);
        } else {
            await sendMenu(chatId, "❓ I don't recognize that command. Use the buttons below!");
        }

        return { statusCode: 200, body: 'ok' };
    } catch (e) {
        console.error(e);
        return { statusCode: 500, body: 'Server Error' };
    }
}

async function sendMenu(chatId, welcomeMsg = "👟 *Stride Rite Admin Bot* \nWelcome back, Haleem! Use the interactive buttons below to manage your community.") {
    const keyboard = {
        inline_keyboard: [
            [{ text: "📊 View Run Stats", callback_data: "cmd_stats" }],
            [{ text: "📥 Download Excel (CSV)", callback_data: "cmd_export" }],
            [{ text: "🆕 Create New Run", callback_data: "cmd_create_info" }]
        ]
    };
    await sendMessage(chatId, welcomeMsg, keyboard);
}

async function handleStats(chatId) {
    const runs = await dbGet('stride_runs');
    if (runs.length === 0) {
        await sendMessage(chatId, "❌ No runs currently scheduled.");
        return;
    }
    const nextRun = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');
    
    let males = 0, females = 0, avgAge = 0;
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) {
            u.gender === 'Male' ? males++ : females++;
            avgAge += parseInt(u.age) || 0;
        }
    });
    if (regs.length > 0) avgAge = Math.round(avgAge / regs.length);

    const dt = nextRun.date_label.includes('||') ? nextRun.date_label.split('||')[0] : nextRun.date_label;
    const message = `📊 *Next Run Stats:* \n📍 *${dt}*\n\n👥 *Total RSVPs:* ${regs.length}\n🤸 *Gender Split:* ${males}M / ${females}F\n⏰ *Average Age:* ${avgAge} years`;
    await sendMessage(chatId, message);
}

async function handleExport(chatId) {
    await sendMessage(chatId, "⏳ Generating Excel file, please wait...");
    const runs = await dbGet('stride_runs');
    if (runs.length === 0) return;
    const nextRun = runs[0];

    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');

    let csv = "Name,Email,Age,Gender,Distance,Level,Registration Timestamp\n";
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) csv += `"${u.name}","${u.email}","${u.age}","${u.gender}","${r.distance}","${r.level || u.level}","${r.registered_at}"\n`;
    });

    const dt = nextRun.date_label.includes('||') ? nextRun.date_label.split('||')[0] : nextRun.date_label;
    await sendDocument(chatId, csv, `Stride_Rite_Export_${dt.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
}

async function handleCreate(chatId, parts) {
    if (parts.length < 3) {
         await sendMessage(chatId, "⚠️ Usage: `/create YYYY-MM-DD HH:MM` (Example: `/create 2026-10-31 07:00`) ");
         return;
    }
    try {
        const dateObj = new Date(parts[1] + 'T' + parts[2]);
        if (isNaN(dateObj.getTime())) throw new Error();

        const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const ft = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const fullStr = `${fd} - ${ft}||${dateObj.toISOString()}`;
        
        await dbInsert('stride_runs', {
            id: crypto.randomUUID(),
            date_label: fullStr,
            location: 'Gateway Mall, Al Rehab City',
            location_link: 'https://maps.app.goo.gl/tareg62PBaQJVypk7',
            description: 'Gather at 7:00 AM, warmup starts by 7:15 AM! Every pace is welcome.',
            created_by: 'admin-1'
        });
        await sendMessage(chatId, `✅ *Run Created!* \n📅 ${fd}\n⏰ ${ft}\n\nIt is now live on the community website!`);
    } catch(e) {
        await sendMessage(chatId, "❌ *Date Error!* \nPlease use the format: `YYYY-MM-DD HH:MM` \nExample: `/create 2026-11-20 07:00` ");
    }
}
