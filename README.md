# Stuff Your Stocking 🎄

A Deal or No Deal–style game show that runs entirely in the browser. It has two pages:

| Page | URL | What it's for |
|---|---|---|
| **Audience board** | `/` | The prize board for the TV or projector. Values get crossed out live as cases are opened. |
| **Host controls** | `/host` | PIN-protected. Pick the contestant's case, open cases, make banker offers, run Deal / No Deal and the final keep-or-swap. |

The host and the board can be on different devices, for example the host on a phone or tablet and the board on a laptop plugged into the TV. Any change shows up on every connected screen right away.

## Running a game

1. Open `/` on the display machine. Double-click the board or press **F** to go fullscreen.
2. Open `/host` on the host device and enter the PIN.
3. Press **New game**. The cases are shuffled using a cryptographically secure random number generator.
4. Tap the contestant's case, then tap the cases they choose to open. The banner tells you how many are left this round.
5. When the round ends, the banker panel shows a suggested offer. You can type over it, then press **DEAL** or **NO DEAL**.
6. With two cases left, choose **Keep** or **Swap**.

**Undo** (or the **U** key) reverses the last step, which helps after a mis-tap. **Show contents** reveals every case to the host only. The audience board never receives which case holds which prize, so it can't leak through the display's browser.

## Settings (host page → Settings tab)

- **Board:** title, prize values (any number from 2 to 100), number of columns, colors, and falling snow on or off.
- **Banker:** the offer is the average of the remaining prizes times a percentage. The percentage rises from *First offer %* to *Last offer %* across the game and is rounded to *Round to $*.
- **Round presets:** saved schedules of how many cases to open each round. The default is `6, 5, 4, 3, 2, 1, 1`. A schedule automatically adapts to however many cases there are and always ends on a final two. Each preset shows a preview, for example *With 20 cases: 6 → 5 → 4 → 3 then final two*.
- **Export / Import:** back up your settings as a JSON file, or move them to another server.

Prize and preset changes take effect at the next **New game**. Look and banker changes apply immediately.

## Running locally

```bash
npm install
HOST_PIN=1234 npm start      # http://localhost:3000 and http://localhost:3000/host
npm test                     # game-logic tests
```

## Deploying

Any always-on Node 20+ host works (Render, Railway, Fly.io, a VPS). On Render, `render.yaml` sets this up as a Blueprint on the **Starter** plan with a small persistent disk.

| Env var | Purpose |
|---|---|
| `HOST_PIN` | **Required in production.** The PIN for `/host`. If it isn't set, anyone can control the game, and the server logs a warning. |
| `DATA_DIR` | Folder where the game state and settings are saved (`state.json`). Point it at a persistent disk so a restart or redeploy doesn't lose anything. |
| `PORT` | Set automatically by most hosts. |

## How it works

```
public/js/game.js    shared game rules (pure functions), used by both the server and the host page
server.js            static files + WebSocket at /ws; owns the game state and saves it to disk
public/index.html    audience board   (js/display.js, css/display.css)
public/host.html     host controls    (js/host.js,    css/host.css)
```

The server is the single source of truth. The host page sends actions such as `openCase` and `deal`. The server checks each one against the shared rules, saves the result and pushes the new state to every screen. The board receives only prize values and crossed-out flags.

### Changes from v1 (Excel + polling)

- The Excel workbook and VBA macro are gone. The whole game runs in the browser.
- WebSocket push replaces 500 ms polling, so updates are instant and there's no constant traffic.
- The game state is saved to disk, so a restart no longer wipes it.
- A PIN now protects host actions. In v1, anyone could post to `/api/update` or `/api/reset`.
- Dropped connections reconnect automatically, and the board keeps the screen awake.
- The only runtime dependency is `ws`. Express and CORS are no longer needed.
