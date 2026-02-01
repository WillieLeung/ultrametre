const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SerialPort } = require('serialport');
const { Connection, clusterApiUrl, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const HTTP_PORT = 3000;
const SERIAL_PATH = 'COM5';
const SERIAL_BAUD = 9600;
const ROBOT_WALLET = new PublicKey('DsjJMaAxPoXARLsCW3uc3ThheAiy4b5ebUB7WzufDKwd');

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
  if (running) return { ok: true };

  port = new SerialPort({ path: SERIAL_PATH, baudRate: SERIAL_BAUD, autoOpen: false });

  return new Promise((resolve) => {
    port.open((err) => {
      if (err) return resolve({ ok: false, error: err.message });

      port.set({ dtr: true, rts: true }, () => {
        setTimeout(() => {
          port.on('data', (chunk) => {
            broadcast('serial', { text: chunk.toString() });
          });

          subscriptionId = connection.onAccountChange(ROBOT_WALLET, (info) => {
            if (port && port.isOpen) {
              port.write('F');
              port.drain();
              broadcast('sent', { msg: 'F' });
            }
          }, 'processed');

          running = true;
          broadcast('status', { running: true, port: SERIAL_PATH });
          resolve({ ok: true });
        }, 2000);
      });
    });
  });
}

async function stopBridge() {
  if (!running) return { ok: true };
  if (subscriptionId) {
    connection.removeAccountChangeListener(subscriptionId).catch(() => {});
    subscriptionId = null;
  }
  return new Promise((resolve) => {
    if (port && port.isOpen) {
      port.close(() => {
        running = false;
        port = null;
        broadcast('status', { running: false });
        resolve({ ok: true });
      });
    } else {
      running = false;
      resolve({ ok: true });
    }
  });
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get('/bridge/status', (req, res) => res.json({ running, port: running ? SERIAL_PATH : null }));
app.post('/bridge/start', async (req, res) => res.json(await startBridge()));
app.post('/bridge/stop', async (req, res) => res.json(await stopBridge()));

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
    
    if (port && port.isOpen) {
      port.write('F'); 
      port.drain();
    }
    
    res.json({ ok: true, signature });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/bridge/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  sseClients.push(res);
  req.on('close', () => sseClients = sseClients.filter(c => c !== res));
});

app.listen(HTTP_PORT, () => console.log(`Dashboard: http://localhost:${HTTP_PORT}`));