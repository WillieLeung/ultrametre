# Ultrametre

Ultrametre is a compact, real-time bridge that connects an Arduino-based distance-tracking robot to a simple web dashboard and Solana-powered triggers. It is designed for quick demos and prototyping: send a small SOL payment to trigger the robot, observe live serial output in the browser, and fetch or reset the stored distance remotely.

## Key features

- Lightweight Node.js bridge with a responsive web UI
- Real-time serial streaming via Server-Sent Events (SSE)
- Solana integration: send SOL to a configured wallet to trigger the robot
- Robust fetch with automatic retries when the Arduino does not immediately respond
- Simple serial control protocol: `F` (start), `S` (stop), `D` (dump distance), `C` (clear) — all documented in the Arduino sketch
- Well-commented codebase for easy modification and extension

## Promotional summary

Ultrametre packages a complete demo-ready stack for hardware + blockchain interactions. It is an excellent fit for classrooms, hackathons, and prototype showcases where you want reliable serial telemetry and a low-friction way to demonstrate remote triggers (using Solana test tokens on devnet).

Why use Ultrametre:
- Minimal setup: single Node server and an Arduino sketch
- Clear UX: live feed, status indicators, and buttons for remote control
- Extendable: easily swap the serial commands, tweak UI styles, or connect different payment triggers

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure the serial port if needed (default is `COM5`) by editing `bridge.js` and setting `SERIAL_PATH`.

3. Ensure you have a Solana keypair available at `~/.config/solana/id.json` if you plan to use the send flow. By default the bridge uses the `devnet` cluster for testing.

4. Start the bridge:

   ```bash
   npm start
   # or
   node bridge.js
   ```

5. Open the UI: `http://localhost:3000`

6. Upload and run the Arduino sketch in `bot/bot.ino` on your board.

## Web UI and endpoints

- UI: `GET /` (open in a browser)
- SSE (live serial + status updates): `GET /bridge/events`
- Status: `GET /bridge/status` → `{ running: boolean }`
- Start bridge (open serial + subscribe to Solana): `POST /bridge/start`
- Stop bridge: `POST /bridge/stop`
- Fetch current distance from Arduino: `POST /bridge/fetch-data` (the bridge will retry a few times if the device doesn't respond immediately)
- Clear distance (Arduino): `POST /bridge/clear`
- Send SOL and trigger robot: `POST /bridge/send` with JSON body `{ "amount": "0.01" }`

## Arduino serial protocol

The Arduino sketch (`bot/bot.ino`) uses these serial commands and outputs:

- `F` — start movement mode (robot moves and accumulates distance)
- `S` — stop movement mode
- `D` — Arduino responds with `TOTAL_DISTANCE_TRAVELLED: <value>`
- `C` — reset stored distance; Arduino responds with `DISTANCE_RESET`

Distance is stored in EEPROM (persisted across reboots).

## Troubleshooting

- "Port closed" errors: verify the correct serial port is set in `bridge.js` (`SERIAL_PATH`) and the board is connected.
- Permission errors (Unix): ensure your user has access to the serial device (add user to `dialout`/`uucp`, or use sudo for testing).
- If Solana transactions fail, confirm the `id.json` path and that you're using the expected cluster (`devnet` by default). Do not use mainnet credentials for testing.
