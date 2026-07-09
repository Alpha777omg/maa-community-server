const { S1_CHAPTERS } = require('./catalog');

// ── Battle fronts (Operaciones Globales v2) ──────────────────────────────────
// Every week the villains attack 12 missions: ONE random mission from EACH
// Season 1 chapter, so every player has fronts inside chapters they already
// unlocked. The community fights INSIDE those missions (battles won there = +1);
// unattended fronts lose ground every PUSH_WINDOW_HOURS (villain counter-attack).
// Targets and pressure are tuned so completing every front is impossible — the
// community must decide where to concentrate (and coordinate in global chat).
const MISSIONS_PER_WEEK = 12;          // one front per S1 chapter
const PUSH_WINDOW_HOURS = 3;           // villain counter-attack cadence

// ── Personal contribution bonus ──────────────────────────────────────────────
// The base reward is guaranteed when the community completes the front, but
// each player's claim is multiplied by how much THEY contributed to the target.
const CONTRIBUTION_TIERS = [
  { minShare: 0.12, multiplier: 2.5 },   // aportaste ≥12% de la meta → x2.5 (máximo)
  { minShare: 0.05, multiplier: 2.0 },   // ≥5% → x2
  { minShare: 0.01, multiplier: 1.5 },   // ≥1% → x1.5
];

function contributionMultiplier(contributed, target) {
  if (!target || target <= 0 || !contributed || contributed <= 0) return 1.0;
  const share = contributed / target;
  for (const t of CONTRIBUTION_TIERS) {
    if (share >= t.minShare) return t.multiplier;
  }
  return 1.0;
}

// ── Villain counter-attack ───────────────────────────────────────────────────
// Defense is measured by EFFORT: victories won on the front's mission during
// the window, with a headcount fallback so a coordinated group also holds.
// Tuned for a community of ~20-30 concurrent / ~100 daily agents.
const HOLD_WINS  = 25, HOLD_AGENTS  = 6;   // full hold: no ground lost
const LIGHT_WINS = 10, LIGHT_AGENTS = 3;   // solid defense: -1%
function villainPushPct(defenders, wins) {
  if (wins >= HOLD_WINS || defenders >= HOLD_AGENTS) return 0;
  if (wins >= LIGHT_WINS || defenders >= LIGHT_AGENTS) return 1;
  if (wins >= 1 || defenders >= 1) return 2;
  return 4;
}

// ── Chapter sub-missions (classic objectives) ────────────────────────────────
// Each front carries 3 classic community objectives scoped to ITS CHAPTER
// (kills, wins, hero usage, statuses done in battles of that chapter). Each
// completed sub-mission pushes the front's progress by SUB_BONUS points.
// No own reward and no personal-multiplier credit — pure front support.
const SUB_BONUS = 20;

const SUB_HEROES = [
  { name: 'Iron Man', seq: 2, icon: 'a/fs/gg0011.png' },
  { name: 'Hawkeye', seq: 4, icon: 'a/fs/2gg0011.png' },
  { name: 'Captain America', seq: 6, icon: 'a/fs/3jl0012.png' },
  { name: 'Black Cat', seq: 5, icon: 'a/fs/3f60011.png' },
  { name: 'Wolverine', seq: 29, icon: 'a/fs/2fk0011.png' },
  { name: 'Hulk', seq: 11, icon: 'a/fs/wd0011.png' },
  { name: 'Spider-Man', seq: 23, icon: 'a/fs/6d0014.png' },
  { name: 'Storm', seq: 25, icon: 'a/fs/340011.png' },
  { name: 'Cyclops', seq: 8, icon: 'a/fs/24o0011.png' },
  { name: 'Black Widow', seq: 3, icon: 'a/fs/3mm0012.png' },
];

const SUB_STATUSES = [
  { tag: 'burning', label: 'Aplica quemaduras', icon: 'a/fs/97y0003.png' },
  { tag: 'bleeding', label: 'Aplica desangrados', icon: 'a/fs/9270003.png' },
  { tag: 'heal', label: 'Cura aliados', icon: 'a/fs/97j0003.png' },
];

const SUB_BUILDERS = {
  kill_enemies: () => ({
    type: 'kill_enemies', display_name: 'Elimina enemigos',
    icon: 'a/fs/2x10011.png',
    target: randInt(150, 400),
  }),
  win_battles: () => ({
    type: 'win_battles', display_name: 'Gana batallas',
    icon: 'a/fs/91x0003.png',
    target: randInt(30, 80),
  }),
  use_hero: () => {
    const h = pickRandom(SUB_HEROES);
    return {
      type: 'use_hero', display_name: 'Usa a ' + h.name,
      hero_name: h.name, hero_sequence: h.seq, icon: h.icon,
      target: randInt(15, 40),
    };
  },
  apply_status: () => {
    const s = pickRandom(SUB_STATUSES);
    return {
      type: 'apply_status', display_name: s.label,
      status_tag: s.tag, icon: s.icon,
      target: randInt(60, 150),
    };
  },
};

// 3 distinct classic objective types (out of 4) per front.
function buildSubMissions() {
  const types = Object.keys(SUB_BUILDERS).sort(() => Math.random() - 0.5).slice(0, 3);
  return types.map((t, i) => {
    const s = SUB_BUILDERS[t]();
    return {
      sub: i,
      type: s.type,
      display_name: s.display_name,
      description: s.display_name + ' en batallas de este capitulo',
      target: s.target,
      current_progress: 0,
      hero_name: s.hero_name || null,
      hero_sequence: s.hero_sequence || 0,
      status_tag: s.status_tag || null,
      icon_asset_id: s.icon || null,
      completed: false,
    };
  });
}

