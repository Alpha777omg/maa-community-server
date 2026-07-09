  const fs = require('fs');
  const path = require('path');

  const DB_FILE = path.join(__dirname, 'community-data.json');

  const MAX_CHAT_MESSAGES = 100;                                                                                        
  const MAX_PRIVATE_MESSAGES = 50;                                                                                      
  const LOCK_TIMEOUT = 1800;
  const COOP_REQUEST_TTL = 10800; // 3h: stale help requests drop off the public board

  const DEFAULT_DATA = {
    players: {},
    missions: {},
    contributions: {},
    chat: [],
    profiles: {},
    coop: {},
    friends: [],
    private_messages: [],
    pvp_teams: {}
  };

  const MAX_PVP_TEAMS = 2000;

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

    // Chapter sub-mission progress; completing one pushes the front by `bonus`.
    // Completing ALL of them FORTIFIES the front (immune to the villain push).
    // Returns { fortified, name, chapter } when the last sub-mission completes.
    addSubProgress(weekId, slot, sub, amount, bonus) {
      const missions = data.missions[weekId];
      if (!missions) return null;
      const m = missions.find(x => x.slot === slot);
      if (!m || !Array.isArray(m.sub_missions)) return null;
      const s = m.sub_missions.find(x => x.sub === sub);
      if (!s || s.completed) return null;
      s.current_progress = Math.min(s.target, s.current_progress + amount);
      let result = null;
      if (s.current_progress >= s.target) {
        s.completed = true;
        m.current_progress = Math.min(m.target, m.current_progress + bonus);
        console.log(`[SubMission] ${weekId} slot ${slot} sub ${sub} (${s.display_name}) COMPLETED -> front +${bonus}`);
        if (m.sub_missions.every(x => x.completed) && !m.fortified) {
          m.fortified = true;
          console.log(`[SubMission] ${weekId} slot ${slot} (${m.display_name}) FORTIFIED`);
          result = { fortified: true, name: m.display_name, chapter: m.chapter || 0 };
        }
      }
      save(data);
      return result;
    },

    // ── Battle fronts (global ops v2) ────────────────────────────────────────
    // Records that an agent fought on a front (used to count active defenders).
    touchFrontActivity(weekId, slot, uuid) {
      if (!data.frontActivity) data.frontActivity = {};
      const key = weekId + ':' + slot;
      if (!data.frontActivity[key]) data.frontActivity[key] = {};
      data.frontActivity[key][uuid] = Math.floor(Date.now() / 1000);
      save(data);
    },

    // Distinct agents that fought on a front within the last windowSec.
    countRecentDefenders(weekId, slot, windowSec) {
      const key = weekId + ':' + slot;
      const act = (data.frontActivity && data.frontActivity[key]) || {};
      const cutoff = Math.floor(Date.now() / 1000) - windowSec;
      let n = 0;
      for (const ts of Object.values(act)) if (ts >= cutoff) n++;
      return n;
    },

    // Victories won ON the front's mission, bucketed by hour (defense = effort).
    addFrontWins(weekId, slot, amount) {
      if (!data.frontWins) data.frontWins = {};
      const key = weekId + ':' + slot;
      if (!data.frontWins[key]) data.frontWins[key] = {};
      const hour = Math.floor(Date.now() / 3600000);
      data.frontWins[key][hour] = (data.frontWins[key][hour] || 0) + amount;
      for (const h of Object.keys(data.frontWins[key])) {
        if (hour - Number(h) > 24) delete data.frontWins[key][h];   // prune old buckets
      }
      save(data);
    },

    countRecentWins(weekId, slot, windowSec) {
      const key = weekId + ':' + slot;
      const buckets = (data.frontWins && data.frontWins[key]) || {};
      const cutoffHour = Math.floor((Date.now() - windowSec * 1000) / 3600000);
      let n = 0;
      for (const [h, amt] of Object.entries(buckets)) {
        if (Number(h) >= cutoffHour) n += amt;
      }
      return n;
    },

    // Villain counter-attack tick: subtract progress and record the tick state.
    // Tracks the losing streak (consecutive ticks with loss) for chat alarms.
    applyFrontPush(weekId, slot, defenders, loss, wins) {
      const missions = data.missions[weekId];
      if (!missions) return null;
      const m = missions.find(x => x.slot === slot);
      if (!m) return null;
      m.defenders = defenders;
      m.recent_wins = wins || 0;
      m.last_push = loss;
      if (loss > 0) {
        m.current_progress = Math.max(0, m.current_progress - loss);
        m.push_streak = (m.push_streak || 0) + 1;
      } else {
        m.push_streak = 0;
      }
      save(data);
      return { progress: m.current_progress, streak: m.push_streak };
    },

    // One-shot "front below 25%" alarm flag (one alert per front per week).
    markFrontLowAlert(weekId, slot) {
      const missions = data.missions[weekId];
      if (!missions) return;
      const m = missions.find(x => x.slot === slot);
      if (m) { m.alert_low_sent = true; save(data); }
    },

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

    addChatMessage(uuid, playerName, message, agentLevel) {
      if (!data.chat) data.chat = [];
      const msg = {
        id: Date.now(),
        uuid,
        playerName,
        message: message.substring(0, 200),
        agentLevel: parseInt(agentLevel) || 0,
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

    registerProfile(uuid, name) {
      if (!data.profiles) data.profiles = {};
      if (data.profiles[uuid]) return data.profiles[uuid];
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

    // Public profile stats (shared so other players can view a profile)
    updateProfileStats(uuid, name, stats) {
      if (!data.profiles) data.profiles = {};
      let p = data.profiles[uuid];
      if (!p) {
        let tag;
        const existing = new Set(Object.values(data.profiles).map(x => x.tag));
        do { tag = String(Math.floor(1000 + Math.random() * 9000)); } while (existing.has(tag));
        p = data.profiles[uuid] = { name: (name || 'Agent').substring(0, 30), tag, lastSeen: Math.floor(Date.now() / 1000) };
      }
      if (name) p.name = name.substring(0, 30);
      p.stats = stats || {};
      p.lastSeen = Math.floor(Date.now() / 1000);
      save(data);
      return p;
    },

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

    addPrivateMessage(fromUuid, toUuid, message) {
      if (!data.private_messages) data.private_messages = [];
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
    },

    areFriends(uuid1, uuid2) {
      if (!data.friends) return false;
      return !!data.friends.find(f =>
        ((f.from === uuid1 && f.to === uuid2) || (f.from === uuid2 && f.to === uuid1))
        && f.status === 'accepted');
    },

    shareMission(uuid, missionData) {
      if (!data.coop) data.coop = {};
      if (!data.coop[uuid]) data.coop[uuid] = { missionData: null, locks: {}, lastUpdated: 0 };
      data.coop[uuid].missionData = missionData;
      data.coop[uuid].lastUpdated = Math.floor(Date.now() / 1000);
      save(data);
    },

    getCoopMission(ownerUuid) {
      if (!data.coop) data.coop = {};
      this.cleanStaleLocks();
      return data.coop[ownerUuid] || null;
    },

    // Owner re-syncs their current mission state to an EXISTING request (no-op if they
    // never asked for help). Merges: an event already cleared on the server (by a helper)
    // is never downgraded back to pending, so helper progress isn't lost in a race.
    refreshMission(uuid, missionData) {
      if (!data.coop || !data.coop[uuid]) return false;
      const existing = data.coop[uuid].missionData;
      // If the incoming publish has at least one cleared battle, the owner is mid-run, so we
      // merge (never downgrade a battle a helper just finished). But if EVERY incoming event
      // is pending, the owner has restarted the mission fresh — discard the previous run's
      // completions instead of resurrecting them.
      const ownerProgressed = missionData && Array.isArray(missionData.events) &&
        missionData.events.some((e) => e && e.score > 0);
      if (ownerProgressed && existing && Array.isArray(existing.events) && missionData && Array.isArray(missionData.events)) {
        const serverScore = {};
        for (const e of existing.events) {
          if (e && e.eventId) serverScore[e.eventId] = e.score || 0;
        }
        for (const e of missionData.events) {
          if (e && e.eventId && serverScore[e.eventId] > 0 && !(e.score > 0)) {
            e.score = serverScore[e.eventId];
          }
        }
      }
      data.coop[uuid].missionData = missionData;
      data.coop[uuid].lastUpdated = Math.floor(Date.now() / 1000);
      save(data);
      return true;
    },

    lockBattle(ownerUuid, eventId, helperUuid, helperName, agentLevel) {
      if (!data.coop || !data.coop[ownerUuid]) return false;
      const entry = data.coop[ownerUuid];
      if (!entry.locks) entry.locks = {};
      // Allow the SAME helper to re-claim their own lock (e.g. backed out then retried
      // before the unlock propagated). Only block when someone ELSE holds it.
      if (entry.locks[eventId] && entry.locks[eventId].lockedBy !== helperUuid) return false;
      const evt = entry.missionData?.events?.find(e => e.eventId === eventId);
      if (!evt || evt.score > 0) return false;
      entry.locks[eventId] = { lockedBy: helperUuid, lockedAt: Math.floor(Date.now() / 1000), playerName: helperName, agentLevel: agentLevel || 0 };
      save(data);
      return true;
    },

    unlockBattle(ownerUuid, eventId, helperUuid) {
      if (!data.coop || !data.coop[ownerUuid]) return false;
      const entry = data.coop[ownerUuid];
      if (!entry.locks || !entry.locks[eventId]) return false;
      if (entry.locks[eventId].lockedBy !== helperUuid) return false;
      delete entry.locks[eventId];
      save(data);
      return true;
    },

    completeBattle(ownerUuid, eventId, helperUuid, score) {
      if (!data.coop || !data.coop[ownerUuid]) return { success: false, error: 'no coop data' };
      const entry = data.coop[ownerUuid];
      if (!entry.locks || !entry.locks[eventId]) return { success: false, error: 'not locked' };
      if (entry.locks[eventId].lockedBy !== helperUuid) return { success: false, error: 'wrong helper' };
      const evt = entry.missionData?.events?.find(e => e.eventId === eventId);
      if (!evt) return { success: false, error: 'event not found' };
      evt.score = score;
      delete entry.locks[eventId];
      save(data);
      return { success: true, xpReward: 100 };
    },

    getBattleStatus(ownerUuid) {
      if (!data.coop || !data.coop[ownerUuid]) return {};
      this.cleanStaleLocks();
      return data.coop[ownerUuid].locks || {};
    },

    // EventIds of this owner's battles already cleared (by a helper or the owner).
    // Polled so completed battles disappear live for everyone viewing the map.
    getCompletedEvents(ownerUuid) {
      if (!data.coop || !data.coop[ownerUuid]) return [];
      const md = data.coop[ownerUuid].missionData;
      if (!md || !Array.isArray(md.events)) return [];
      return md.events.filter((e) => e && e.score > 0 && e.eventId).map((e) => e.eventId);
    },

    // Locks as a JSON-array (Unity JsonUtility can't parse the eventId-keyed object).
    // Each = a battle currently being fought by a helper.
    getLockArray(ownerUuid) {
      if (!data.coop || !data.coop[ownerUuid]) return [];
      this.cleanStaleLocks();
      const locks = data.coop[ownerUuid].locks || {};
      return Object.keys(locks).map((eventId) => ({
        eventId,
        lockedBy: locks[eventId].lockedBy || '',
        playerName: locks[eventId].playerName || 'Agente',
        agentLevel: locks[eventId].agentLevel || 0,
        lockedAt: locks[eventId].lockedAt || 0
      }));
    },

    // Removes every lock in this request created BY a given agent (their lockedBy).
    // Called when that agent returns to the map (they're no longer in any battle).
    clearLocksBy(ownerUuid, byUuid) {
      if (!data.coop || !data.coop[ownerUuid] || !data.coop[ownerUuid].locks) return;
      const locks = data.coop[ownerUuid].locks;
      let changed = false;
      for (const eventId of Object.keys(locks)) {
        if (locks[eventId].lockedBy === byUuid) { delete locks[eventId]; changed = true; }
      }
      if (changed) save(data);
    },

    cleanStaleLocks() {
      if (!data.coop) return;
      const now = Math.floor(Date.now() / 1000);
      let changed = false;
      for (const uuid of Object.keys(data.coop)) {
        const entry = data.coop[uuid];
        if (!entry.locks) continue;
        for (const eventId of Object.keys(entry.locks)) {
          if (now - entry.locks[eventId].lockedAt > LOCK_TIMEOUT) {
            delete entry.locks[eventId];
            changed = true;
          }
        }
      }
      if (changed) save(data);
    },

    // Public help board: returns a compact summary of every OTHER player's open
    // coop request (one that still has at least one un-completed helpable battle and
    // hasn't gone stale). The owner posts `missionData` via shareMission; here we only
    // expose what the board needs to render a card (no full events payload).
    getOpenCoopRequests(excludeUuid, limit) {
      if (!data.coop) data.coop = {};
      this.cleanStaleLocks();
      const now = Math.floor(Date.now() / 1000);
      const out = [];
      for (const [uuid, entry] of Object.entries(data.coop)) {
        if (uuid === excludeUuid) continue;
        const md = entry && entry.missionData;
        if (!md || !Array.isArray(md.events) || md.events.length === 0) continue;
        if (now - (entry.lastUpdated || 0) > COOP_REQUEST_TTL) continue;
        const total = md.events.length;
        const completed = md.events.filter(e => e && e.score > 0).length;
        if (completed >= total) continue; // fully helped, nothing left to do
        const activeHelpers = entry.locks ? Object.keys(entry.locks).length : 0;
        out.push({
          uuid,
          ownerName: md.ownerName || 'Agent',
          ownerLevel: md.ownerLevel || 0,
          season: md.season || 0,
          chapter: md.chapter || 0,
          mission: md.mission || 0,
          missionId: md.missionId || '',
          location: md.location || '',
          dispName: md.dispName || '',
          imageAssetId: md.imageAssetId || '',
          totalBattles: total,
          completedBattles: completed,
          activeHelpers,
          full: activeHelpers >= 2,
          updated: entry.lastUpdated || 0
        });
      }
      out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      return out.slice(0, limit);
    },

    // === PvP team registry (shared opponent pool) ===
    // Stores each player's PvP team snapshot (as an opaque JSON string built by the
    // client) keyed by uuid. The client keeps its own durable local pool; this server
    // copy is just a relay that seeds clients with real teams they never met live, so
    // it's fine if Render's ephemeral disk wipes it — it refills as players re-sync.
    upsertPvpTeam(uuid, team, level, tier) {
      if (!data.pvp_teams) data.pvp_teams = {};
      data.pvp_teams[uuid] = {
        team,
        level: level || 0,
        tier: tier || 0,
        updated: Math.floor(Date.now() / 1000)
      };
      // Light cap: drop the oldest entries if the registry grows too large.
      const ids = Object.keys(data.pvp_teams);
      if (ids.length > MAX_PVP_TEAMS) {
        ids.sort((a, b) => (data.pvp_teams[a].updated || 0) - (data.pvp_teams[b].updated || 0));
        for (let i = 0; i < ids.length - MAX_PVP_TEAMS; i++) delete data.pvp_teams[ids[i]];
      }
      save(data);
    },

    // Returns up to `limit` OTHER players' team JSON strings, preferring the closest
    // agent level, then shuffled for variety. The client does its own fair selection.
    getPvpOpponents(uuid, level, tier, limit) {
      if (!data.pvp_teams) data.pvp_teams = {};
      const others = [];
      for (const [id, e] of Object.entries(data.pvp_teams)) {
        if (id === uuid || !e || !e.team) continue;
        others.push(e);
      }
      others.sort((a, b) => Math.abs((a.level || 0) - level) - Math.abs((b.level || 0) - level));
      const pool = others.slice(0, Math.max(limit * 3, limit));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      return pool.slice(0, limit).map(e => e.team);
    }
  };
