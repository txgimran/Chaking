const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

console.log('🤖 Telegram Bot is starting...');

// 存储Web App数据
const webAppData = new Map();

// 启动命令 - 支持Web App启动
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const referralCode = match[1]; // 获取推荐码

    try {
        // 生成Web App URL
        const webAppUrl = `${config.WEBSITE_URL}/start.html?` +
                         `username=${config.BOT_USERNAME}&` +
                         `token=${config.BOT_TOKEN}&` +
                         `adminid=${config.ADMIN_ID}&` +
                         `uid=${userId}&` +
                         `ref=${referralCode || ''}`;

        // 保存Web App数据
        webAppData.set(userId, {
            username: config.BOT_USERNAME,
            token: config.BOT_TOKEN,
            adminid: config.ADMIN_ID,
            uid: userId,
            ref: referralCode,
            timestamp: Date.now()
        });

        await bot.sendMessage(chatId, 
            `🎉 *Welcome ${username}!*\n\n` +
            `*💰 Refer & Earn Bot* 🤖\n\n` +
            `Earn money by inviting friends!\n\n` +
            `✅ *Get ₹${config.JOIN_BONUS} joining bonus*\n` +
            `✅ *Earn ₹${config.REF_BONUS} per referral*\n` +
            `✅ *Withdraw ₹${config.MIN_WITHDRAW} to UPI*\n\n` +
            `*Safety Features:*\n` +
            `• One-time referral per user\n` +
            `• Device ID verification\n` +
            `• Anti-fraud protection\n\n` +
            `*Click the button below to open Web App:*`, 
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: '📱 Open Web App',
                            web_app: { url: webAppUrl }
                        }],
                        [{
                            text: '🤖 Share Bot',
                            url: `https://t.me/share/url?url=https://t.me/${config.BOT_USERNAME}?start=${userId}&text=💰 Earn money by referrals! Join using my link!`
                        }]
                    ]
                }
            }
        );

        // 记录用户启动
        console.log(`User ${userId} started bot with referral: ${referralCode || 'None'}`);

    } catch (error) {
        console.error('Error in /start command:', error);
        await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
    }
});

// 处理Web App数据
bot.on('web_app_data', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const data = JSON.parse(msg.web_app_data.data);
    
    console.log('Web App data received:', data);
    
    // 处理Web App提交的数据
    if (data.action === 'registration_complete') {
        await bot.sendMessage(chatId,
            `✅ *Registration Complete!*\n\n` +
            `Device verified and account created.\n\n` +
            `*Your Details:*\n` +
            `User ID: \`${data.uid}\`\n` +
            `Device ID: \`${data.deviceId.substring(0, 8)}...\`\n` +
            `Balance: ₹${data.balance}\n\n` +
            `Use /dashboard to open your account.`,
            { parse_mode: 'Markdown' }
        );
    }
});

// 仪表板命令
bot.onText(/\/dashboard/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const dashboardUrl = `${config.WEBSITE_URL}/dashboard.html?` +
                        `username=${config.BOT_USERNAME}&` +
                        `token=${config.BOT_TOKEN}&` +
                        `uid=${userId}`;
    
    await bot.sendMessage(chatId,
        `*📱 Your Dashboard*\n\n` +
        `Click below to open your dashboard:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{
                    text: '📊 Open Dashboard',
                    web_app: { url: dashboardUrl }
                }]]
            }
        }
    );
});

// 推荐命令
bot.onText(/\/refer/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const referralUrl = `https://t.me/${config.BOT_USERNAME}?start=${userId}`;
    
    await bot.sendMessage(chatId,
        `*📤 Your Referral Link*\n\n` +
        `Share this link and earn ₹${config.REF_BONUS} per friend!\n\n` +
        `\`${referralUrl}\`\n\n` +
        `*Safety Rules:*\n` +
        `• One referral per user only\n` +
        `• Device verification required\n` +
        `• No self-referral allowed\n\n` +
        `*Share Now:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: '📱 Copy Link',
                        callback_data: 'copy_ref_link'
                    }],
                    [{
                        text: '📤 Share on Telegram',
                        url: `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=💰 Earn money by referrals! Join using my link!`
                    }],
                    [{
                        text: '👥 My Referrals',
                        callback_data: 'my_referrals'
                    }]
                ]
            }
        }
    );
});

// 提现命令
bot.onText(/\/withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const withdrawUrl = `${config.WEBSITE_URL}/withdraw.html?` +
                       `username=${config.BOT_USERNAME}&` +
                       `token=${config.BOT_TOKEN}&` +
                       `uid=${userId}`;
    
    await bot.sendMessage(chatId,
        `*💸 Withdraw Money*\n\n` +
        `Click below to open withdraw page:\n\n` +
        `*Requirements:*\n` +
        `• Minimum: ₹${config.MIN_WITHDRAW}\n` +
        `• Daily Limit: ${config.DAILY_WITHDRAW_LIMIT} time(s)\n` +
        `• UPI ID required\n\n` +
        `*Open Withdraw Page:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{
                    text: '💳 Open Withdraw',
                    web_app: { url: withdrawUrl }
                }]]
            }
        }
    );
});

// 统计命令
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const statsUrl = `${config.WEBSITE_URL}/stats.html?` +
                    `username=${config.BOT_USERNAME}&` +
                    `token=${config.BOT_TOKEN}&` +
                    `uid=${userId}`;
    
    await bot.sendMessage(chatId,
        `*📊 Your Statistics*\n\n` +
        `Click below to view your stats:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{
                    text: '📈 View Stats',
                    web_app: { url: statsUrl }
                }]]
            }
        }
    );
});

// 回调查询处理
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    try {
        switch(data) {
            case 'copy_ref_link':
                const refLink = `https://t.me/${config.BOT_USERNAME}?start=${userId}`;
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Link copied to clipboard!',
                    show_alert: false
                });
                break;
                
            case 'my_referrals':
                const referralsUrl = `${config.WEBSITE_URL}/referrals.html?` +
                                   `username=${config.BOT_USERNAME}&` +
                                   `token=${config.BOT_TOKEN}&` +
                                   `uid=${userId}`;
                
                await bot.sendMessage(chatId,
                    `Opening your referrals...`,
                    {
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '👥 View Referrals',
                                web_app: { url: referralsUrl }
                            }]]
                        }
                    }
                );
                break;
        }
        
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Callback query error:', error);
    }
});

// 帮助命令
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId,
        `*❓ Help & Commands*\n\n` +
        `*/start* - Start bot & open Web App\n` +
        `*/dashboard* - Open your dashboard\n` +
        `*/refer* - Get referral link\n` +
        `*/withdraw* - Withdraw money\n` +
        `*/stats* - View statistics\n` +
        `*/help* - This help message\n\n` +
        `*💰 How it works:*\n` +
        `1. Use /start to register\n` +
        `2. Get device verified\n` +
        `3. Share your referral link\n` +
        `4. Earn ₹${config.REF_BONUS} per friend\n` +
        `5. Withdraw when you reach ₹${config.MIN_WITHDRAW}\n\n` +
        `*🔒 Security:*\n` +
        `• Device ID verification\n` +
        `• One-time referral per user\n` +
        `• Anti-fraud protection\n\n` +
        `*Need help?* Contact support`,
        { parse_mode: 'Markdown' }
    );
});

console.log('✅ Bot is running...');
