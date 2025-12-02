require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");
const helmet = require("helmet");
const cors = require("cors");
const config = require("./config");

// 启动Telegram Bot
require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// 数据库连接
const db = new sqlite3.Database("./db.sqlite");

// 数据库初始化
db.serialize(() => {
    // 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        balance INTEGER DEFAULT 0,
        total_ref INTEGER DEFAULT 0,
        last_withdraw DATE DEFAULT NULL,
        withdraw_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 推荐表
    db.run(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer TEXT,
        user TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referrer, user)
    )`);

    // 提现表
    db.run(`CREATE TABLE IF NOT EXISTS withdraws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT,
        amount INTEGER,
        upi TEXT,
        status TEXT DEFAULT 'pending',
        processed_at DATETIME,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 每日重置表
    db.run(`CREATE TABLE IF NOT EXISTS daily_reset (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_reset DATE DEFAULT CURRENT_DATE
    )`);

    // 活动日志表
    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log("✅ Database tables initialized");
});

// 活动日志函数
function logActivity(userId, action, details = '') {
    db.run(
        "INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)",
        [userId, action, details]
    );
}

// 每日重置提现次数
function resetDailyWithdraws() {
    const today = new Date().toISOString().split('T')[0];
    
    db.get("SELECT last_reset FROM daily_reset ORDER BY id DESC LIMIT 1", (err, row) => {
        if (!row || row.last_reset !== today) {
            db.run("UPDATE users SET withdraw_count = 0 WHERE last_withdraw != ?", [today]);
            db.run("INSERT INTO daily_reset (last_reset) VALUES (?)", [today]);
            console.log(`🔄 Daily withdraw counts reset for ${today}`);
        }
    });
}

// 每小时检查一次重置
setInterval(resetDailyWithdraws, 3600000);

// Telegram发送消息函数
async function sendTelegram(chatId, text, parse_mode = "HTML") {
    try {
        const response = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                chat_id: chatId, 
                text,
                parse_mode
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error("Telegram API error:", errorText);
            return false;
        }
        return true;
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
        return false;
    }
}

// UPI验证函数
function isValidUPI(upi) {
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,49}@[a-zA-Z]{2,}$/;
    return upiRegex.test(upi);
}

// 更新用户最后在线时间
function updateLastSeen(userId) {
    db.run("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?", [userId]);
}

// ==========================
// API 端点
// ==========================

// 用户打开网站
app.post("/open", (req, res) => {
    const { uid, ref } = req.body;

    if (!uid) {
        return res.json({ ok: false, error: "Missing UID" });
    }

    // 更新最后在线时间
    updateLastSeen(uid);

    db.get("SELECT * FROM users WHERE id=?", [uid], async (err, user) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ ok: false, error: "Server error" });
        }

        if (!user) {
            // 新用户
            db.run("INSERT INTO users (id, balance) VALUES (?, ?)", 
                [uid, config.JOIN_BONUS], 
                function(err) {
                    if (err) {
                        console.error("Insert user error:", err);
                        return res.json({ ok: false, error: "Registration failed" });
                    }

                    // 记录活动
                    logActivity(uid, 'user_register', `Joined with bonus: ₹${config.JOIN_BONUS}`);

                    // 处理推荐
                    if (ref && ref !== uid) {
                        db.run("INSERT OR IGNORE INTO referrals (referrer, user) VALUES (?, ?)", 
                            [ref, uid], 
                            async function(err) {
                                if (err) {
                                    console.error("Referral insert error:", err);
                                    return;
                                }

                                if (this.changes > 0) {
                                    // 给推荐人加钱
                                    db.run(`UPDATE users SET balance = balance + ?, total_ref = total_ref + 1 WHERE id=?`,
                                        [config.REF_BONUS, ref], 
                                        (err) => {
                                            if (err) console.error("Update referrer balance error:", err);
                                        });

                                    // 记录活动
                                    logActivity(ref, 'referral_earned', `From user: ${uid}, Amount: ₹${config.REF_BONUS}`);
                                    logActivity(uid, 'referred_by', `Referrer: ${ref}`);

                                    // 通知管理员
                                    await sendTelegram(
                                        config.ADMIN_ID,
                                        `👤 <b>New Referral!</b>\n\n` +
                                        `Referrer: <code>${ref}</code>\n` +
                                        `New User: <code>${uid}</code>\n` +
                                        `Bonus: ₹${config.REF_BONUS}`
                                    );

                                    // 通知推荐人
                                    await sendTelegram(
                                        ref,
                                        `🎉 <b>New referral added!</b>\n\n` +
                                        `You earned ₹${config.REF_BONUS}\n` +
                                        `New user: <code>${uid}</code>`
                                    );
                                }
                            }
                        );
                    }

                    // 通知管理员新用户
                    await sendTelegram(
                        config.ADMIN_ID,
                        `🆕 <b>New User Registered</b>\n\n` +
                        `User ID: <code>${uid}</code>\n` +
                        `Join Bonus: ₹${config.JOIN_BONUS}\n` +
                        `Referrer: ${ref || 'None'}`
                    );
                }
            );
        }

        // 返回用户数据
        db.get("SELECT * FROM users WHERE id=?", [uid], (err, u) => {
            if (err) {
                console.error("Database error:", err);
                return res.json({ ok: false, error: "Server error" });
            }
            
            // 检查是否需要重置每日提现
            const today = new Date().toISOString().split('T')[0];
            if (u.last_withdraw !== today && u.withdraw_count > 0) {
                db.run("UPDATE users SET withdraw_count = 0 WHERE id=?", [uid]);
                u.withdraw_count = 0;
            }

            res.json({ 
                ok: true, 
                user: u,
                limits: {
                    min_withdraw: config.MIN_WITHDRAW,
                    max_withdraw: config.MAX_WITHDRAW,
                    daily_limit: config.DAILY_WITHDRAW_LIMIT,
                    join_bonus: config.JOIN_BONUS,
                    ref_bonus: config.REF_BONUS
                }
            });
        });
    });
});

