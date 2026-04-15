const BOT_TOKEN = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
const ADMIN_CHAT_ID = '1538316434';
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
const MILESTONE_EMOJIS = {
    10: '🎯', 25: '⭐', 50: '🏆', 75: '💪',
    100: '🎉', 150: '🔥', 200: '👑', 250: '🌟',
    300: '💎', 400: '🚀', 500: '🏅'
};

export default async function handler(req, res) {
    try {
        // Get exact user count from Supabase
        const countRes = await fetch(`${SUPABASE_URL}/rest/v1/stride_users?select=id`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Prefer': 'count=exact',
                'Range-Unit': 'items',
                'Range': '0-0'
            }
        });
        const contentRange = countRes.headers.get('content-range');
        const total = contentRange ? parseInt(contentRange.split('/')[1]) : 0;

        if (MILESTONES.includes(total)) {
            const emoji = MILESTONE_EMOJIS[total] || '🎉';
            const messages = {
                10:  `The first 10 Striders are in! This is just the beginning. 🌱`,
                25:  `Quarter century — 25 strong runners! Word is spreading fast! 📣`,
                50:  `FIFTY! Half a century of Striders! This community is real now! 🎊`,
                75:  `75 runners strong! Getting closer to 100 every single day! 💨`,
                100: `ONE HUNDRED MEMBERS! 🥳 This is a landmark moment for Stride Rite!`,
                150: `150 Striders! The Al Rehab running scene will never be the same! 🏙️`,
                200: `200 MEMBERS! You've built something incredible. TWO HUNDRED runners! 👑`,
                250: `250 and counting — Stride Rite is now a serious running community! 🌍`,
                300: `THREE HUNDRED members! This is a movement, not just a club. 🚀`,
                400: `400 Striders! Almost at 500. The city is running with you! 💎`,
                500: `FIVE HUNDRED MEMBERS! 🏅 Stride Rite is the biggest running club in Al Rehab!`
            };

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    text: `${emoji} *MILESTONE UNLOCKED — ${total} MEMBERS!*\n\n${messages[total]}\n\n🏃 Keep the momentum going, Haleem!`,
                    parse_mode: 'Markdown'
                })
            });
        }

        res.status(200).json({ total, milestone: MILESTONES.includes(total) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
}
