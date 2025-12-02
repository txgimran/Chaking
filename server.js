require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com/ajax/libs"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// 数据库连接
const db = new sqlite3.Database("./db.sqlite");

// 数据库初始化
db.serialize(() => {
    // 用户表（增加设备信息）
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        device_id TEXT UNIQUE,
        referrer_id TEXT,
        balance INTEGER DEFAULT 0,
        total_ref INTEGER DEFAULT 0,
        last_withdraw DATE DEFAULT NULL,
        withdraw_count INTEGER DEFAULT 0,
        is_verified BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 设备表（记录设备信息）
    db.run(`CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        device_id TEXT UNIQUE,
        user_agent TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // 推荐表（增加唯一约束）
    db.run(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id TEXT,
        user_id TEXT UNIQUE,
        device_id TEXT,
        is_valid BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referrer_id, user_id)
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

    // 活动日志表
    db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT,
        details TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 验证码表
    db.run(`CREATE TABLE IF NOT EXISTS verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        device_id TEXT,
        verification_code TEXT,
        is_used BOOLEAN DEFAULT 0,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log("✅ Database tables initialized");
});

// 生成设备ID
function generateDeviceId(req) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.connection.remoteAddress;
    const acceptLanguage = req.headers['accept-language'] || '';
    
    const data = `${userAgent}${ip}${acceptLanguage}${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

// 生成验证码
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 活动日志
function logActivity(userId, action, details = '', req = null) {
    const ip = req ? req.ip : 'unknown';
    db.run(
        "INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
        [userId, action, details, ip]
    );
}

// 发送Telegram消息
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
            console.error("Telegram API error:", await response.text());
        }
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
    }
}

// ==========================
// Web App 启动端点
// ==========================
app.get("/api/start", (req, res) => {
    const { username, token, adminid, uid, ref } = req.query;
    
    // 验证参数
    if (!username || !token || !uid) {
        return res.json({ ok: false, error: "Missing required parameters" });
    }
    
    // 验证Token
    if (token !== config.BOT_TOKEN) {
        return res.json({ ok: false, error: "Invalid token" });
    }
    
    // 生成设备ID
    const deviceId = generateDeviceId(req);
    
    // 检查用户是否已存在
    db.get("SELECT * FROM users WHERE id = ?", [uid], async (err, user) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ ok: false, error: "Server error" });
        }
        
        if (!user) {
            // 新用户 - 创建账户
            const verificationCode = generateVerificationCode();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分钟过期
            
            db.serialize(() => {
                // 创建用户
                db.run(
                    "INSERT INTO users (id, device_id, balance, is_verified) VALUES (?, ?, ?, ?)",
                    [uid, deviceId, config.JOIN_BONUS, 0]
                );
                
                // 记录设备
                db.run(
                    "INSERT INTO devices (user_id, device_id, user_agent, ip_address) VALUES (?, ?, ?, ?)",
                    [uid, deviceId, req.headers['user-agent'], req.ip]
                );
                
                // 保存验证码
                db.run(
                    "INSERT INTO verifications (user_id, device_id, verification_code, expires_at) VALUES (?, ?, ?, ?)",
                    [uid, deviceId, verificationCode, expiresAt.toISOString()]
                );
                
                // 记录活动
                logActivity(uid, 'user_registered', `Device: ${deviceId.substring(0, 8)}...`, req);
                
                // 处理推荐（如果有）
                if (ref && ref !== uid) {
                    processReferral(uid, ref, deviceId, req);
                }
                
                res.json({
                    ok: true,
                    message: "Account created successfully",
                    data: {
                        uid,
                        deviceId,
                        verificationCode,
                        balance: config.JOIN_BONUS,
                        requiresVerification: true
                    }
                });
            });
        } else {
            // 现有用户 - 检查设备
            if (user.device_id !== deviceId) {
                // 新设备 - 需要验证
                const verificationCode = generateVerificationCode();
                const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
                
                db.run(
                    "INSERT INTO verifications (user_id, device_id, verification_code, expires_at) VALUES (?, ?, ?, ?)",
                    [uid, deviceId, verificationCode, expiresAt.toISOString()]
                );
                
                logActivity(uid, 'new_device_detected', `New device: ${deviceId.substring(0, 8)}...`, req);
                
                res.json({
                    ok: true,
                    message: "New device detected, verification required",
                    data: {
                        uid,
                        deviceId,
                        verificationCode,
                        balance: user.balance,
                        requiresVerification: true
                    }
                });
            } else {
                // 相同设备 - 直接登录
                res.json({
                    ok: true,
                    message: "Login successful",
                    data: {
                        uid,
                        deviceId,
                        balance: user.balance,
                        requiresVerification: false
                    }
                });
            }
        }
    });
});

// 处理推荐函数
function processReferral(userId, referrerId, deviceId, req) {
    db.serialize(() => {
        // 检查推荐人是否存在
        db.get("SELECT id FROM users WHERE id = ?", [referrerId], (err, referrer) => {
            if (err || !referrer) {
                console.log(`Referrer ${referrerId} not found`);
                return;
            }
            
            // 检查是否已经推荐过（用户级别）
            db.get("SELECT COUNT(*) as count FROM referrals WHERE user_id = ?", [userId], (err, row) => {
                if (err) {
                    console.error("Check referral error:", err);
                    return;
                }
                
                if (row.count > 0) {
                    console.log(`User ${userId} already has a referrer`);
                    logActivity(userId, 'referral_attempt_blocked', `Already referred`, req);
                    return;
                }
                
                // 检查是否自推荐
                if (referrerId === userId) {
                    console.log("Self-referral attempt blocked");
                    logActivity(userId, 'self_referral_blocked', `Self-referral attempt`, req);
                    return;
                }
                
                // 检查推荐人是否已经推荐过这个用户
                db.get("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ? AND user_id = ?", 
                    [referrerId, userId], 
                    (err, existing) => {
                        if (err) {
                            console.error("Check existing referral error:", err);
                            return;
                        }
                        
                        if (existing.count > 0) {
                            console.log(`Referral already exists: ${referrerId} -> ${userId}`);
                            return;
                        }
                        
                        // 添加推荐记录
                        db.run(
                            "INSERT INTO referrals (referrer_id, user_id, device_id) VALUES (?, ?, ?)",
                            [referrerId, userId, deviceId],
                            function(err) {
                                if (err) {
                                    console.error("Referral insert error:", err);
                                    return;
                                }
                                
                                // 给推荐人加钱
                                db.run(
                                    "UPDATE users SET balance = balance + ?, total_ref = total_ref + 1 WHERE id = ?",
                                    [config.REF_BONUS, referrerId]
                                );
                                
                                // 更新用户的推荐人
                                db.run(
                                    "UPDATE users SET referrer_id = ? WHERE id = ?",
                                    [referrerId, userId]
                                );
                                
                                // 记录活动
                                logActivity(referrerId, 'referral_earned', 
                                    `From: ${userId}, Device: ${deviceId.substring(0, 8)}..., Amount: ₹${config.REF_BONUS}`, req);
                                logActivity(userId, 'referred_by', 
                                    `Referrer: ${referrerId}, Device: ${deviceId.substring(0, 8)}...`, req);
                                
                                // 通知推荐人
                                sendTelegram(
                                    referrerId,
                                    `🎉 <b>New Referral Added!</b>\n\n` +
                                    `User: <code>${userId}</code>\n` +
                                    `Device: <code>${deviceId.substring(0, 8)}...</code>\n` +
                                    `Earned: ₹${config.REF_BONUS}\n\n` +
                                    `Total referrals: (Check in dashboard)`
                                );
                                
                                // 通知管理员
                                sendTelegram(
                                    config.ADMIN_ID,
                                    `👤 <b>New Verified Referral</b>\n\n` +
                                    `Referrer: <code>${referrerId}</code>\n` +
                                    `New User: <code>${userId}</code>\n` +
                                    `Device: <code>${deviceId.substring(0, 8)}...</code>\n` +
                                    `Bonus: ₹${config.REF_BONUS}\n` +
                                    `Time: ${new Date().toLocaleString('en-IN')}`
                                );
                            }
                        );
                    }
                );
            });
        });
    });
}

// 验证端点
app.post("/api/verify", (req, res) => {
    const { uid, deviceId, verificationCode } = req.body;
    
    if (!uid || !deviceId || !verificationCode) {
        return res.json({ ok: false, error: "Missing required fields" });
    }
    
    db.get(
        `SELECT * FROM verifications 
         WHERE user_id = ? AND device_id = ? AND verification_code = ? 
         AND is_used = 0 AND expires_at > datetime('now')`,
        [uid, deviceId, verificationCode],
        (err, verification) => {
            if (err || !verification) {
                return res.json({ ok: false, error: "Invalid or expired verification code" });
            }
            
            // 标记验证码为已使用
            db.run(
                "UPDATE verifications SET is_used = 1 WHERE id = ?",
                [verification.id]
            );
            
            // 更新用户设备验证状态
            db.run(
                "UPDATE users SET device_id = ?, is_verified = 1 WHERE id = ?",
                [deviceId, uid]
            );
            
            // 记录设备
            db.run(
                "INSERT OR IGNORE INTO devices (user_id, device_id, user_agent, ip_address) VALUES (?, ?, ?, ?)",
                [uid, deviceId, req.headers['user-agent'], req.ip]
            );
            
            logActivity(uid, 'device_verified', `Device: ${deviceId.substring(0, 8)}...`, req);
            
            // 获取用户数据
            db.get("SELECT * FROM users WHERE id = ?", [uid], (err, user) => {
                if (err || !user) {
                    return res.json({ ok: false, error: "User not found" });
                }
                
                res.json({
                    ok: true,
                    message: "Device verified successfully",
                    data: {
                        uid,
                        deviceId,
                        balance: user.balance,
                        isVerified: true
                    }
                });
            });
        }
    );
});

// 获取用户数据
app.get("/api/user/:uid", (req, res) => {
    const { uid } = req.params;
    const deviceId = generateDeviceId(req);
    
    db.get("SELECT * FROM users WHERE id = ?", [uid], (err, user) => {
        if (err || !user) {
            return res.json({ ok: false, error: "User not found" });
        }
        
        // 检查设备
        if (user.device_id !== deviceId && !user.is_verified) {
            return res.json({ 
                ok: false, 
                error: "Device verification required",
                requiresVerification: true 
            });
        }
        
        res.json({
            ok: true,
            data: {
                uid: user.id,
                balance: user.balance,
                totalRef: user.total_ref,
                withdrawCount: user.withdraw_count,
                isVerified: user.is_verified,
                deviceId: user.device_id
            }
        });
    });
});

// 提现请求
app.post("/api/withdraw", (req, res) => {
    const { uid, upi, deviceId } = req.body;
    
    if (!uid || !upi || !deviceId) {
        return res.json({ ok: false, error: "Missing required fields" });
    }
    
    // 验证设备
    db.get("SELECT * FROM users WHERE id = ? AND device_id = ?", [uid, deviceId], (err, user) => {
        if (err || !user) {
            return res.json({ ok: false, error: "Device verification failed" });
        }
        
        if (!user.is_verified) {
            return res.json({ ok: false, error: "Account not verified" });
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
        
        const withdrawCount = user.last_withdraw === today ? user.withdraw_count + 1 : 1;
        
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            
            // 扣除余额
            db.run(
                `UPDATE users SET 
                 balance = balance - ?, 
                 withdraw_count = ?,
                 last_withdraw = ?
                 WHERE id = ?`,
                [config.MIN_WITHDRAW, withdrawCount, today, uid]
            );
            
            // 保存提现记录
            db.run(
                "INSERT INTO withdraws (uid, amount, upi) VALUES (?, ?, ?)",
                [uid, config.MIN_WITHDRAW, upi],
                function(err) {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.json({ ok: false, error: "Withdraw failed" });
                    }
                    
                    db.run("COMMIT");
                    
                    const requestId = this.lastID;
                    
                    logActivity(uid, 'withdraw_request', 
                        `Amount: ₹${config.MIN_WITHDRAW}, UPI: ${upi}, Request ID: ${requestId}`, req);
                    
                    // 通知用户
                    sendTelegram(
                        uid,
                        `✅ <b>Withdraw Request Submitted</b>\n\n` +
                        `Amount: ₹${config.MIN_WITHDRAW}\n` +
                        `UPI: ${upi}\n` +
                        `Status: Pending\n\n` +
                        `Request ID: ${requestId}\n` +
                        `Date: ${new Date().toLocaleString('en-IN')}`
                    );
                    
                    // 通知管理员
                    sendTelegram(
                        config.ADMIN_ID,
                        `💸 <b>New Withdraw Request</b>\n\n` +
                        `Request ID: <code>${requestId}</code>\n` +
                        `User: <code>${uid}</code>\n` +
                        `Device: <code>${deviceId.substring(0, 8)}...</code>\n` +
                        `Amount: ₹${config.MIN_WITHDRAW}\n` +
                        `UPI: <code>${upi}</code>\n` +
                        `Time: ${new Date().toLocaleString('en-IN')}`
                    );
                    
                    res.json({ 
                        ok: true, 
                        message: "Withdraw request submitted",
                        requestId,
                        amount: config.MIN_WITHDRAW,
                        newBalance: user.balance - config.MIN_WITHDRAW
                    });
                }
            );
        });
    });
});

// 获取推荐列表
app.get("/api/referrals/:uid", (req, res) => {
    const { uid } = req.params;
    const deviceId = generateDeviceId(req);
    
    // 验证设备
    db.get("SELECT id FROM users WHERE id = ? AND device_id = ?", [uid, deviceId], (err, user) => {
        if (err || !user) {
            return res.json({ ok: false, error: "Device verification failed" });
        }
        
        db.all(
            `SELECT r.*, u.created_at as user_joined 
             FROM referrals r 
             LEFT JOIN users u ON r.user_id = u.id 
             WHERE r.referrer_id = ? 
             ORDER BY r.created_at DESC`,
            [uid],
            (err, referrals) => {
                if (err) {
                    return res.json({ ok: false, error: "Database error" });
                }
                
                res.json({
                    ok: true,
                    data: {
                        referrals,
                        count: referrals.length,
                        totalEarned: referrals.length * config.REF_BONUS
                    }
                });
            }
        );
    });
});

// 健康检查
app.get("/health", (req, res) => {
    res.json({ 
        ok: true, 
        status: "running",
        timestamp: new Date().toISOString()
    });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error("Server error:", err.stack);
    res.status(500).json({ ok: false, error: "Internal server error" });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Web App URL: ${config.WEBSITE_URL}`);
});
