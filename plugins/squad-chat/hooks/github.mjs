// The Git room's data: the local branch from `git status`, and pull requests,
// reviews, Actions runs, issues and Dependabot alerts from the `gh` CLI,
// signed in as the person already is. Nothing is stored and no token passes
// through here. `run(argv)` comes from the hooks module ($.process.run).

const PR_FIELDS = "number,title,state,isDraft,url,author,headRefName,reviewDecision,statusCheckRollup,updatedAt";
const PR_VIEW_FIELDS = `${PR_FIELDS},mergeable,mergeStateStatus,reviews,reviewRequests`;

export function emptyGit() {
  return {
    status: "idle",       // idle | loading | ok | no-gh | no-auth | no-repo | error
    error: "",
    fetchedAt: 0,
    stale: false,         // the last refresh failed: what's shown is older
    me: null,             // the gh login
    repo: null,           // { name, url }
    local: null,          // { branch, ahead, behind, changed }
    pr: null,             // this branch's pull request
    prs: [],              // open pull requests
    reviewMe: [],         // numbers of open PRs that ask for my review
    runs: [],             // recent Actions runs
    issues: [],           // open issues assigned to me
    alerts: null,         // Dependabot alerts, or null when not readable
  };
}

// ---------------------------------------------------------------- parsing

// `git status --porcelain=v2 --branch`
export function parseGitStatus(out) {
  const local = { branch: null, ahead: 0, behind: 0, changed: 0, upstream: null, unpushed: null };
  for (const line of String(out).split("\n")) {
    if (line.startsWith("# branch.head ")) local.branch = line.slice(14).trim();
    else if (line.startsWith("# branch.upstream ")) local.upstream = line.slice(18).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) { local.ahead = Number(m[1]); local.behind = Number(m[2]); }
    } else if (/^[12u?] /.test(line)) local.changed++;
  }
  if (local.branch === "(detached)") local.branch = "detached";
  return local;
}

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

// A PR's checks as counts: passed, failed, still running.
export function checks(rollup) {
  const c = { pass: 0, fail: 0, pending: 0, total: 0 };
  for (const item of rollup ?? []) {
    c.total++;
    if (item.__typename === "StatusContext" || item.state) {
      if (item.state === "SUCCESS") c.pass++;
      else if (FAILED.has(item.state)) c.fail++;
      else c.pending++;
      continue;
    }
    if (item.status !== "COMPLETED") c.pending++;
    else if (FAILED.has(item.conclusion)) c.fail++;
    else c.pass++;
  }
  return c;
}

function prModel(p) {
  return {
    number: p.number,
    title: p.title ?? "",
    state: p.state ?? "OPEN",
    draft: !!p.isDraft,
    url: p.url,
    author: p.author?.login ?? "",
    branch: p.headRefName ?? "",
    decision: p.reviewDecision || null,     // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
    checks: checks(p.statusCheckRollup),
    updatedAt: Date.parse(p.updatedAt) || 0,
  };
}

// `gh pr view` adds who reviewed (each person's latest word) and who's asked.
export function parsePrView(p) {
  const pr = prModel(p);
  const latest = new Map();
  for (const r of p.reviews ?? []) {
    const who = r.author?.login;
    if (!who || r.state === "COMMENTED" || r.state === "PENDING") continue;
    latest.set(who, r.state);
  }
  pr.reviews = [...latest].map(([login, state]) => ({ login, state }));
  pr.requested = (p.reviewRequests ?? []).map((r) => r.login ?? r.name ?? r.slug).filter(Boolean);
  pr.mergeable = p.mergeable ?? "UNKNOWN";          // MERGEABLE | CONFLICTING | UNKNOWN
  pr.mergeState = p.mergeStateStatus ?? "UNKNOWN";  // CLEAN | BLOCKED | BEHIND | DIRTY | UNSTABLE | ...
  return pr;
}

export function parsePrList(list) {
  return (list ?? []).map(prModel);
}