// 提现请求
app.post("/withdraw", (req, res) => {
    const { uid, upi } = req.body;

    if (!uid || !upi) {
        return res.json({ ok: false, error: "Missing required fields" });
    }

    if (!isValidUPI(upi)) {
        return res.json({ ok: false, error: "Invalid UPI ID format. Example: name@upi" });
    }

    db.get("SELECT * FROM users WHERE id=?", [uid], async (err, user) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ ok: false, error: "Server error" });
        }

        if (!user) {
            return res.json({ ok: false, error: "User not found" });
        }

        // 检查余额
        if (user.balance < config.MIN_WITHDRAW) {
            return res.json({ 
                ok: false, 
                error: `Minimum withdraw amount is ₹${config.MIN_WITHDRAW}. Your balance: ₹${user.balance}` 
            });
        }

        // 检查每日限制
        const today = new Date().toISOString().split('T')[0];
        if (user.last_withdraw === today && user.withdraw_count >= config.DAILY_WITHDRAW_LIMIT) {
            return res.json({ 
                ok: false, 
                error: `Daily withdraw limit reached (${config.DAILY_WITHDRAW_LIMIT} per day)` 
            });
        }

        // 计算新的提现计数
        const withdrawCount = user.last_withdraw === today ? user.withdraw_count + 1 : 1;

        db.serialize(() => {
            // 开始事务
            db.run("BEGIN TRANSACTION");

            // 扣除余额
            db.run(`UPDATE users SET 
                balance = balance - ?, 
                withdraw_count = ?,
                last_withdraw = ?
                WHERE id=?`,
                [config.MIN_WITHDRAW, withdrawCount, today, uid]);

            // 保存提现记录
            db.run("INSERT INTO withdraws (uid, amount, upi) VALUES (?, ?, ?)",
                [uid, config.MIN_WITHDRAW, upi], 
                async function(err) {
                    if (err) {
                        db.run("ROLLBACK");
                        console.error("Withdraw save error:", err);
                        return res.json({ ok: false, error: "Withdraw failed. Please try again." });
                    }

                    // 提交事务
                    db.run("COMMIT");

                    const requestId = this.lastID;

                    // 记录活动
                    logActivity(uid, 'withdraw_request', 
                        `Amount: ₹${config.MIN_WITHDRAW}, UPI: ${upi}, Request ID: ${requestId}`);

                    // 通知管理员
                    await sendTelegram(
                        config.ADMIN_ID,
                        `💸 <b>New Withdraw Request</b>\n\n` +
                        `Request ID: <code>${requestId}</code>\n` +
                        `User: <code>${uid}</code>\n` +
                        `Amount: ₹${config.MIN_WITHDRAW}\n` +
                        `UPI: <code>${upi}</code>\n` +
                        `Time: ${new Date().toLocaleString('en-IN')}\n` +
                        `User Balance: ₹${user.balance - config.MIN_WITHDRAW}`
                    );

                    // 通知用户
                    await sendTelegram(
                        uid,
                        `✅ <b>Withdraw Request Submitted</b>\n\n` +
                        `Amount: ₹${config.MIN_WITHDRAW}\n` +
                        `UPI: ${upi}\n` +
                        `Status: Pending\n\n` +
                        `Request ID: ${requestId}\n` +
                        `Date: ${new Date().toLocaleString('en-IN')}\n\n` +
                        `Processing time: 24-48 hours`
                    );

                    res.json({ 
                        ok: true, 
                        message: "Withdraw request submitted successfully",
                        request_id: requestId,
                        amount: config.MIN_WITHDRAW,
                        new_balance: user.balance - config.MIN_WITHDRAW
                    });
                }
            );
        });
    });
});

