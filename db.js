const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'community-data.json');

const MAX_CHAT_MESSAGES = 100;

const MAX_PRIVATE_MESSAGES = 50;

const DEFAULT_DATA = {
  players: {},
  missions: {},
  contributions: {},
  chat: [],
  profiles: {},
  friends: [],
  private_messages: []
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
  },

  // === PROFILES ===
  registerProfile(uuid, name) {
    if (!data.profiles) data.profiles = {};
    if (data.profiles[uuid]) return data.profiles[uuid];
    // Generate unique 4-digit tag
    let tag;
    const existingTags = new Set(Object.values(data.profiles).map(p => p.tag));
    do {
      tag = String(Math.floor(1000 + Math.random() * 9000));
    } while (existingTags.has(tag));
    data.profiles[uuid] = { name, tag, lastSeen: Math.floor(Date.now() / 1000) };
    save(data);
    return data.profiles[uuid];
  },

  getProfile(uuid) {
    if (!data.profiles) data.profiles = {};
    return data.profiles[uuid] || null;
  },

  updateProfileSeen(uuid) {
    if (!data.profiles) data.profiles = {};
    if (data.profiles[uuid]) {
      data.profiles[uuid].lastSeen = Math.floor(Date.now() / 1000);
    }
  },

  searchProfiles(query) {
    if (!data.profiles) data.profiles = {};
    const q = query.toLowerCase();
    const results = [];
    for (const [uuid, profile] of Object.entries(data.profiles)) {
      if (profile.name.toLowerCase().includes(q)) {
        results.push({ uuid, name: profile.name, tag: profile.tag });
      }
    }
    return results.slice(0, 20);
  },

  // === FRIENDS ===
  addFriendRequest(fromUuid, toUuid) {
    if (!data.friends) data.friends = [];
    if (fromUuid === toUuid) return false;
    const exists = data.friends.find(f =>
      (f.from === fromUuid && f.to === toUuid) ||
      (f.from === toUuid && f.to === fromUuid));
    if (exists) return false;
    data.friends.push({ from: fromUuid, to: toUuid, status: 'pending' });
    save(data);
    return true;
  },

  acceptFriend(uuid, fromUuid) {
    if (!data.friends) data.friends = [];
    const req = data.friends.find(f => f.from === fromUuid && f.to === uuid && f.status === 'pending');
    if (!req) return false;
    req.status = 'accepted';
    save(data);
    return true;
  },

  rejectFriend(uuid, fromUuid) {
    if (!data.friends) data.friends = [];
    const idx = data.friends.findIndex(f => f.from === fromUuid && f.to === uuid && f.status === 'pending');
    if (idx < 0) return false;
    data.friends.splice(idx, 1);
    save(data);
    return true;
  },

  removeFriend(uuid, targetUuid) {
    if (!data.friends) data.friends = [];
    const idx = data.friends.findIndex(f =>
      ((f.from === uuid && f.to === targetUuid) || (f.from === targetUuid && f.to === uuid))
      && f.status === 'accepted');
    if (idx < 0) return false;
    data.friends.splice(idx, 1);
    save(data);
    return true;
  },

  getFriendsList(uuid) {
    if (!data.friends) data.friends = [];
    if (!data.profiles) data.profiles = {};
    const cutoff = Math.floor(Date.now() / 1000) - 90;
    const friends = [];
    const pending = [];
    for (const f of data.friends) {
      if (f.status === 'accepted' && (f.from === uuid || f.to === uuid)) {
        const friendUuid = f.from === uuid ? f.to : f.from;
        const profile = data.profiles[friendUuid];
        if (profile) {
          friends.push({
            uuid: friendUuid,
            name: profile.name,
            tag: profile.tag,
            online: (data.players[friendUuid] || 0) > cutoff
          });
        }
      } else if (f.status === 'pending' && f.to === uuid) {
        const profile = data.profiles[f.from];
        if (profile) {
          pending.push({
            uuid: f.from,
            name: profile.name,
            tag: profile.tag
          });
        }
      }
    }
    return { friends, pending };
  },

  // === PRIVATE MESSAGES ===
  addPrivateMessage(fromUuid, toUuid, message) {
    if (!data.private_messages) data.private_messages = [];
    // Check they are friends
    if (!data.friends) data.friends = [];
    const areFriends = data.friends.find(f =>
      ((f.from === fromUuid && f.to === toUuid) || (f.from === toUuid && f.to === fromUuid))
      && f.status === 'accepted');
    if (!areFriends) return null;
    const fromProfile = data.profiles[fromUuid];
    const msg = {
      id: Date.now(),
      from: fromUuid,
      to: toUuid,
      playerName: fromProfile ? fromProfile.name : 'Agent',
      message: message.substring(0, 200),
      timestamp: Math.floor(Date.now() / 1000)
    };
    data.private_messages.push(msg);
    // Keep max per conversation
    const convKey = [fromUuid, toUuid].sort().join(':');
    const convMsgs = data.private_messages.filter(m =>
      [m.from, m.to].sort().join(':') === convKey);
    if (convMsgs.length > MAX_PRIVATE_MESSAGES) {
      const toRemove = convMsgs.slice(0, convMsgs.length - MAX_PRIVATE_MESSAGES);
      for (const r of toRemove) {
        const idx = data.private_messages.indexOf(r);
        if (idx >= 0) data.private_messages.splice(idx, 1);
      }
    }
    save(data);
    return msg;
  },

  getPrivateMessages(uuid, targetUuid, sinceId) {
    if (!data.private_messages) data.private_messages = [];
    return data.private_messages.filter(m =>
      ((m.from === uuid && m.to === targetUuid) || (m.from === targetUuid && m.to === uuid))
      && m.id > sinceId
    ).slice(-50);
  }
};
