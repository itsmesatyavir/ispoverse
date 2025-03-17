const axios = require('axios');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const cron = require('node-cron'); 

function displayBanner() {
    const banner = `
=========================================================
         ISPOVERSE Task Bot - Shared By ForestArmy           
=========================================================
`;
    process.stdout.write(banner);
}

class ProxyManager {
    constructor() {
        this.proxies = [];
        this.currentProxyIndex = 0;
    }

    async loadProxies() {
        try {
            const data = await fs.readFile('proxies.txt', 'utf8');
            this.proxies = data.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            
            console.log(`Loaded ${this.proxies.length} proxies from proxies.txt`);
            return this.proxies.length > 0;
        } catch (error) {
            console.log('No proxies.txt file found or error reading it. Running without proxies.');
            return false;
        }
    }

    getNextProxy() {
        if (this.proxies.length === 0) return null;
        
        const proxy = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        return proxy;
    }

    createProxyAgent(proxyString) {
        if (!proxyString) return null;

        try {
            let protocol, host, port, auth;
            
            if (proxyString.includes('://')) {
                const url = new URL(proxyString);
                protocol = url.protocol.replace(':', '');
                host = url.hostname;
                port = url.port;
                auth = url.username ? `${url.username}:${url.password}` : null;
            } else {
                const parts = proxyString.split(':');
                
                if (parts.length >= 2) {
                    host = parts[0];
                    port = parts[1];
                    if (parts.length >= 4) {
                        auth = `${parts[2]}:${parts[3]}`;
                    }
                    protocol = 'http';
                } else {
                    console.log(`Invalid proxy format: ${proxyString}`);
                    return null;
                }
            }

            if (protocol === 'http' || protocol === 'https') {
                const options = { host, port, protocol };
                if (auth) options.auth = auth;
                return new HttpsProxyAgent(`${protocol}://${auth ? auth + '@' : ''}${host}:${port}`);
            } 
            else if (protocol === 'socks4' || protocol === 'socks5' || protocol === 'socks') {
                return new SocksProxyAgent(`${protocol}://${auth ? auth + '@' : ''}${host}:${port}`);
            } 
            else {
                console.log(`Unsupported proxy protocol: ${protocol}`);
                return null;
            }
        } catch (error) {
            console.log(`Error creating proxy agent: ${error.message}`);
            return null;
        }
    }
}

class TaskBot {
    constructor(walletAddress = null, proxyManager = null) {
        this.baseUrl = 'https://dashboard.ispolink.com/admin/api/v1';
        this.userId = null;
        this.apiKey = null;
        this.walletAddress = walletAddress;
        this.username = null;
        this.handleId = null;
        this.totalPoints = 0;
        this.dailyTasks = [];
        this.cookie = null;
        this.proxyManager = proxyManager;
        this.currentProxy = null;
        
        this.axiosInstance = this.createAxiosInstance();
    }

    createAxiosInstance() {
        if (this.proxyManager) {
            this.currentProxy = this.proxyManager.getNextProxy();
        }

        const headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.7',
            'content-type': 'application/json',
            'priority': 'u=1, i',
            'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Brave";v="134"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sec-gpc': '1',
            'Referer': 'https://dashboard.ispolink.com/',
            'Referrer-Policy': 'strict-origin-when-cross-origin'
        };

        const config = { headers };
        
        if (this.currentProxy) {
            const proxyAgent = this.proxyManager.createProxyAgent(this.currentProxy);
            if (proxyAgent) {
                config.httpsAgent = proxyAgent;
                console.log(`Using proxy: ${this.currentProxy}`);
            }
        }