// 获取用户余额
app.get("/balance/:uid", (req, res) => {
    const { uid } = req.params;
    
    updateLastSeen(uid);
    
    db.get("SELECT balance FROM users WHERE id=?", [uid], (err, row) => {
        if (err) {
            return res.json({ ok: false, error: "Database error" });
        }
        if (!row) {
            return res.json({ ok: false, error: "User not found" });
        }
        res.json({ ok: true, balance: row.balance });
    });
});

// 获取用户提现历史
app.get("/withdraw-history/:uid", (req, res) => {
    const { uid } = req.params;
    
    updateLastSeen(uid);
    
    db.all("SELECT * FROM withdraws WHERE uid=? ORDER BY date DESC LIMIT 20", [uid], (err, rows) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ ok: false, error: "Database error" });
        }
        res.json({ ok: true, withdrawals: rows });
    });
});

// 获取推荐列表
app.get("/referrals/:uid", (req, res) => {
    const { uid } = req.params;
    
    updateLastSeen(uid);
    
    db.all(`SELECT r.*, u.created_at as user_joined 
            FROM referrals r 
            LEFT JOIN users u ON r.user = u.id 
            WHERE referrer=? 
            ORDER BY r.created_at DESC`, 
            [uid], 
            (err, rows) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ ok: false, error: "Database error" });
        }
        res.json({ ok: true, referrals: rows, count: rows.length });
    });
});

// 管理员端点
app.post("/admin/update-withdraw", (req, res) => {
    const { request_id, status, admin_secret } = req.body;
    
    // 简单认证（生产环境中使用更安全的认证）
    if (admin_secret !== process.env.ADMIN_SECRET) {
        return res.json({ ok: false, error: "Unauthorized" });
    }
    
    if (!['approved', 'rejected'].includes(status)) {
        return res.json({ ok: false, error: "Invalid status" });
    }
    
    db.run("UPDATE withdraws SET status=?, processed_at=CURRENT_TIMESTAMP WHERE id=?",
        [status, request_id], 
        function(err) {
            if (err) {
                console.error("Update error:", err);
                return res.json({ ok: false, error: "Update failed" });
            }
            
            if (this.changes === 0) {
                return res.json({ ok: false, error: "Request not found" });
            }
            
            // 通知用户状态变更
            db.get("SELECT uid, amount FROM withdraws WHERE id=?", [request_id], (err, row) => {
                if (row && row.uid) {
                    const statusMsg = status === 'approved' ? '✅ Approved' : '❌ Rejected';
                    const message = status === 'approved' 
                        ? `🎉 Your withdraw request #${request_id} for ₹${row.amount} has been approved and processed!`
                        : `❌ Your withdraw request #${request_id} for ₹${row.amount} has been rejected. Contact admin for more info.`;
                    
                    sendTelegram(row.uid, message);
                    
                    // 记录活动
                    logActivity(row.uid, `withdraw_${status}`, `Request ID: ${request_id}, Amount: ₹${row.amount}`);
                }
            });
            
            res.json({ ok: true, message: `Withdraw ${status}` });
        }
    );
});

// 获取统计数据（管理员）
app.get("/admin/stats", (req, res) => {
    const { admin_secret } = req.query;
    
    if (admin_secret !== process.env.ADMIN_SECRET) {
        return res.json({ ok: false, error: "Unauthorized" });
    }
    
    db.serialize(() => {
        db.get("SELECT COUNT(*) as total_users FROM users", (err, userRow) => {
            db.get("SELECT COUNT(*) as total_withdraws FROM withdraws", (err, withdrawRow) => {
                db.get("SELECT COUNT(*) as pending_withdraws FROM withdraws WHERE status='pending'", (err, pendingRow) => {
                    db.get("SELECT SUM(balance) as total_balance FROM users", (err, balanceRow) => {
                        db.get("SELECT COUNT(*) as total_referrals FROM referrals", (err, referralRow) => {
                            res.json({
                                ok: true,
                                stats: {
                                    total_users: userRow.total_users,
                                    total_withdraws: withdrawRow.total_withdraws,
                                    pending_withdraws: pendingRow.pending_withdraws,
                                    total_balance: balanceRow.total_balance || 0,
                                    total_referrals: referralRow.total_referrals
                                },
                                timestamp: new Date().toISOString()
                            });
                        });
                    });
                });
            });
        });
    });
});

// 健康检查
app.get("/health", (req, res) => {
    db.get("SELECT 1", (err) => {
        if (err) {
            return res.status(500).json({ 
                ok: false, 
                status: "database_error",
                error: err.message 
            });
        }
        res.json({ 
            ok: true, 
            status: "running", 
            timestamp: new Date().toISOString(),
            bot: "online",
            database: "connected"
        });
    });
});

// 根路径重定向
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error("Server error:", err.stack);
    res.status(500).json({ ok: false, error: "Internal server error" });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ ok: false, error: "Endpoint not found" });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Website URL: ${config.WEBSITE_URL}`);
    resetDailyWithdraws(); // 启动时重置
});