const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { generateWeeklyMissions, getWeekId } = require('./missions');

const app = express();
const PORT = process.env.PORT || 3000;
const ONLINE_TIMEOUT = 90;

app.use(cors());
app.use(express.json());

// Generate missions on startup
generateWeeklyMissions(db);

// Weekly reset: every Monday at 00:00
cron.schedule('0 0 * * 1', () => {
  console.log('Weekly reset triggered');
  generateWeeklyMissions(db);
});

// POST /api/heartbeat
app.post('/api/heartbeat', (req, res) => {
  const { uuid, playerName } = req.body;
  if (!uuid) return res.status(400).json({ error: 'uuid required' });

  db.upsertPlayer(uuid);
  db.updateProfileSeen(uuid);
  // Auto-register profile if not exists
  if (playerName && !db.getProfile(uuid)) {
    db.registerProfile(uuid, playerName.substring(0, 30));
  }
  const profile = db.getProfile(uuid);
  const count = db.countOnline(ONLINE_TIMEOUT);
  res.json({ online_count: count, server_time: Math.floor(Date.now() / 1000), profile });
});

// GET /api/missions
app.get('/api/missions', (req, res) => {
  const weekId = req.query.week_id || getWeekId();
  let missions = db.getMissions(weekId);

  if (missions.length === 0) {
    generateWeeklyMissions(db);
    missions = db.getMissions(weekId);
  }

  const count = db.countOnline(ONLINE_TIMEOUT);
  res.json({ week_id: weekId, missions, online_count: count });
});

// POST /api/progress
app.post('/api/progress', (req, res) => {
  const { uuid, week_id, contributions } = req.body;
  if (!uuid || !week_id || !contributions) {
    return res.status(400).json({ error: 'uuid, week_id, contributions required' });
  }

  for (const c of contributions) {
    if (c.amount > 0) {
      db.addProgress(week_id, c.slot, c.amount);
      db.addContribution(uuid, week_id, c.slot, c.amount);
    }
  }

  const missions = db.getMissions(week_id);
  const count = db.countOnline(ONLINE_TIMEOUT);
  res.json({ week_id, missions, online_count: count });
});

// POST /api/claim
app.post('/api/claim', (req, res) => {
  const { uuid, week_id, slot } = req.body;
  if (!uuid || !week_id || slot === undefined) {
    return res.status(400).json({ error: 'uuid, week_id, slot required' });
  }

  const missions = db.getMissions(week_id);
  const mission = missions.find(m => m.slot === slot);
  if (!mission) return res.status(404).json({ error: 'mission not found' });
  if (mission.current_progress < mission.target) {
    return res.status(400).json({ error: 'mission not complete' });
  }

  const claimed = db.claimSlot(uuid, week_id, slot);
  if (!claimed) return res.status(400).json({ error: 'already claimed' });

  res.json({ success: true, reward_type: mission.reward_type, reward_amount: mission.reward_amount });
});

// GET /api/status
app.get('/api/status', (req, res) => {
  const { uuid, week_id } = req.query;
  if (!uuid || !week_id) return res.status(400).json({ error: 'uuid, week_id required' });

  const contribs = db.getContributions(uuid, week_id);
  const claims = [];
  for (let s = 0; s < 4; s++) {
    const c = contribs[s] || { contributed: 0, claimed: false };
    claims.push({ slot: s, contributed: c.contributed, claimed: c.claimed ? 1 : 0 });
  }
  res.json({ claims });
});

// POST /api/chat/send
app.post('/api/chat/send', (req, res) => {
  const { uuid, playerName, message } = req.body;
  if (!uuid || !message) return res.status(400).json({ error: 'uuid, message required' });

  const name = (playerName || 'Agent').substring(0, 30);
  const clean = message.replace(/[<>]/g, '').trim();
  if (clean.length === 0) return res.status(400).json({ error: 'empty message' });

  const msg = db.addChatMessage(uuid, name, clean);
  res.json({ success: true, message: msg });
});

// GET /api/chat/messages
app.get('/api/chat/messages', (req, res) => {
  const sinceId = parseInt(req.query.since_id) || 0;
  const messages = db.getChatMessages(sinceId);
  res.json({ messages });
});

// === PROFILE & FRIENDS ENDPOINTS ===

// POST /api/profile/register
app.post('/api/profile/register', (req, res) => {
  const { uuid, name } = req.body;
  if (!uuid || !name) return res.status(400).json({ error: 'uuid, name required' });
  const profile = db.registerProfile(uuid, name.substring(0, 30));
  res.json({ success: true, profile });
});

// GET /api/profile/search
app.get('/api/profile/search', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });
  const results = db.searchProfiles(name);
  res.json({ results });
});