        return axios.create(config);
    }

    async loadCookieFromFile() {
        try {
            this.cookie = await fs.readFile('token.txt', 'utf8');
            this.axiosInstance.defaults.headers['cookie'] = this.cookie.trim();
            console.log('Cookie loaded from token.txt');
        } catch (error) {
            console.error('Failed to load cookie from token.txt:', error.message);
            throw error;
        }
    }

    async promptWalletAddress() {
        if (this.walletAddress) {
            console.log(`Using provided wallet address: ${this.walletAddress}`);
            return;
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('Please enter your wallet address: ', (answer) => {
                this.walletAddress = answer.trim();
                rl.close();
                resolve();
            });
        });
    }

    async initializeUserData() {
        const url = `${this.baseUrl}/user/checkifexists/${this.walletAddress}`;
        try {
            const response = await this.axiosInstance.get(url);
            if (response.data.success) {
                this.userId = response.data.userid;
                this.apiKey = response.data.apikey;
                this.username = response.data.username;
                console.log(`User initialized: ${this.username} (ID: ${this.userId})`);
            } else {
                throw new Error('Failed to fetch user data');
            }
        } catch (error) {
            console.error('Failed to initialize user data:', error.message);
            throw error;
        }
    }

    async getHandleId() {
        const url = `${this.baseUrl}/points/gethandles/${this.userId}/${this.apiKey}/${this.walletAddress}`;
        try {
            const response = await this.axiosInstance.get(url, {
                headers: { 'Referer': 'https://dashboard.ispolink.com/socials' }
            });
            if (response.data.success && response.data.handles.length > 0) {
                this.handleId = response.data.handles[0].id;
                console.log(`Handle ID fetched: ${this.handleId} (Twitter: ${response.data.handles[0].twitter_handle})`);
            } else {
                throw new Error('No handles found');
            }
            return this.handleId;
        } catch (error) {
            console.error('Failed to fetch handle ID:', error.message);
            throw error;
        }
    }

    async getUserStats() {
        const url = `${this.baseUrl}/profile/updateMyStats/${this.userId}/${this.apiKey}/${this.walletAddress}`;
        try {
            const response = await this.axiosInstance.get(url);
            if (response.data.success) {
                this.totalPoints = response.data.total_points;
                
                console.log(`User Stats | ${this.username} (${this.walletAddress.slice(0, 6)}...${this.walletAddress.slice(-4)})`);
                console.log(`-------------------------------------------------`);
                console.log(`Daily: ${response.data.daily_points}`);
                console.log(`Quiz: ${response.data.quiz_points}`);
                console.log(`Social: ${response.data.social_points}`);
                console.log(`Profile: ${response.data.profile_points}`);
                console.log(`Referral: ${response.data.referral_points}`);
                console.log(`Total Points: ${response.data.total_points}`);
                console.log(`-------------------------------------------------`);
            }
            return response.data;
        } catch (error) {
            console.error('Failed to fetch user stats:', error.message);
            throw error;
        }
    }

    async getSocialTasks() {
        const url = `${this.baseUrl}/points/gettweets/notdone/${this.userId}/${this.apiKey}/${this.walletAddress}/${this.handleId}`;
        try {
            const response = await this.axiosInstance.get(url);
            console.log(`Found ${response.data.tweets.length} social tasks to complete`);
            return response.data.tweets;
        } catch (error) {
            console.error('Failed to fetch social tasks:', error.message);
            throw error;
        }
    }

    async getDailyTasks() {
        const url = `${this.baseUrl}/dailytasks/getAllTasks/${this.userId}/${this.apiKey}/${this.walletAddress}`;
        try {
            const response = await this.axiosInstance.get(url, {
                headers: { 'Referer': 'https://dashboard.ispolink.com/daily' }
            });
            console.log(`Found ${response.data.tasks.length} daily tasks`);
            this.dailyTasks = response.data.tasks.map(task => ({
                ...task,
                countdownSeconds: this.parseCountdownToSeconds(task.countdown_timer)
            }));
            return this.dailyTasks;
        } catch (error) {
            console.error('Failed to fetch daily tasks:', error.message);
            throw error;
        }
    }

    parseCountdownToSeconds(countdown) {
        if (!countdown || countdown === 'Not available') return 0;
        const [hours, minutes, seconds] = countdown.split(':').map(Number);
        return (hours * 3600) + (minutes * 60) + seconds;
    }

    formatSecondsToCountdown(seconds) {
        const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${hours} ${minutes} ${secs}`;
    }

    startCountdown() {
        const animationFrames = ['|', '/', '-', '\\'];
        let frameIndex = 0;
        const activeTasks = this.dailyTasks.filter(task => !task.completed && task.countdownSeconds > 0);
        let lineCount = activeTasks.length || 1;

        const updateDisplay = () => {
            process.stdout.write(`\x1B[${lineCount}A`);
            
            if (activeTasks.length === 0) {
                process.stdout.write('No active tasks with countdown\n');
            } else {
                activeTasks.forEach(task => {
                    if (task.countdownSeconds > 0) {
                        task.countdownSeconds--;
                        const countdown = this.formatSecondsToCountdown(task.countdownSeconds);
                        process.stdout.write(`ID ${task.id} - ${task.title.padEnd(30)} | ${animationFrames[frameIndex]} ${countdown}\n`);
                    } else {
                        process.stdout.write(`ID ${task.id} - ${task.title.padEnd(30)} | ⏳ READY\n`);
                    }
                });
            }
            frameIndex = (frameIndex + 1) % animationFrames.length;
        };

        console.log('\nDaily Tasks Countdown:');
        if (activeTasks.length === 0) {
            console.log('No active tasks with countdown');
        } else {
            activeTasks.forEach(task => {
                const countdown = this.formatSecondsToCountdown(task.countdownSeconds);
                console.log(`ID ${task.id} - ${task.title.padEnd(30)} | ${animationFrames[frameIndex]} ${countdown}`);
            });
        }

        const interval = setInterval(updateDisplay, 1000);

        process.on('SIGINT', () => {
            clearInterval(interval);
            process.stdout.write('\nCountdown stopped.\n');
            process.exit();
        });
    }

    async completeSocialTask(taskId, subtask, tweetLink = null) {
        const url = `${this.baseUrl}/points/completeTaskManually`;
        const payload = {
            userid: this.userId,
            apikey: this.apiKey,
            walletaddress: this.walletAddress,
            taskid: taskId,
            handleid: this.handleId,
            subtask: subtask,
            tweet_link: tweetLink
        };

        try {
            const response = await this.axiosInstance.post(url, payload, {
                headers: {
                    'x-xsrf-token': 'eyJpdiI6Imh2N2RMcWxPczlZTVh2MElYTWtlMWc9PSIsInZhbHVlIjoiWjBjNm44VDdZNThhM2xiYlZUcjlGV2l4anlqS3ZEM3Mrd1VQOVJnc1kwZUxRSUxKWDlPV1ZlSmpFcGJIbGxGbW9SZ2txUCtuSm1GK3FRUjRqN29hYk9vcVNFOUxIM3R5YWttYzVLTkcwYXFVOTJtbUU0aDdzU29OalpxcTBTNDIiLCJtYWMiOiIxZGM0MzI0ZmZlY2Q2ZDVmZWRlNGIwZjIxZGI2ZDExMDdjOTE5NWM5MzRkYjgwZjI4NTMwYTNlNjFmM2I4OWIxIiwidGFnIjoiIn0='
                }
            });
            const points = subtask === 'like' ? 10 : 50;
            this.totalPoints += points;
            console.log(`✅ Social Task ${taskId} (${subtask.padEnd(7)}) | +${points} pts | Total: ${this.totalPoints}`);
            return response.data;
        } catch (error) {
            console.error(`❌ Failed to complete social task ${taskId} (${subtask}):`, error.response?.data || error.message);
            throw error;
        }
    }

    async completeDailyTask(taskId) {
        const url = `${this.baseUrl}/dailytasks/done`;
        const formData = new FormData();
        formData.append('userid', this.userId);
        formData.append('apikey', this.apiKey);
        formData.append('walletaddress', this.walletAddress);
        formData.append('taskid', taskId);

        try {
            const response = await this.axiosInstance.post(url, formData, {
                headers: {
                    'content-type': 'multipart/form-data',
                    'x-xsrf-token': 'eyJpdiI6Imh2N2RMcWxPczlZTVh2MElYTWtlMWc9PSIsInZhbHVlIjoiWjBjNm44VDdZNThhM2xiYlZUcjlGV2l4anlqS3ZEM3Mrd1VQOVJnc1kwZUxRSUxKWDlPV1ZlSmpFcGJIbGxGbW9SZ2txUCtuSm1GK3FRUjRqN29hYk9vcVNFOUxIM3R5YWttYzVLTkcwYXFVOTJtbUU0aDdzU29OalpxcTBTNDIiLCJtYWMiOiIxZGM0MzI0ZmZlY2Q2ZDVmZWRlNGIwZjIxZGI2ZDExMDdjOTE5NWM5MzRkYjgwZjI4NTMwYTNlNjFmM2I4OWIxIiwidGFnIjoiIn0=',
                    'Referer': 'https://dashboard.ispolink.com/daily'
                }
            });
            const points = parseInt(response.data.earned_points, 10);
            this.totalPoints += points;
            console.log(`✅ Daily Task ${taskId} completed | +${points} pts | Total: ${this.totalPoints}`);
            const taskIndex = this.dailyTasks.findIndex(task => task.id === taskId);
            if (taskIndex !== -1) {
                this.dailyTasks[taskIndex].completed = true;
            }
            return response.data;
        } catch (error) {
            console.error(`❌ Failed to complete daily task ${taskId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async processTasks() {
        try {
            const socialTasks = await this.getSocialTasks();
            if (!socialTasks || socialTasks.length === 0) {
                console.log('No social tasks found to complete');
            } else {
                console.log('\nProcessing Social Tasks:');
                console.log('-------------------------------------------------');
                for (const task of socialTasks) {
                    const taskId = task.id;
                    const tweetLink = task.tweet_link_RCL;

                    if (!task.completed_like) {
                        await this.completeSocialTask(taskId, 'like', tweetLink);
                    } else {
                        console.log(`✓ Social Task ${taskId} (like) already completed`);
                    }

                    if (!task.completed_comment) {
                        await this.completeSocialTask(taskId, 'comment', tweetLink);
                    } else {
                        console.log(`✓ Social Task ${taskId} (comment) already completed`);
                    }

                    if (!task.completed_retweet) {
                        await this.completeSocialTask(taskId, 'retweet', tweetLink);
                    } else {
                        console.log(`✓ Social Task ${taskId} (retweet) already completed`);
                    }
                }
                console.log('-------------------------------------------------');
            }

            const dailyTasks = await this.getDailyTasks();
            if (!dailyTasks || dailyTasks.length === 0) {
                console.log('No daily tasks found to complete');
            } else {
                console.log('\nProcessing Daily Tasks:');
                console.log('-------------------------------------------------');
                for (const task of dailyTasks) {
                    const taskId = task.id;
                    const countdown = task.countdownSeconds > 0 ? this.formatSecondsToCountdown(task.countdownSeconds) : '00 00 00';
                    
                    if (!task.completed && task.countdownSeconds === 0) {
                        console.log(`Completing Daily Task ${taskId} - ${task.title}`);
                        await this.completeDailyTask(taskId);
                    } else if (task.completed) {
                        console.log(`✓ Daily Task ${taskId} - ${task.title} already completed`);
                    } else {
                        console.log(`⏳ Daily Task ${taskId} - ${task.title} waiting (${countdown})`);
                    }
                }
                console.log('-------------------------------------------------');
                this.startCountdown();
            }
        } catch (error) {
            console.error('❌ Task processing failed:', error.message);
        }
    }

    async run() {
        try {
            await this.loadCookieFromFile();
            await this.promptWalletAddress();
            await this.initializeUserData();
            await this.getHandleId();
            await this.getUserStats();

            console.log(`[${new Date().toLocaleString()}] Starting initial task run...`);
            await this.processTasks();

            cron.schedule('0 0 * * *', async () => {
                console.log(`[${new Date().toLocaleString()}] Running daily scheduled tasks...`);
                await this.processTasks();
            }, {
                timezone: "Asia/Jakarta" 
            });

            console.log('Bot is now running and scheduled to process tasks daily at 00:00 Asia/Jakarta time.');

            return { success: true, username: this.username, totalPoints: this.totalPoints };
        } catch (error) {
            console.error('❌ Bot execution failed:', error.message);
            return { success: false, error: error.message };
        }
    }
}

async function readWalletAddresses() {
    try {
        const data = await fs.readFile('wallets.txt', 'utf8');
        const wallets = data.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        
        console.log(`Loaded ${wallets.length} wallet addresses from wallets.txt`);
        return wallets;
    } catch (error) {
        console.log('No wallets.txt file found or error reading it. Will prompt for wallet address.');
        return [];
    }
}

async function main() {
    displayBanner();
    
    const proxyManager = new ProxyManager();
    await proxyManager.loadProxies();
    
    const walletAddresses = await readWalletAddresses();
    
    if (walletAddresses.length === 0) {
        const bot = new TaskBot(null, proxyManager);
        try {
            const result = await bot.run();
            if (result.success) {
                console.log(`\nExecution Result: Success | Username: ${result.username} | Total Points: ${result.totalPoints}`);
            } else {
                console.log(`\nExecution Result: Failed: ${result.error}`);
            }
        } catch (error) {
            console.error('\nMain execution failed:', error.message);
        }
    } else {
        console.log(`\nRunning for ${walletAddresses.length} accounts sequentially...`);
        
        const bots = walletAddresses.map(wallet => new TaskBot(wallet, proxyManager));
        
        for (let i = 0; i < bots.length; i++) {
            const bot = bots[i];
            console.log(`\n[${i+1}/${walletAddresses.length}] Processing wallet: ${walletAddresses[i].slice(0, 6)}...${walletAddresses[i].slice(-4)}`);
            
            try {
                const result = await bot.run();
                if (result.success) {
                    console.log(`\nExecution Result: Success | Username: ${result.username} | Total Points: ${result.totalPoints}`);
                } else {
                    console.log(`\nExecution Result: Failed: ${result.error}`);
                }
                
                if (i < bots.length - 1) {
                    console.log('\nWaiting 5 seconds before processing next account...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (error) {
                console.error(`\nExecution failed for wallet ${walletAddresses[i]}:`, error.message);
            }
        }
    }
}

main();
