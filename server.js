const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { generateWeeklyMissions, getWeekId, contributionMultiplier, applyVillainPush, PUSH_WINDOW_HOURS, SUB_BONUS } = require('./missions');

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

// Villain counter-attack: every PUSH_WINDOW_HOURS, fronts with few defenders
// lose ground (see missions.js villainPushPct).
cron.schedule(`0 */${PUSH_WINDOW_HOURS} * * *`, () => {
  console.log('Villain push tick');
  applyVillainPush(db);
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

  // Live defender counts (fresher than the last villain tick).
  const windowSec = PUSH_WINDOW_HOURS * 3600;
  for (const m of missions) {
    if (m.mission_type === 'front') m.defenders = db.countRecentDefenders(weekId, m.slot, windowSec);
  }

  // War report: last week's fronts — which were defended and which fell.
  const prevWeekId = getWeekId(new Date(Date.now() - 7 * 86400000));
  const report = db.getMissions(prevWeekId).map(p => ({
    slot: p.slot,
    display_name: p.display_name,
    chapter: p.chapter || 0,
    chapter_name: p.chapter_name || null,
    villain: p.villain || null,
    target: p.target,
    current_progress: p.current_progress,
  }));

  const count = db.countOnline(ONLINE_TIMEOUT);
  res.json({ week_id: weekId, missions, online_count: count, report_week: prevWeekId, report });
});

