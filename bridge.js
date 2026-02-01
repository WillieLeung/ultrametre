require('dotenv').config(); 
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const snowflake = require('snowflake-sdk');
const { SerialPort } = require('serialport');
const { Connection, clusterApiUrl, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const HTTP_PORT = 3000;
const SERIAL_PATH = 'COM5';
const SERIAL_BAUD = 9600;
const ROBOT_WALLET = new PublicKey('DsjJMaAxPoXARLsCW3uc3ThheAiy4b5ebUB7WzufDKwd');

const snowflakeConn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASS,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA
});

snowflakeConn.connect((err) => {
    if (err) console.error('Snowflake Connection Error:', err.message);
    else console.log('Connected to Snowflake.');
});

let port = null;
let subscriptionId = null;
let running = false;
let sseClients = [];
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(res => res.write(payload));
}

async function startBridge() {
    if (running || (port && port.isOpen)) {
        console.log("Bridge is already running.");
        return { ok: true };
    }
    
    // Create port instance
    port = new SerialPort({ path: SERIAL_PATH, baudRate: SERIAL_BAUD, autoOpen: false });
    
    return new Promise((resolve) => {
        port.open((err) => {
            if (err) {
                console.error('Serial Port Error:', err.message);
                return resolve({ ok: false, error: err.message });
            }
            
            console.log(`Serial Port ${SERIAL_PATH} Opened.`);

            port.on('data', (chunk) => {
                const rawData = chunk.toString().trim();
                if (!rawData || rawData.includes("---")) return;
                if (rawData.includes("TOTAL_DISTANCE")) {
                    broadcast('serial', { text: rawData });
                    return; 
                }

                const parts = rawData.split(',');
                if (parts.length === 2) {
                    const dist = parseFloat(parts[0]);
                    const angle = parseFloat(parts[1]);

                    if (!isNaN(dist) && !isNaN(angle)) {
                        const rad = angle * (Math.PI / 180);
                        const x = dist * Math.cos(rad);
                        const y = dist * Math.sin(rad);
                        const timestamp = new Date().toISOString();

                        snowflakeConn.execute({
                            sqlText: `INSERT INTO ROOM_DATA (DISTANCE_CM, ANGLE_DEG, X_COORD, Y_COORD, RECORDED_AT) VALUES (?, ?, ?, ?, ?)`,
                            binds: [dist, angle, x, y, timestamp],
                            complete: (err) => {
                                if (err) console.error('Snowflake Insert Error:', err.message);
                                else {console.log(`Data Uploaded`);}
                            }
                        });
                    }
                }
            });

            port.on('close', () => { 
                running = false; 
                broadcast('status', { running: false }); 
            });

            // FIXED: Use lowercase 'connection' and add (info) parameter
            subscriptionId = connection.onAccountChange(ROBOT_WALLET, (info) => {
                if(port && port.isOpen) port.write('F\n');
            }, 'processed');

            running = true;
            broadcast('status', { running: true });
            resolve({ ok: true });
        });
    });
}

const app = express();
app.use(express.json());

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/bridge/status', (req, res) => res.json({ running }));

app.post('/bridge/start', async (req, res) => {
    const result = await startBridge();
    res.json(result);
});

app.post('/bridge/stop', async (req, res) => {
    // FIXED: Use lowercase 'connection'
    if (subscriptionId) await connection.removeAccountChangeListener(subscriptionId);
    if (port && port.isOpen) port.close();
    running = false;
    res.json({ ok: true });
});

app.post('/bridge/fetch-data', (req, res) => {
    if (port && port.isOpen) {
        port.write('D\n');
        return res.json({ ok: true });
    }
    res.status(400).json({ ok: false, error: 'Port closed' });
});

app.post('/bridge/clear', (req, res) => {
    if (port && port.isOpen) {
        port.write('C\n');
        return res.json({ ok: true });
    }
    res.status(400).json({ ok: false, error: 'Port closed' });
});

app.post('/bridge/send', async (req, res) => {
    try {
        const { amount } = req.body;
        const keyPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
        const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')));
        const fromKeypair = Keypair.fromSecretKey(secretKey);
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: ROBOT_WALLET,
                lamports: Math.round(parseFloat(amount) * LAMPORTS_PER_SOL),
            })
        );

        const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);
        if (port && port.isOpen) port.write('F\n');
        res.json({ ok: true, signature });
    } catch (e) { 
        console.error('Solana Error:', e.message);
        res.status(400).json({ ok: false, error: e.message }); 
    }
});

app.get('/bridge/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    sseClients.push(res);
    req.on('close', () => sseClients = sseClients.filter(c => c !== res));
});

app.listen(HTTP_PORT, () => console.log(`Server running at http://localhost:${HTTP_PORT}`));