// POST /api/friends/add
app.post('/api/friends/add', (req, res) => {
  const { uuid, target_uuid } = req.body;
  if (!uuid || !target_uuid) return res.status(400).json({ error: 'uuid, target_uuid required' });
  const ok = db.addFriendRequest(uuid, target_uuid);
  res.json({ success: ok });
});

// GET /api/friends/list
app.get('/api/friends/list', (req, res) => {
  const { uuid } = req.query;
  if (!uuid) return res.status(400).json({ error: 'uuid required' });
  const list = db.getFriendsList(uuid);
  res.json(list);
});

// POST /api/friends/accept
app.post('/api/friends/accept', (req, res) => {
  const { uuid, request_from } = req.body;
  if (!uuid || !request_from) return res.status(400).json({ error: 'uuid, request_from required' });
  const ok = db.acceptFriend(uuid, request_from);
  res.json({ success: ok });
});

// POST /api/friends/reject
app.post('/api/friends/reject', (req, res) => {
  const { uuid, request_from } = req.body;
  if (!uuid || !request_from) return res.status(400).json({ error: 'uuid, request_from required' });
  const ok = db.rejectFriend(uuid, request_from);
  res.json({ success: ok });
});

// POST /api/friends/remove
app.post('/api/friends/remove', (req, res) => {
  const { uuid, target_uuid } = req.body;
  if (!uuid || !target_uuid) return res.status(400).json({ error: 'uuid, target_uuid required' });
  const ok = db.removeFriend(uuid, target_uuid);
  res.json({ success: ok });
});

// POST /api/private/send
app.post('/api/private/send', (req, res) => {
  const { uuid, target_uuid, message } = req.body;
  if (!uuid || !target_uuid || !message) return res.status(400).json({ error: 'uuid, target_uuid, message required' });
  const clean = message.replace(/[<>]/g, '').trim();
  if (clean.length === 0) return res.status(400).json({ error: 'empty message' });
  const msg = db.addPrivateMessage(uuid, target_uuid, clean);
  if (!msg) return res.status(400).json({ error: 'not friends' });
  res.json({ success: true, message: msg });
});

// GET /api/private/messages
app.get('/api/private/messages', (req, res) => {
  const { uuid, target, since_id } = req.query;
  if (!uuid || !target) return res.status(400).json({ error: 'uuid, target required' });
  const messages = db.getPrivateMessages(uuid, target, parseInt(since_id) || 0);
  res.json({ messages });
});

// === LAUNCHER UPDATE ENDPOINTS ===
  app.post('/api/coop/share-mission', (req, res) => { const { uuid, missionData } = req.body; if (!uuid || !missionData)
   return res.status(400).json({}); db.shareMission(uuid, missionData); res.json({ success: true }); });
  app.get('/api/coop/get-mission', (req, res) => { const { uuid, friend } = req.query; if (!uuid || !friend) return
  res.json({}); if (!db.areFriends(uuid, friend)) return res.json({}); const c = db.getCoopMission(friend); if (!c ||
  !c.missionData) return res.json({ missionData: null, locks: {} }); res.json({ missionData: c.missionData, locks:
  c.locks || {} }); });
  app.post('/api/coop/lock-battle', (req, res) => { const { uuid, friend, eventId } = req.body; if (!uuid || !friend ||
  !eventId) return res.json({}); if (!db.areFriends(uuid, friend)) return res.json({}); const p = db.getProfile(uuid);
  res.json({ success: db.lockBattle(friend, eventId, uuid, p ? p.name : 'A') }); });
  app.post('/api/coop/unlock-battle', (req, res) => { const { uuid, friend, eventId } = req.body; if (!uuid || !friend
  || !eventId) return res.json({}); res.json({ success: db.unlockBattle(friend, eventId, uuid) }); });
  app.post('/api/coop/complete-battle', (req, res) => { const { uuid, friend, eventId, score } = req.body; if (!uuid ||
  !friend || !eventId) return res.json({}); res.json(db.completeBattle(friend, eventId, uuid, score || 1)); });
  app.get('/api/coop/battle-status', (req, res) => { const { friend } = req.query; if (!friend) return res.json({});
  res.json({ locks: db.getBattleStatus(friend) }); });

// GET /api/version
app.get('/api/version', (req, res) => {
  try {
    const versionFile = path.join(__dirname, 'version.json');
    let raw = fs.readFileSync(versionFile, 'utf8');
    raw = raw.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
    const data = JSON.parse(raw);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'version.json error: ' + e.message, dirname: __dirname });
  }
});

// GET /api/download/:filename
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'updates', req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'file not found' });
  }
  res.download(filePath);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MAA Community Server running on port ${PORT}`);
  console.log(`Current week: ${getWeekId()}`);
});