// POST /api/progress
app.post('/api/progress', (req, res) => {
  const { uuid, week_id, contributions } = req.body;
  if (!uuid || !week_id || !contributions) {
    return res.status(400).json({ error: 'uuid, week_id, contributions required' });
  }

  for (const c of contributions) {
    if (!(c.amount > 0)) continue;
    if (typeof c.sub === 'number' && c.sub >= 0) {
      // Chapter sub-mission: pushes the front by SUB_BONUS when completed.
      // No personal-contribution credit, but fighting in the chapter counts
      // as defending the front (slows the villain push).
      db.addSubProgress(week_id, c.slot, c.sub, c.amount, SUB_BONUS);
      db.touchFrontActivity(week_id, c.slot, uuid);
    } else {
      db.addProgress(week_id, c.slot, c.amount);
      db.addContribution(uuid, week_id, c.slot, c.amount);
      db.touchFrontActivity(week_id, c.slot, uuid);   // counts as an active defender
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

  // Personal contribution bonus: base reward is guaranteed; the claim is
  // multiplied by how much this player contributed to the global target.
  const contribs = db.getContributions(uuid, week_id);
  const contributed = (contribs[slot] && contribs[slot].contributed) || 0;
  const multiplier = contributionMultiplier(contributed, mission.target);
  const finalAmount = Math.round(mission.reward_amount * multiplier);

  res.json({
    success: true,
    reward_type: mission.reward_type,
    reward_amount: finalAmount,
    base_amount: mission.reward_amount,
    multiplier,
    contributed
  });
});

// GET /api/status
app.get('/api/status', (req, res) => {
  const { uuid, week_id } = req.query;
  if (!uuid || !week_id) return res.status(400).json({ error: 'uuid, week_id required' });

  const contribs = db.getContributions(uuid, week_id);
  const missions = db.getMissions(week_id);
  const claims = [];
  // One claim entry per mission slot that exists this week (handles any mission count).
  for (const m of missions) {
    const c = contribs[m.slot] || { contributed: 0, claimed: false };
    claims.push({ slot: m.slot, contributed: c.contributed, claimed: c.claimed ? 1 : 0 });
  }
  res.json({ claims });
});

// POST /api/chat/send
app.post('/api/chat/send', (req, res) => {
  const { uuid, playerName, message, agentLevel } = req.body;
  if (!uuid || !message) return res.status(400).json({ error: 'uuid, message required' });

  const name = (playerName || 'Agent').substring(0, 30);
  const clean = message.replace(/[<>]/g, '').trim();
  if (clean.length === 0) return res.status(400).json({ error: 'empty message' });

  const msg = db.addChatMessage(uuid, name, clean, agentLevel);
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

// POST /api/profile/stats — publish my public stats so others can view my profile
app.post('/api/profile/stats', (req, res) => {
  const { uuid, name, stats } = req.body;
  if (!uuid) return res.status(400).json({ error: 'uuid required' });
  const profile = db.updateProfileStats(uuid, name, stats || {});
  res.json({ success: true, profile });
});

// GET /api/profile/get — fetch another player's public profile by uuid
app.get('/api/profile/get', (req, res) => {
  const { uuid } = req.query;
  if (!uuid) return res.status(400).json({ error: 'uuid required' });
  const profile = db.getProfile(uuid);
  res.json({ profile });
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

// === PvP TEAM REGISTRY ===

// POST /api/pvp/sync — register my PvP team + get a batch of opponents.
// Body: { uuid, team (PvpTeamData JSON string), level, tier }
// Response: { teams: [ "<PvpTeamData JSON>", ... ] }
app.post('/api/pvp/sync', (req, res) => {
  const { uuid, team, level, tier } = req.body;
  if (!uuid) return res.status(400).json({ error: 'uuid required' });
  if (team) db.upsertPvpTeam(uuid, team, level || 0, tier || 0);
  const teams = db.getPvpOpponents(uuid, level || 0, tier || 0, 30);
  res.json({ teams });
});

// === LAUNCHER UPDATE ENDPOINTS ===
  app.post('/api/coop/share-mission', (req, res) => { const b = req.body; if (!b.uuid || !b.missionData) { return
  res.json({}); } db.shareMission(b.uuid, b.missionData); return res.json({ success: true }); });
  // Owner re-syncs current progress to an existing request (keeps helper map in sync).
  app.post('/api/coop/refresh', (req, res) => { const b = req.body; if (!b.uuid || !b.missionData) { return res.json({ updated: false }); } return res.json({ updated: db.refreshMission(b.uuid, b.missionData) }); });
  app.get('/api/coop/get-mission', (req, res) => { const q = req.query; if (!q.uuid || !q.friend) { return res.json({
  missionData: null }); } const c = db.getCoopMission(q.friend); if (!c || !c.missionData) { return res.json({
  missionData: null }); } return res.json({ missionData: c.missionData, locks: c.locks || {} }); });
  app.post('/api/coop/lock-battle', (req, res) => { const b = req.body; if (!b.uuid || !b.friend || !b.eventId) { return
   res.json({ success: false }); } const p = db.getProfile(b.uuid); const ok = db.lockBattle(b.friend, b.eventId,
  b.uuid, p ? p.name : 'A', b.level || 0); return res.json({ success: ok }); });
  app.post('/api/coop/unlock-battle', (req, res) => { const b = req.body; if (!b.uuid || !b.friend || !b.eventId) {
  return res.json({ success: false }); } const ok = db.unlockBattle(b.friend, b.eventId, b.uuid); return res.json({
  success: ok }); });
  app.post('/api/coop/complete-battle', (req, res) => { const b = req.body; if (!b.uuid || !b.friend || !b.eventId) {
  return res.json({ success: false }); } const r = db.completeBattle(b.friend, b.eventId, b.uuid, b.score || 1); return
  res.json(r); });
  app.get('/api/coop/battle-status', (req, res) => { if (!req.query.friend) { return res.json({ locks: {} }); } return
  res.json({ locks: db.getBattleStatus(req.query.friend) }); });
  // Release every lock I created in an owner's request (called when I return to the map).
  app.post('/api/coop/clear-my-locks', (req, res) => { const b = req.body; if (!b.owner || !b.uuid) { return res.json({ ok: false }); } db.clearLocksBy(b.owner, b.uuid); return res.json({ ok: true }); });

// GET /api/coop/list?uuid=<me>&limit=30  -> { requests: [ {summary}, ... ] }
// Public help board: every OTHER agent currently asking for help.
app.get('/api/coop/list', (req, res) => {
  const uuid = req.query.uuid || '';
  let limit = parseInt(req.query.limit, 10) || 30;
  if (limit > 50) limit = 50;
  res.json({ requests: db.getOpenCoopRequests(uuid, limit) });
});

// GET /api/coop/locks?owner=<uuid>  -> { lockedEvents: [ {eventId, playerName, lockedAt} ] }
// Battles currently being fought by helpers. Polled by the map (owner + helpers) to
// show "en batalla" indicators and avoid two agents on the same battle.
app.get('/api/coop/locks', (req, res) => {
  const owner = req.query.owner || '';
  if (!owner) return res.json({ lockedEvents: [], completedEvents: [] });
  res.json({ lockedEvents: db.getLockArray(owner), completedEvents: db.getCompletedEvents(owner) });
});

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
