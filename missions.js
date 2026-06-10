const MISSIONS_PER_WEEK = 6;

const MISSION_POOL = {
  kill_enemies: [
    { name: "Eliminacion Global", desc: "La comunidad elimina {target} enemigos", targetRange: [8000, 15000], icon: "a/fs/2x10011.png" },
    { name: "Caceria Masiva", desc: "La comunidad elimina {target} enemigos", targetRange: [15000, 30000], icon: "a/fs/2x10011.png" },
    { name: "Purga de Villanos", desc: "La comunidad elimina {target} enemigos", targetRange: [10000, 20000], icon: "a/fs/2x10011.png" },
    { name: "Exterminio Total", desc: "La comunidad elimina {target} enemigos", targetRange: [20000, 40000], icon: "a/fs/2x10011.png" },
  ],
  win_battles: [
    { name: "Victoria Comunitaria", desc: "La comunidad gana {target} batallas", targetRange: [500, 2000], icon: "a/fs/1mo0011.png" },
    { name: "Agentes Unidos", desc: "La comunidad gana {target} batallas", targetRange: [1000, 5000], icon: "a/fs/1mo0011.png" },
    { name: "Frente Unido", desc: "La comunidad gana {target} batallas", targetRange: [800, 3000], icon: "a/fs/91x0003.png" },
    { name: "Imparables", desc: "La comunidad gana {target} batallas", targetRange: [2000, 8000], icon: "a/fs/91x0003.png" },
  ],
  use_hero: [
    { name: "Tecnologia Stark", desc: "Usa a Iron Man en {target} batallas", targetRange: [200, 1000], icon: "a/fs/gg0011.png", heroName: "Iron Man", heroSequence: 2 },
    { name: "Ojo de Halcon Global", desc: "Usa a Hawkeye en {target} batallas", targetRange: [200, 1000], icon: "a/fs/2gg0011.png", heroName: "Hawkeye", heroSequence: 4 },
    { name: "Primer Vengador", desc: "Usa a Capitan America en {target} batallas", targetRange: [200, 1000], icon: "a/fs/3jl0012.png", heroName: "Captain America", heroSequence: 6 },
    { name: "Mala Suerte Global", desc: "Usa a Black Cat en {target} batallas", targetRange: [200, 1000], icon: "a/fs/3f60011.png", heroName: "Black Cat", heroSequence: 5 },
    { name: "Arma X Global", desc: "Usa a Wolverine en {target} batallas", targetRange: [200, 1000], icon: "a/fs/2fk0011.png", heroName: "Wolverine", heroSequence: 29 },
    { name: "Furia Esmeralda", desc: "Usa a Hulk en {target} batallas", targetRange: [200, 1000], icon: "a/fs/wd0011.png", heroName: "Hulk", heroSequence: 11 },
    { name: "Trepamuros Global", desc: "Usa a Spider-Man en {target} batallas", targetRange: [200, 1000], icon: "a/fs/6d0014.png", heroName: "Spider-Man", heroSequence: 23 },
    { name: "Tormenta Global", desc: "Usa a Storm en {target} batallas", targetRange: [200, 1000], icon: "a/fs/340011.png", heroName: "Storm", heroSequence: 25 },
    { name: "Rayo Optico", desc: "Usa a Cyclops en {target} batallas", targetRange: [200, 1000], icon: "a/fs/24o0011.png", heroName: "Cyclops", heroSequence: 8 },
    { name: "Viuda Negra Global", desc: "Usa a Black Widow en {target} batallas", targetRange: [200, 1000], icon: "a/fs/3mm0012.png", heroName: "Black Widow", heroSequence: 3 },
  ],
  apply_status: [
    { name: "Mundo en Llamas", desc: "La comunidad aplica {target} quemaduras", targetRange: [3000, 8000], icon: "a/fs/97y0003.png", statusTag: "burning" },
    { name: "Infierno Global", desc: "La comunidad aplica {target} quemaduras", targetRange: [5000, 12000], icon: "a/fs/97y0003.png", statusTag: "burning" },
    { name: "Sangre Derramada", desc: "La comunidad aplica {target} desangrados", targetRange: [3000, 8000], icon: "a/fs/9270003.png", statusTag: "bleeding" },
    { name: "Marea Carmesi", desc: "La comunidad aplica {target} desangrados", targetRange: [5000, 12000], icon: "a/fs/9270003.png", statusTag: "bleeding" },
    { name: "Curacion Masiva", desc: "La comunidad cura {target} veces", targetRange: [2000, 6000], icon: "a/fs/97j0003.png", statusTag: "heal" },
    { name: "Red de Apoyo", desc: "La comunidad cura {target} veces", targetRange: [4000, 9000], icon: "a/fs/97j0003.png", statusTag: "heal" },
  ]
};

