import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import pino from "pino";
import Fuse from "fuse.js";
import { locations } from "./locations.js";

const logger = pino({ level: "silent" });

async function start() {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: state,
    version,
    logger
  });

  // 🔹 SAVE SESSION
  sock.ev.on("creds.update", saveCreds);

  // 🔹 QR + CONNECTION HANDLER (THIS WAS MISSING)
  sock.ev.on("connection.update", (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.log("\n📲 SCAN THIS QR CODE NOW:\n");
      console.log(qr);
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected successfully");
    }

    if (connection === "close") {
      console.log("❌ Connection closed. Restart the bot if needed.");
    }
  });

  // 🔹 PREPARE SEARCH DATA
  const locItems = Object.keys(locations).map((key) => ({
    key,
    name: locations[key].name || key,
    maps_link: locations[key].maps_link,
    description: locations[key].description || ""
  }));

  const fuse = new Fuse(locItems, {
    keys: ["key", "name", "description"],
    threshold: 0.35
  });

  // 🔹 STORE PENDING SUGGESTIONS
  const pendingReplies = new Map();

  // 🔹 MESSAGE HANDLER
  sock.ev.on("messages.upsert", async ({ messages }) => {
    if (!messages || !messages[0]) return;

    const msg = messages[0];
    if (msg.key.remoteJid === "status@broadcast") return;

    const from = msg.key.remoteJid;

    let text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      "";

    text = text.toLowerCase().trim();
    if (!text) return;

    // 🔹 NUMBER SELECTION HANDLING
    if (/^[1-4]$/.test(text) && pendingReplies.has(from)) {
      const results = pendingReplies.get(from);
      const choice = results[parseInt(text) - 1];
      pendingReplies.delete(from);

      if (!choice) {
        await sock.sendMessage(from, { text: "Invalid choice." });
        return;
      }

      await sock.sendMessage(from, {
        text: formatLocation(choice.item)
      });
      return;
    }

    // 🔹 DIRECT MATCH
    for (const key of Object.keys(locations)) {
      if (text.includes(key)) {
        await sock.sendMessage(from, {
          text: formatLocation(locations[key])
        });
        return;
      }
    }

    // 🔹 FUZZY SEARCH
    const results = fuse.search(text, { limit: 4 });

    if (results.length === 0) {
      await sock.sendMessage(from, {
        text:
          "❌ Location not found.\nTry things like:\n• lr 18\n• school clinic\n• library\n• admissions"
      });
      return;
    }

    // 🔹 STRONG MATCH
    if (results[0].score <= 0.32) {
      await sock.sendMessage(from, {
        text: formatLocation(results[0].item)
      });
      return;
    }

    // 🔹 MULTIPLE SUGGESTIONS
    pendingReplies.set(from, results);
    const list = results
      .map((r, i) => `${i + 1}. ${r.item.name}`)
      .join("\n");

    await sock.sendMessage(from, {
      text: `I found multiple matches. Reply with a number:\n\n${list}`
    });
  });

  console.log("🤖 Bot started. Waiting for QR scan...");
}

// 🔹 FORMAT REPLY
function formatLocation(loc) {
  const link =
    loc.maps_link && !loc.maps_link.startsWith("http")
      ? `https://www.google.com/maps?q=${loc.maps_link}`
      : loc.maps_link;

  return `🏫 *${loc.name}*\n\n📍 ${link}\n\nℹ️ ${loc.description || ""}`;
}

start();