export function parseRuns(list) {
  return (list ?? []).map((r) => ({
    id: r.databaseId,
    name: r.workflowName || r.name || "workflow",
    branch: r.headBranch ?? "",
    status: r.status,                 // queued | in_progress | completed
    conclusion: r.conclusion || null, // success | failure | cancelled | skipped
    startedAt: Date.parse(r.createdAt) || 0,
    updatedAt: Date.parse(r.updatedAt) || 0,
    url: r.url,
  }));
}

export function parseIssues(list) {
  return (list ?? []).map((i) => ({
    number: i.number,
    title: i.title ?? "",
    url: i.url,
    labels: (i.labels ?? []).map((l) => l.name),
    updatedAt: Date.parse(i.updatedAt) || 0,
  }));
}

export function parseAlerts(list) {
  return (list ?? []).map((a) => ({
    number: a.number,
    pkg: a.dependency?.package?.name ?? a.security_vulnerability?.package?.name ?? "dependency",
    severity: a.security_advisory?.severity ?? a.security_vulnerability?.severity ?? "unknown",
    url: a.html_url,
  }));
}

// ---------------------------------------------------------------- fetching

const NO_AUTH = /gh auth login|not logged in|authentication|HTTP 401/i;
const NO_PR = /no pull requests found|no open pull requests/i;
const NO_REMOTE = /no git remotes|none of the git remotes|not a github|could not determine/i;

function json(out) {
  try { return JSON.parse(out || "null"); } catch { return null; }
}

// Everything the room shows, fetched in parallel. `prev` is the last good
// snapshot: on a failed refresh it stays, marked stale.
export async function fetchGit(run, prev = emptyGit()) {
  const next = { ...emptyGit(), me: prev.me };
  let status;
  try {
    status = await run(["git", "status", "--porcelain=v2", "--branch"]);
  } catch (err) {
    return { ...prev, status: "error", error: `git: ${err?.message ?? err}`, stale: prev.status === "ok" };
  }
  if (status.exitCode !== 0) {
    return /not a git repository/i.test(status.stderr)
      ? { ...emptyGit(), status: "no-repo" }
      : { ...prev, status: "error", error: firstLine(status.stderr) || "git status failed", stale: prev.status === "ok" };
  }
  next.local = parseGitStatus(status.stdout);
  // A branch that was never pushed has nothing to be ahead of: count its
  // commits past the main branch instead.
  if (!next.local.upstream && next.local.branch && next.local.branch !== "detached") {
    next.local.unpushed = await unpushed(run);
  }

  const gh = (args) => run(["gh", ...args]).then((r) => r, (err) => ({ thrown: err }));
  const [repo, me] = await Promise.all([
    gh(["repo", "view", "--json", "nameWithOwner,url"]),
    prev.me ? Promise.resolve(null) : gh(["api", "user", "--jq", ".login"]),
  ]);
  if (repo.thrown) return { ...emptyGit(), local: next.local, status: "no-gh" };
  if (repo.exitCode !== 0) {
    if (NO_AUTH.test(repo.stderr)) return { ...emptyGit(), local: next.local, status: "no-auth" };
    if (NO_REMOTE.test(repo.stderr)) return { ...emptyGit(), local: next.local, status: "ok", fetchedAt: Date.now(), error: "no GitHub remote" };
    return { ...prev, local: next.local, status: "error", error: firstLine(repo.stderr) || "gh failed", stale: prev.status === "ok" };
  }
  const r = json(repo.stdout);
  next.repo = { name: r?.nameWithOwner ?? "", url: r?.url ?? "" };
  if (me && me.exitCode === 0) next.me = me.stdout.trim() || null;

  const [view, list, mine, runs, issues, alerts] = await Promise.all([
    gh(["pr", "view", "--json", PR_VIEW_FIELDS]),
    gh(["pr", "list", "--state", "open", "--limit", "8", "--json", PR_FIELDS]),
    gh(["pr", "list", "--state", "open", "--search", "review-requested:@me", "--json", "number"]),
    gh(["run", "list", "--limit", "6", "--json", "databaseId,name,workflowName,headBranch,status,conclusion,createdAt,updatedAt,url"]),
    gh(["issue", "list", "--state", "open", "--assignee", "@me", "--limit", "6", "--json", "number,title,url,labels,updatedAt"]),
    gh(["api", "repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=5"]),
  ]);
  const ok = (x) => !x.thrown && x.exitCode === 0;
  if (!ok(list)) {
    return { ...prev, local: next.local, repo: next.repo, status: "error", error: firstLine(list.stderr ?? list.thrown?.message) || "gh pr list failed", stale: prev.status === "ok" };
  }
  next.pr = ok(view) ? parsePrView(json(view.stdout) ?? {}) : null;
  if (!ok(view) && !NO_PR.test(view.stderr ?? "")) next.pr = prev.pr;   // a hiccup: keep what we had
  next.prs = parsePrList(json(list.stdout));
  next.reviewMe = ok(mine) ? (json(mine.stdout) ?? []).map((p) => p.number) : prev.reviewMe;
  next.runs = ok(runs) ? parseRuns(json(runs.stdout)) : prev.runs;
  next.issues = ok(issues) ? parseIssues(json(issues.stdout)) : prev.issues;
  // No access to alerts (not an admin, or turned off): leave the section out.
  next.alerts = ok(alerts) ? parseAlerts(json(alerts.stdout)) : null;
  next.status = "ok";
  next.fetchedAt = Date.now();
  return next;
}

