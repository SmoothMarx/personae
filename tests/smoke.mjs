/**
 * Live smoke test against THIS host's real Xvnc: the plugin's RFB client, driven
 * by an actual TigerVNC session over the profile's Unix socket. Fixtures prove
 * the parser; only a real server proves the handshake, the pixel format and the
 * rect framing.
 *
 * Needs a running screen for the profile whose socket you point at (the pane's own
 * Start, or `python -c "from tools.bot_desktop import runtime; runtime.start()"`), and a
 * copy of plugin.js built beside it: `./tests/run.sh` writes tests/work/plugin.js, then
 *
 *   cd tests && RFB_CAPTURE=../client-stream.bin node smoke.mjs
 *
 * PLUGIN_PATH overrides which plugin.js to import. RFB_CAPTURE waits out the handshake
 * and writes the client→server byte stream, so the gateway's own
 * `tools/bot_desktop/rfb_filter.py` can be fed it (holder: byte-identical pass-through;
 * watcher: exactly the input messages dropped).
 */

import net from 'node:net'

const ENTRY = process.env.PLUGIN_PATH || new URL('./work/plugin.js', import.meta.url).href
const { __internals } = await import(ENTRY)

const SOCKET = process.env.RFB_SOCKET || `${process.env.HOME}/.hermes/bot-desktop/rfb.sock`
const results = []

const socket = net.connect(SOCKET)
const frames = []
const notes = []
const sent = []
const clientBytes = []
let size = null
let pixels = null

const stream = __internals.createRfbStream({
  onFramebuffer: frame => {
    frames.push(frame)
    stream.ack()
  },
  onNote: note => notes.push(note),
  onSize: next => {
    size = next
    pixels = new Uint8ClampedArray(next.width * next.height * 4)

    return pixels
  },
  send: part => {
    sent.push(part.length)
    clientBytes.push(Buffer.from(part))
    socket.write(Buffer.from(part))
  }
})

socket.on('data', chunk => stream.feed(new Uint8Array(chunk)))
socket.on('error', error => results.push(['socket error', String(error.message)]))
socket.on('close', () => results.push(['socket closed', '']))

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

await wait(2500)
results.push(['handshake state', stream.state])
results.push(['framebuffer size', size ? `${size.width}x${size.height}` : 'none'])
results.push(['frames decoded', String(frames.length)])
results.push(['protocol notes', notes.join(' | ') || 'none'])
results.push(['client messages sent (bytes)', sent.join(',')])

if (pixels) {
  const colours = new Map()
  let opaque = 0

  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] === 255) {
      opaque += 1
    }

    const key = `${pixels[at]},${pixels[at + 1]},${pixels[at + 2]}`

    colours.set(key, (colours.get(key) || 0) + 1)
  }

  const top = [...colours.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3)

  results.push(['opaque pixels', `${opaque} of ${pixels.length / 4}`])
  results.push(['distinct colours', String(colours.size)])
  results.push(['dominant colours', top.map(([key, count]) => `${key}×${count}`).join(' / ')])
}

// Input, over the real socket: a pointer move and one keystroke, built by the
// SAME builders the pane forwards with. Xvnc keeps the connection only if every
// message we sent was exactly the length it expects — a desynced client gets a
// dropped socket, not a wrong cursor.
const inputBytes = [
  Buffer.from(__internals.rfbPointerMessage(0, 200, 150)),
  Buffer.from(__internals.rfbKeyMessage(true, __internals.keysymFor('a', 'KeyA'))),
  Buffer.from(__internals.rfbKeyMessage(false, __internals.keysymFor('a', 'KeyA')))
]

inputBytes.forEach(part => socket.write(part))
clientBytes.push(...inputBytes)

const before = frames.length

await wait(1500)

results.push(['frames after input', String(frames.length - before)])
results.push(['still connected after input', socket.destroyed ? 'no' : 'yes'])

socket.destroy()

// The exact client→server byte stream, for the bridge's own filter to parse.
const capture = process.env.RFB_CAPTURE

if (capture) {
  const { writeFileSync } = await import('node:fs')

  writeFileSync(capture, Buffer.concat(clientBytes))
  console.log(`  client stream captured: ${Buffer.concat(clientBytes).length} bytes → ${capture}`)
}

results.forEach(([name, value]) => console.log(`  ${name}: ${value}`))

const ok =
  stream.state === 'ready' &&
  size?.width > 0 &&
  frames.length > 0 &&
  !notes.length &&
  sent.length >= 6 &&
  sent[0] === 12 &&
  sent[1] === 1 &&
  sent[2] === 1 &&
  sent[3] === 20 &&
  sent[4] === 12 &&
  sent[5] === 10

console.log(ok ? '\nLIVE RFB SMOKE: PASS' : '\nLIVE RFB SMOKE: FAIL')

process.exit(ok ? 0 : 1)
