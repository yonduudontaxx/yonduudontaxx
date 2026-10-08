import { writeFile } from "node:fs/promises";

const user = process.env.GH_USER;
const token = process.env.GITHUB_TOKEN;
const outDir = process.argv[2] ?? "dist";

const themes = {
  "stats.svg": { bg: "#fffefe", title: "#2f80ed", text: "#434d58", icon: "#4c71f2", tier: "#f9c513" },
  "stats-dark.svg": { bg: "#0d1117", title: "#58a6ff", text: "#c9d1d9", icon: "#8b949e", tier: "#f9c513" },
};

async function graphql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL failed: ${JSON.stringify(json.errors ?? res.status)}`);
  return json.data;
}

async function fetchStats() {
  const { user: base } = await graphql(
    `{ user(login: "${user}") { createdAt pullRequests { totalCount } issues { totalCount } } }`,
  );
  const first = new Date(base.createdAt).getUTCFullYear();
  const last = new Date().getUTCFullYear();
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const fields = years
    .map(
      (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
        totalCommitContributions restrictedContributionsCount contributionCalendar { totalContributions } }`,
    )
    .join("\n");
  const { user: byYear } = await graphql(`{ user(login: "${user}") { ${fields} } }`);
  const sum = (pick) => years.reduce((n, y) => n + pick(byYear[`y${y}`]), 0);
  return {
    contributions: sum((c) => c.contributionCalendar.totalContributions),
    commits: sum((c) => c.totalCommitContributions + c.restrictedContributionsCount),
    prs: base.pullRequests.totalCount,
    issues: base.issues.totalCount,
  };
}

async function fetchAchievements() {
  const res = await fetch(`https://github.com/${user}?tab=achievements`);
  if (!res.ok) throw new Error(`achievements page returned ${res.status}`);
  const html = await res.text();
  if (!html.includes("achievement-card")) throw new Error("achievements markup not found");
  const cards = html.split('class="achievement-card').slice(1);
  const achievements = [];
  for (const card of cards) {
    const block = card.split("</summary>")[0];
    const img = block.match(/<img src="([^"]+)"[^>]*alt="Achievement: ([^"]+)"/);
    if (!img) continue;
    const tier = block.match(/achievement-tier-label[^>]*>\s*(x\d+)\s*</);
    const png = await fetch(img[1]);
    if (!png.ok) throw new Error(`badge ${img[2]} returned ${png.status}`);
    const data = Buffer.from(await png.arrayBuffer()).toString("base64");
    achievements.push({ name: img[2], tier: tier?.[1] ?? "", src: `data:image/png;base64,${data}` });
  }
  return achievements;
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");

const icons = {
  contributions: "M1 2.5A2.5 2.5 0 013.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 011 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z",
  commits: "M11.93 8.5a4.002 4.002 0 01-7.86 0H.75a.75.75 0 010-1.5h3.32a4.002 4.002 0 017.86 0h3.32a.75.75 0 010 1.5h-3.32zm-1.43-.75a2.5 2.5 0 10-5 0 2.5 2.5 0 005 0z",
  prs: "M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z",
  issues: "M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z",
};

function render(stats, achievements, t) {
  const rows = [
    ["contributions", "Total Contributions", stats.contributions],
    ["commits", "Total Commits", stats.commits],
    ["prs", "Total PRs", stats.prs],
    ["issues", "Total Issues", stats.issues],
  ]
    .map(
      ([key, label, value], i) => `
  <g transform="translate(25, ${70 + i * 28})">
    <svg viewBox="0 0 16 16" width="16" height="16" x="0" y="-13"><path fill="${t.icon}" d="${icons[key]}"/></svg>
    <text x="25" class="stat">${label}:</text>
    <text x="190" class="stat value">${fmt(value)}</text>
  </g>`,
    )
    .join("");

  const shown = achievements.slice(0, 4);
  const extra = achievements.length - shown.length;
  const badges = shown
    .map((a, i) => {
      const x = 290 + (i % 2) * 70;
      const y = 62 + Math.floor(i / 2) * 64;
      const tier = a.tier
        ? `<rect x="${x + 34}" y="${y + 40}" width="22" height="15" rx="7" fill="${t.tier}"/><text x="${x + 45}" y="${y + 51}" class="tier">${a.tier}</text>`
        : "";
      return `<g><title>${escape(a.name)}${a.tier ? ` ${a.tier}` : ""}</title><image href="${a.src}" x="${x}" y="${y}" width="56" height="56"/>${tier}</g>`;
    })
    .join("\n  ");
  const more = extra > 0 ? `<text x="430" y="185" class="stat">+${extra}</text>` : "";
  const none = achievements.length === 0 ? `<text x="290" y="90" class="stat">None yet</text>` : "";
  const desc = `Total Contributions: ${stats.contributions}, Total Commits: ${stats.commits}, Total PRs: ${stats.prs}, Total Issues: ${stats.issues}, Achievements: ${achievements.map((a) => `${a.name}${a.tier ? ` ${a.tier}` : ""}`).join(", ") || "none"}`;

  return `<svg width="467" height="195" viewBox="0 0 467 195" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="titleId descId">
  <title id="titleId">GitHub Stats</title>
  <desc id="descId">${escape(desc)}</desc>
  <style>
    .header { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${t.title}; }
    .stat { font: 600 14px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; fill: ${t.text}; }
    .value { font-weight: 700; }
    .tier { font: 700 10px 'Segoe UI', Ubuntu, Sans-Serif; fill: #24292f; text-anchor: middle; }
  </style>
  <rect x="0.5" y="0.5" rx="4.5" width="466" height="194" fill="${t.bg}"/>
  <text x="25" y="35" class="header">GitHub Stats</text>
  <text x="290" y="35" class="header">Achievements</text>${rows}
  ${badges}
  ${more}${none}
</svg>
`;
}

const [stats, achievements] = await Promise.all([fetchStats(), fetchAchievements()]);
for (const [file, theme] of Object.entries(themes)) {
  await writeFile(`${outDir}/${file}`, render(stats, achievements, theme));
}
console.log(JSON.stringify({ ...stats, achievements: achievements.map((a) => `${a.name} ${a.tier}`.trim()) }));
