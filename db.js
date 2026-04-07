const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'community-data.json');

const MAX_CHAT_MESSAGES = 100;

const DEFAULT_DATA = {
  players: {},
  missions: {},
  contributions: {},
  chat: []
};

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading DB:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let data = load();

module.exports = {
  // Player heartbeat
  upsertPlayer(uuid) {
    data.players[uuid] = Math.floor(Date.now() / 1000);
    save(data);
  },

  countOnline(timeoutSeconds) {
    const cutoff = Math.floor(Date.now() / 1000) - timeoutSeconds;
    let count = 0;
    for (const ts of Object.values(data.players)) {
      if (ts > cutoff) count++;
    }
    return count;
  },

  // Missions
  getMissions(weekId) {
    return data.missions[weekId] || [];
  },

  setMissions(weekId, missions) {
    data.missions[weekId] = missions;
    save(data);
  },

  addProgress(weekId, slot, amount) {
    const missions = data.missions[weekId];
    if (!missions) return;
    const m = missions.find(x => x.slot === slot);
    if (m) {
      m.current_progress = Math.min(m.target, m.current_progress + amount);
      save(data);
    }
  },

  // Player contributions
  getContributions(uuid, weekId) {
    const key = uuid + ':' + weekId;
    return data.contributions[key] || {};
  },

  addContribution(uuid, weekId, slot, amount) {
    const key = uuid + ':' + weekId;
    if (!data.contributions[key]) data.contributions[key] = {};
    if (!data.contributions[key][slot]) data.contributions[key][slot] = { contributed: 0, claimed: false };
    data.contributions[key][slot].contributed += amount;
    save(data);
  },

  claimSlot(uuid, weekId, slot) {
    const key = uuid + ':' + weekId;
    if (!data.contributions[key]) data.contributions[key] = {};
    if (!data.contributions[key][slot]) data.contributions[key][slot] = { contributed: 0, claimed: false };
    if (data.contributions[key][slot].claimed) return false;
    data.contributions[key][slot].claimed = true;
    save(data);
    return true;
  },

  isSlotClaimed(uuid, weekId, slot) {
    const key = uuid + ':' + weekId;
    return data.contributions[key]?.[slot]?.claimed || false;
  },

  // Chat
  addChatMessage(uuid, playerName, message) {
    if (!data.chat) data.chat = [];
    const msg = {
      id: Date.now(),
      uuid,
      playerName,
      message: message.substring(0, 200),
      timestamp: Math.floor(Date.now() / 1000)
    };
    data.chat.push(msg);
    if (data.chat.length > MAX_CHAT_MESSAGES) {
      data.chat = data.chat.slice(-MAX_CHAT_MESSAGES);
    }
    save(data);
    return msg;
  },

  getChatMessages(sinceId) {
    if (!data.chat) data.chat = [];
    if (sinceId > 0) {
      return data.chat.filter(m => m.id > sinceId);
    }
    return data.chat.slice(-50);
  }
};