async function unpushed(run) {
  for (const base of ["origin/HEAD", "origin/main", "origin/master"]) {
    try {
      const r = await run(["git", "rev-list", "--count", `${base}..HEAD`]);
      if (r.exitCode === 0) return Number(r.stdout.trim()) || 0;
    } catch { return null; }
  }
  return null;
}

function firstLine(text) {
  return String(text ?? "").trim().split("\n")[0].slice(0, 120);
}

// ---------------------------------------------------------------- what changed

// Toast-worthy changes between two good snapshots, as short lines.
export function diffGit(prev, next) {
  if (prev?.status !== "ok" || next?.status !== "ok" || !prev.fetchedAt) return [];
  const out = [];
  const a = prev.pr;
  const b = next.pr;
  if (a && b && a.number === b.number) {
    if (b.checks.fail > a.checks.fail) out.push(`✗ Checks failed on #${b.number}`);
    else if (a.checks.pending > 0 && b.checks.pending === 0 && b.checks.fail === 0 && b.checks.total) out.push(`✓ All checks passed on #${b.number}`);
    if (b.decision !== a.decision && b.decision === "APPROVED") out.push(`✓ #${b.number} was approved`);
    if (b.decision !== a.decision && b.decision === "CHANGES_REQUESTED") out.push(`● Changes requested on #${b.number}`);
    if (b.state !== a.state && b.state === "MERGED") out.push(`✓ #${b.number} was merged`);
    if (b.mergeable !== a.mergeable && b.mergeable === "CONFLICTING") out.push(`✗ #${b.number} has a merge conflict`);
  }
  for (const n of next.reviewMe) {
    if (prev.reviewMe.includes(n)) continue;
    const pr = next.prs.find((p) => p.number === n);
    out.push(`● ${pr?.author || "Someone"} asked for your review on #${n}${pr ? ` ${pr.title}` : ""}`);
  }
  return out;
}

// Needs a look: this branch's checks failed, or someone wants your review.
export function gitAttention(g) {
  if (g?.status !== "ok") return false;
  return (g.pr?.checks.fail ?? 0) > 0 || g.reviewMe.length > 0 || g.pr?.mergeable === "CONFLICTING";
}

export function ghStatusText(g) {
  switch (g.status) {
    case "no-gh": return "The Git room reads GitHub through the gh CLI. Install it (brew install gh), then gh auth login.";
    case "no-auth": return "gh isn't signed in. Run gh auth login in a terminal, then press r here.";
    case "no-repo": return "This session's folder isn't a git repository.";
    default: return "";
  }
}