// Deeper chapters = harder fronts...
function frontTarget(chapter) {
  return randInt(100 + chapter * 10, 240 + chapter * 20);
}

// ...but they guard better loot (veterans have a reason to defend far fronts).
function frontReward(chapter) {
  let pool;
  if (chapter <= 4) {
    pool = [
      { type: 'silver', range: [4000, 10000] },
      { type: 'sp',     range: [8, 15] },
      { type: 'energy', range: [5, 10] },
    ];
  } else if (chapter <= 8) {
    pool = [
      { type: 'cp',     range: [5, 10] },
      { type: 'gold',   range: [4, 8] },
      { type: 'silver', range: [12500, 25000] },
      { type: 'bp_xp',  range: [100, 200] },
    ];
  } else {
    pool = [
      { type: 'gold',  range: [10, 20] },
      { type: 'cp',    range: [13, 20] },
      { type: 'bp_xp', range: [200, 400] },
      { type: 'sp',    range: [75, 150] },
    ];
  }
  const r = pickRandom(pool);
  return { type: r.type, amount: randInt(r.range[0], r.range[1]) };
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWeekId(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function generateWeeklyMissions(db) {
  const weekId = getWeekId();
  const existing = db.getMissions(weekId);
  if (existing.length >= MISSIONS_PER_WEEK) {
    console.log(`Missions for ${weekId} already exist (${existing.length} missions)`);
    return existing;
  }

  console.log(`Generating ${MISSIONS_PER_WEEK} battle fronts for ${weekId}...`);
  const missions = S1_CHAPTERS.map((ch, i) => {
    const m = pickRandom(ch.missions);
    const target = frontTarget(ch.chapter);
    const reward = frontReward(ch.chapter);
    return {
      slot: i,
      mission_type: 'front',
      mission_code: m.code,               // matches the client's missionEvent.missionId
      chapter: ch.chapter,
      chapter_name: ch.name,
      villain: m.villain,
      display_name: m.name,
      description: 'Gana batallas dentro de esta mision para hacer retroceder a ' + (m.villain || 'los villanos'),
      target,
      current_progress: 0,
      hero_name: null,
      hero_sequence: 0,
      status_tag: null,
      icon_asset_id: m.image,
      reward_type: reward.type,
      reward_amount: reward.amount,
      defenders: 0,                       // distinct agents active in the last window
      recent_wins: 0,                     // victories on the front's mission in the window
      last_push: 0,                       // progress lost at the last villain tick
      push_streak: 0,                     // consecutive losing ticks (for chat alarms)
      alert_low_sent: false,              // "below 25%" alarm fired (once per week)
      fortified: false,                   // all 3 sub-missions done -> immune to the push
      sub_missions: buildSubMissions(),   // 3 classic chapter objectives, +SUB_BONUS each
    };
  });

  db.setMissions(weekId, missions);
  console.log(`Generated ${missions.length} fronts for ${weekId}`);
  return missions;
}

// Villain counter-attack tick: fronts with few defenders in the last window
// lose a % of their target. Completed and FORTIFIED (all 3 sub-missions done)
// fronts are safe. Posts S.H.I.E.L.D. alarms to global chat when a front is
// bleeding out (3 losing ticks in a row, or crossing below 25%).
function applyVillainPush(db) {
  const weekId = getWeekId();
  const missions = db.getMissions(weekId);
  const windowSec = PUSH_WINDOW_HOURS * 3600;
  for (const m of missions) {
    if (m.mission_type !== 'front') continue;
    const defenders = db.countRecentDefenders(weekId, m.slot, windowSec);
    const wins = db.countRecentWins(weekId, m.slot, windowSec);

    const fortified = m.fortified ||
      (Array.isArray(m.sub_missions) && m.sub_missions.length > 0 && m.sub_missions.every(s => s.completed));
    if (m.current_progress >= m.target || fortified) {
      db.applyFrontPush(weekId, m.slot, defenders, 0, wins);
      continue;
    }

    const before = m.current_progress;
    const pct = villainPushPct(defenders, wins);
    const loss = Math.min(before, Math.round(m.target * pct / 100));
    const state = db.applyFrontPush(weekId, m.slot, defenders, loss, wins);
    if (!state || loss <= 0) continue;
    console.log(`[VillainPush] ${weekId} slot ${m.slot} (${m.display_name}): -${loss} (${wins} wins, ${defenders} defenders, streak ${state.streak})`);

    // ── S.H.I.E.L.D. alarms to global chat ──
    const vname = m.villain || 'El enemigo';
    const pctLeft = m.target > 0 ? Math.floor(state.progress / m.target * 100) : 0;
    if (state.streak === 3) {
      db.addChatMessage('system', 'S.H.I.E.L.D.',
        'ALERTA: ' + vname + ' lleva 9h recuperando terreno en "' + m.display_name +
        '" (Cap. ' + m.chapter + '). Frente al ' + pctLeft + '%. Necesita defensores!', 0);
    }
    const low = Math.round(m.target * 0.25);
    if (!m.alert_low_sent && before >= low && state.progress < low) {
      db.markFrontLowAlert(weekId, m.slot);
      db.addChatMessage('system', 'S.H.I.E.L.D.',
        'ALERTA CRITICA: "' + m.display_name + '" (Cap. ' + m.chapter +
        ') ha caido por debajo del 25%. ' + vname + ' esta a punto de reconquistar el frente!', 0);
    }
  }
}

module.exports = {
  generateWeeklyMissions,
  getWeekId,
  contributionMultiplier,
  applyVillainPush,
  villainPushPct,
  MISSIONS_PER_WEEK,
  PUSH_WINDOW_HOURS,
  SUB_BONUS,
};