// Rewards reduced 40% from the original ranges.
const REWARD_TYPES = [
  { type: "silver", range: [6000, 24000] },
  { type: "gold",   range: [2, 12] },
  { type: "sp",     range: [12, 36] },
  { type: "cp",     range: [6, 18] },
  { type: "energy", range: [6, 18] },
  { type: "bp_xp",  range: [120, 600] },
];

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

// Builds one mission object (with a slot) from a pool entry + its category.
function buildMission(slot, category, mission) {
  const target = randInt(mission.targetRange[0], mission.targetRange[1]);
  const reward = pickRandom(REWARD_TYPES);
  const rewardAmount = randInt(reward.range[0], reward.range[1]);
  const desc = mission.desc.replace('{target}', target.toLocaleString());
  return {
    slot,
    mission_type: category,
    display_name: mission.name,
    description: desc,
    target,
    current_progress: 0,
    hero_name: mission.heroName || null,
    hero_sequence: mission.heroSequence || 0,
    status_tag: mission.statusTag || null,
    icon_asset_id: mission.icon || null,
    reward_type: reward.type,
    reward_amount: rewardAmount
  };
}

function generateWeeklyMissions(db) {
  const weekId = getWeekId();
  const existing = db.getMissions(weekId);
  if (existing.length >= MISSIONS_PER_WEEK) {
    console.log(`Missions for ${weekId} already exist (${existing.length} missions)`);
    return existing;
  }

  console.log(`Generating ${MISSIONS_PER_WEEK} missions for ${weekId}...`);
  const categories = ['kill_enemies', 'win_battles', 'use_hero', 'apply_status'];
  const chosen = [];                 // { cat, mission }
  const usedNames = new Set();
  const usedTags = new Set();        // no two missions share a status tag
  const usedHeroes = new Set();      // no two missions share a hero

  // A pool entry is usable if its name, hero and status tag aren't already taken.
  function canUse(m) {
    if (usedNames.has(m.name)) return false;
    if (m.statusTag && usedTags.has(m.statusTag)) return false;
    if (m.heroSequence && usedHeroes.has(m.heroSequence)) return false;
    return true;
  }
  function take(cat, m) {
    chosen.push({ cat, m });
    usedNames.add(m.name);
    if (m.statusTag) usedTags.add(m.statusTag);
    if (m.heroSequence) usedHeroes.add(m.heroSequence);
  }

  // 1) Guarantee one mission from every category (respecting the no-repeat rules).
  categories.forEach(cat => {
    const options = MISSION_POOL[cat].filter(canUse);
    if (options.length > 0) take(cat, pickRandom(options));
  });

  // 2) Fill the rest with random DISTINCT missions from any category.
  const flat = [];
  categories.forEach(cat => MISSION_POOL[cat].forEach(m => flat.push({ cat, m })));
  let guard = 0;
  while (chosen.length < MISSIONS_PER_WEEK && guard < 200) {
    const pick = pickRandom(flat);
    if (canUse(pick.m)) take(pick.cat, pick.m);
    guard++;
  }

  const missions = chosen.map((entry, slot) => buildMission(slot, entry.cat, entry.m));

  db.setMissions(weekId, missions);
  console.log(`Generated ${missions.length} missions for ${weekId}`);
  return missions;
}

module.exports = { generateWeeklyMissions, getWeekId, MISSION_POOL, MISSIONS_PER_WEEK };
