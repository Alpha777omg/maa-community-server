const MISSION_POOL = {
  kill_enemies: [
    { name: "Eliminacion Global", desc: "La comunidad elimina {target} enemigos", targetRange: [8000, 15000], icon: "a/fs/2x10011.png" },
    { name: "Caceria Masiva", desc: "La comunidad elimina {target} enemigos", targetRange: [15000, 30000], icon: "a/fs/2x10011.png" },
  ],
  win_battles: [
    { name: "Victoria Comunitaria", desc: "La comunidad gana {target} batallas", targetRange: [500, 2000], icon: "a/fs/1mo0011.png" },
    { name: "Agentes Unidos", desc: "La comunidad gana {target} batallas", targetRange: [1000, 5000], icon: "a/fs/1mo0011.png" },
  ],
  use_hero: [
    { name: "Tecnologia Stark", desc: "Usa a Iron Man en {target} batallas", targetRange: [100, 500], icon: "a/fs/gg0011.png", heroName: "Iron Man", heroSequence: 2 },
    { name: "Ojo de Halcon Global", desc: "Usa a Hawkeye en {target} batallas", targetRange: [100, 500], icon: "a/fs/2gg0011.png", heroName: "Hawkeye", heroSequence: 4 },
    { name: "Primer Vengador", desc: "Usa a Capitan America en {target} batallas", targetRange: [100, 500], icon: "a/fs/3jl0012.png", heroName: "Captain America", heroSequence: 6 },
    { name: "Mala Suerte Global", desc: "Usa a Black Cat en {target} batallas", targetRange: [100, 500], icon: "a/fs/3f60011.png", heroName: "Black Cat", heroSequence: 5 },
  ],
  apply_status: [
    { name: "Mundo en Llamas", desc: "La comunidad aplica {target} quemaduras", targetRange: [3000, 8000], icon: "a/fs/97y0003.png", statusTag: "burning" },
    { name: "Sangre Derramada", desc: "La comunidad aplica {target} desangrados", targetRange: [3000, 8000], icon: "a/fs/9270003.png", statusTag: "bleeding" },
    { name: "Curacion Masiva", desc: "La comunidad cura {target} veces", targetRange: [2000, 6000], icon: "a/fs/97j0003.png", statusTag: "heal" },
  ]
};

const REWARD_TYPES = [
  { type: "silver", range: [10000, 40000] },
  { type: "gold",   range: [4, 20] },
  { type: "sp",     range: [20, 60] },
  { type: "cp",     range: [10, 30] },
  { type: "energy", range: [10, 30] },
  { type: "bp_xp",  range: [200, 1000] },
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

function generateWeeklyMissions(db) {
  const weekId = getWeekId();
  const existing = db.getMissions(weekId);
  if (existing.length > 0) {
    console.log(`Missions for ${weekId} already exist (${existing.length} missions)`);
    return existing;
  }

  console.log(`Generating missions for ${weekId}...`);
  const categories = ['kill_enemies', 'win_battles', 'use_hero', 'apply_status'];
  const missions = [];

  categories.forEach((cat, slot) => {
    const mission = pickRandom(MISSION_POOL[cat]);
    const target = randInt(mission.targetRange[0], mission.targetRange[1]);
    const reward = pickRandom(REWARD_TYPES);
    const rewardAmount = randInt(reward.range[0], reward.range[1]);
    const desc = mission.desc.replace('{target}', target.toLocaleString());

    missions.push({
      slot,
      mission_type: cat,
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
    });
  });

  db.setMissions(weekId, missions);
  console.log(`Generated ${missions.length} missions for ${weekId}`);
  return missions;
}

module.exports = { generateWeeklyMissions, getWeekId, MISSION_POOL };
