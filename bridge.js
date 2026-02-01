// bridge.js — Ultrametre bridge server
// - Exposes a small HTTP UI and Server-Sent Events (SSE) stream
// - Manages a serial connection to the Arduino and listens for Solana account changes
// - Forwards serial messages to the UI and exposes control endpoints (start/stop/fetch/clear/send)

const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { SerialPort } = require("serialport");
const {
  Connection,
  clusterApiUrl,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const HTTP_PORT = 3000;
const SERIAL_PATH = "COM5";
const SERIAL_BAUD = 9600;
const ROBOT_WALLET = new PublicKey(
  "DsjJMaAxPoXARLsCW3uc3ThheAiy4b5ebUB7WzufDKwd",
);

let port = null;
let subscriptionId = null;
let running = false;
let sseClients = [];
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// Broadcast an SSE (Server-Sent Event) message to all connected clients
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => res.write(payload));
}

// Start the serial bridge: open serial port, attach listeners, and begin watching Solana account
async function startBridge() {
  if (running) return { ok: true };
  port = new SerialPort({
    path: SERIAL_PATH,
    baudRate: SERIAL_BAUD,
    autoOpen: false,
  });

  return new Promise((resolve) => {
    port.open((err) => {
      if (err) return resolve({ ok: false, error: err.message });

      // Forward raw serial data to any connected SSE clients
      port.on("data", (chunk) =>
        broadcast("serial", { text: chunk.toString() }),
      );

      // Handle port close to update status
      port.on("close", () => {
        running = false;
        broadcast("status", { running: false });
      });

      // Subscribe to the Solana account and trigger the robot when a change is detected
      subscriptionId = connection.onAccountChange(
        ROBOT_WALLET,
        () => {
          if (port.isOpen) port.write("F\n");
        },
        "processed",
      );

      running = true;
      broadcast("status", { running: true });
      resolve({ ok: true });
    });
  });
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Status endpoint: returns whether the bridge is running
app.get("/bridge/status", (req, res) => res.json({ running }));

// Start the bridge (open serial and begin monitoring Solana)
app.post("/bridge/start", async (req, res) => res.json(await startBridge()));

// Stop the bridge and remove Solana subscription
app.post("/bridge/stop", async (req, res) => {
  if (subscriptionId)
    await connection.removeAccountChangeListener(subscriptionId);
  if (port && port.isOpen) port.close();
  running = false;
  res.json({ ok: true });
});

app.post("/bridge/fetch-data", async (req, res) => {
  if (!port || !port.isOpen) {
    return res.status(400).json({ ok: false, error: "Port closed" });
  }

  const maxAttempts = 3; // number of write attempts
  const timeoutMs = 1500; // ms to wait for a matching response per attempt

  function waitForSerialMatch(regex, timeout) {
    return new Promise((resolve) => {
      let onData = (chunk) => {
        try {
          const text = chunk.toString();
          const m = text.match(regex);
          if (m) {
            port.removeListener("data", onData);
            clearTimeout(timer);
            resolve(m);
          }
        } catch (e) {
          // ignore parse errors from partial/garbled serial chunks
        }
      };
      port.on("data", onData);
      const timer = setTimeout(() => {
        port.removeListener("data", onData);
        resolve(null);
      }, timeout);
    });
  }

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      port.write("D\n");
    } catch (e) {
      // ignore write errors (port may transiently fail) and continue to retry
    }
    // wait for a line like: TOTAL_DISTANCE_TRAVELLED: 123
    const m = await waitForSerialMatch(
      /TOTAL_DISTANCE_TRAVELLED:\s*([-+]?\d+(?:\.\d+)?)/i,
      timeoutMs,
    );
    if (m) {
      return res.json({ ok: true, distance: m[1], attempts: i });
    }
    // small pause before retrying
    await new Promise((r) => setTimeout(r, 400));
  }

  return res.json({
    ok: false,
    error: "No response from device",
    attempts: maxAttempts,
  });
});

// Request the Arduino to clear its saved distance value
app.post("/bridge/clear", (req, res) => {
  if (port && port.isOpen) {
    port.write("C\n");
    return res.json({ ok: true });
  }
  res.status(400).json({ ok: false, error: "Port closed" });
});

// Send SOL to the robot's wallet, then trigger the robot by writing 'F' to serial
app.post("/bridge/send", async (req, res) => {
  try {
    const { amount } = req.body;
    const keyPath = path.join(os.homedir(), ".config", "solana", "id.json");
    const secretKey = Uint8Array.from(
      JSON.parse(fs.readFileSync(keyPath, "utf8")),
    );
    const fromKeypair = Keypair.fromSecretKey(secretKey);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: ROBOT_WALLET,
        lamports: Math.round(parseFloat(amount) * LAMPORTS_PER_SOL),
      }),
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [
      fromKeypair,
    ]);
    if (port && port.isOpen) port.write("F\n");
    res.json({ ok: true, signature });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// SSE endpoint: the UI connects here to receive continuous serial/status updates
app.get("/bridge/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sseClients.push(res);
  req.on("close", () => (sseClients = sseClients.filter((c) => c !== res)));
});

// Start the HTTP server
app.listen(HTTP_PORT, () => console.log(`http://localhost:${HTTP_PORT}`));
