// The Docker room's provider against what the docker CLI prints (recorded
// with Docker 29 on macOS), through a fake ctx. Nothing runs.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import docker, { jsonLines, shortImage, publishedPorts, shortStatus, stateOf, sizeOf, humanSize, logRow, memUse, resetSections } from "../plugins/squad-chat/bridge/src/rooms/providers/docker.mjs";

const PS = [
  { ID: "73f0f8d25f17", Image: "public.ecr.aws/supabase/postgrest:v14.18", Labels: "com.docker.compose.project=squad-chat,com.supabase.cli.project=squad-chat", Names: "supabase_rest", Networks: "supabase_net", Ports: "3000/tcp", State: "running", Status: "Up 5 days", HealthStatus: "none" },
  { ID: "9436fba8749e", Image: "public.ecr.aws/supabase/postgres:17.11.0.003", Labels: "com.docker.compose.project=squad-chat", Names: "supabase_db", Networks: "supabase_net", Ports: "0.0.0.0:54322->5432/tcp, [::]:54322->5432/tcp", State: "running", Status: "Up 5 days (healthy)", HealthStatus: "healthy" },
  { ID: "aa11bb22cc33", Image: "node:20", Labels: "", Names: "web-app", Networks: "bridge", Ports: "0.0.0.0:3000->3000/tcp", State: "running", Status: "Up 12 minutes (unhealthy)", HealthStatus: "unhealthy" },
  { ID: "dd44ee55ff66", Image: "redis", Labels: "", Names: "old-redis", Networks: "bridge", Ports: "", State: "exited", Status: "Exited (0) 2 hours ago", HealthStatus: "none" },
].map((x) => JSON.stringify(x)).join("\n");
const IMAGES = [
  { Containers: "N/A", CreatedSince: "2 weeks ago", ID: "448276390cbb", Repository: "public.ecr.aws/supabase/postgres", Size: "1.3GB", Tag: "17.11.0.003" },
  { Containers: "N/A", CreatedSince: "5 days ago", ID: "12ab34cd56ef", Repository: "node", Size: "1.1GB", Tag: "20" },
  { Containers: "0", CreatedSince: "3 weeks ago", ID: "77aa88bb99cc", Repository: "<none>", Size: "640MB", Tag: "<none>" },
  { Containers: "0", CreatedSince: "3 weeks ago", ID: "55dd66ee77ff", Repository: "redis", Size: "117MB", Tag: "latest" },
].map((x) => JSON.stringify(x)).join("\n");
const VOLUMES = [
  { Driver: "local", Labels: "com.docker.compose.project=squad-chat", Name: "supabase_db_data" },
  { Driver: "local", Labels: "", Name: "leftover" },
].map((x) => JSON.stringify(x)).join("\n");
const NETWORKS = [
  { Driver: "bridge", Name: "bridge", Scope: "local" },
  { Driver: "bridge", Name: "supabase_net", Scope: "local" },
  { Driver: "host", Name: "host", Scope: "local" },
].map((x) => JSON.stringify(x)).join("\n");
const STATS = JSON.stringify({ CPUPerc: "88.31%", MemPerc: "31.20%", MemUsage: "640MiB / 2GiB", Name: "web-app" });

function fake({ daemon = true, installed = true, ps = PS } = {}) {
  const runs = [];
  return {
    runs,
    ctx: {
      dataDir: "/rooms/docker",
      run: async (argv) => {
        runs.push(argv.join(" "));
        if (!installed) return null;
        if (argv[0] === "/bin/sh") return "GET /health 200\nError: connect ECONNREFUSED :5432\n";
        const [, cmd] = argv;
        if (cmd === "--version") return "Docker version 29.8.2\n";
        if (!daemon) return null;
        if (cmd === "version") return "29.8.2|Docker Desktop 4.94.0 (241994)\n";
        if (cmd === "ps") return ps;
        if (cmd === "images") return IMAGES;
        if (cmd === "volume") return argv.includes("-q") ? "leftover\n" : VOLUMES;
        if (cmd === "network") return NETWORKS;
        if (cmd === "stats") return STATS;
        return null;
      },
    },
  };
}

describe("docker: reading what the CLI prints", () => {
  it("takes one object a line and skips what isn't JSON", () => {
    assert.deepEqual(jsonLines('{"a":1}\nnot json\n\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  });

  it("drops a registry's host from an image's name, not a user's", () => {
    assert.equal(shortImage("public.ecr.aws/supabase/postgres"), "supabase/postgres");
    assert.equal(shortImage("localhost:5000/app"), "app");
    assert.equal(shortImage("supabase/studio"), "supabase/studio");
    assert.equal(shortImage("redis"), "redis");
  });

  it("shows published ports once each, and leaves internal ones out", () => {
    assert.equal(publishedPorts("0.0.0.0:54322->5432/tcp, [::]:54322->5432/tcp"), ":54322→5432");
    assert.equal(publishedPorts("0.0.0.0:3000->3000/tcp"), ":3000");
    assert.equal(publishedPorts("3000/tcp"), "");
  });

  it("shortens a status", () => {
    assert.equal(shortStatus("Up 5 days (healthy)"), "up 5d");
    assert.equal(shortStatus("Up About an hour"), "up 1h");
    assert.equal(shortStatus("Exited (1) 20 minutes ago"), "exited (1) 20m");
    assert.equal(shortStatus("2 weeks ago"), "2w");
  });

  it("colors a container by how it's doing", () => {
    assert.equal(stateOf({ State: "running", Status: "Up 1 hour (unhealthy)", HealthStatus: "unhealthy" }).tone, "amber");
    assert.equal(stateOf({ State: "running", Status: "Up 1 hour" }).tone, "leaf");
    assert.equal(stateOf({ State: "exited", Status: "Exited (137) 3 days ago" }).tone, "red");
    assert.equal(stateOf({ State: "exited", Status: "Exited (0) 3 days ago" }).tone, null);
  });

  it("makes a log line one row: local time, no colors, no time of its own", () => {
    const r = logRow("2026-10-17T02:16:01.797123Z \x1b[33m02:16:01.797 [warning]   slow   call\x1b[0m", 0);
    assert.match(r.time, /^\d\d:16:01$/);
    assert.equal(r.text, "[warning] slow call");
    assert.equal(r.tone, "amber");
    assert.equal(logRow("panic: nil map", 1).tone, "red");
    assert.equal(logRow("GET / 200", 2).time, "");
  });

  it("shortens memory use", () => {
    assert.equal(memUse("672.4MiB / 7.65GiB"), "672 MiB of 7.7 GiB");
    assert.equal(memUse("9.5MiB / 2GiB"), "9.5 MiB of 2 GiB");
  });

  it("adds sizes up in Docker's 1000s", () => {
    assert.equal(sizeOf("1.3GB"), 1.3e9);
    assert.equal(sizeOf("640MB"), 6.4e8);
    assert.equal(sizeOf("N/A"), 0);
    assert.equal(humanSize(2.4e9), "2.4 GB");
  });
});

describe("docker room", () => {
  beforeEach(() => resetSections());

  it("lists containers, the one needing a look first, and details the first", async () => {
    const { ctx } = fake();
    const d = await docker.fetch({ container: "first" }, ctx);
    assert.equal(d.engine, "Docker 29.8.2 · Docker Desktop 4.94.0");
    assert.deepEqual(d.containers.map((c) => c.name), ["web-app", "supabase_db", "supabase_rest", "old-redis"]);
    assert.equal(d.containers[1].ports, ":54322→5432");
    assert.equal(d.containersMeta, "3 running · 1 stopped");
    assert.deepEqual(d.on, { containers: true, images: null, volumes: null, networks: null });
    assert.equal(d.detail.name, "web-app");
    assert.equal(d.detail.cpu, 88);
    assert.equal(d.detail.cpuTone, "amber");
    assert.equal(d.detail.mem, 31);
    assert.equal(d.detail.memText, "640 MiB of 2 GiB");
    assert.deepEqual(d.detail.logs.map((r) => [r.text, r.tone]), [["GET /health 200", null], ["Error: connect ECONNREFUSED :5432", "red"]]);
    assert.equal(d.band, "3/4 up · web-app unhealthy");
    assert.equal(d.tone, "amber");
  });

  it("counts a crashed container as needing a look, ahead of an unhealthy one", async () => {
    const crashed = JSON.stringify({ ID: "ab12cd34ef56", Image: "postgres:17", Labels: "", Names: "pg", Networks: "bridge", Ports: "", State: "exited", Status: "Exited (1) 2 minutes ago", HealthStatus: "none" });
    const { ctx } = fake({ ps: `${PS}\n${crashed}` });
    const d = await docker.fetch({}, ctx);
    assert.equal(d.band, "3/5 up · pg exited (1) 2m · web-app unhealthy");
    assert.equal(d.tone, "red");
    assert.deepEqual(d.worst, { name: "pg", status: "exited (1) 2m", tone: "red" });
  });

  it("details the container picked, with no stats for a stopped one", async () => {
    const { ctx, runs } = fake();
    const d = await docker.fetch({ container: "old-redis" }, ctx);
    assert.equal(d.picked.name, "old-redis");
    assert.equal(d.detail.cpu, null);
    assert.ok(!runs.some((r) => r.includes(" stats ")));
    // The name goes to docker as one argument, never through the shell's words.
    assert.ok(runs.some((r) => r.startsWith('/bin/sh -c "$0" logs --tail 5 --timestamps "$1" 2>&1 docker dd44ee55ff66')));
  });

  it("switches section on an action, and leaves out the container card", async () => {
    const { ctx, runs } = fake();
    await docker.actions.images({}, {}, ctx);
    const d = await docker.fetch({ container: "first" }, ctx);
    assert.deepEqual(d.on, { containers: null, images: true, volumes: null, networks: null });
    assert.equal(d.detail, null);
    assert.ok(!runs.some((r) => r.includes(" logs ")));
    assert.deepEqual(d.images.map((i) => [i.name, i.use]), [["supabase/postgres:17.11.0.003", "in use"], ["node:20", "in use"], ["<none> 77aa88bb99cc", "dangling"], ["redis:latest", "in use"]]);
    assert.equal(d.imagesMeta, "4 images · 3.2 GB · 1 dangling");
  });

  it("marks unused volumes and counts each network's containers", async () => {
    const { ctx } = fake();
    const d = await docker.fetch({ container: "first" }, ctx);
    assert.deepEqual(d.volumes.map((v) => [v.name, v.use]), [["supabase_db_data", "in use"], ["leftover", "unused"]]);
    assert.equal(d.volumesMeta, "2 volumes · 1 unused");
    assert.deepEqual(d.networks.map((n) => [n.name, n.usersText]), [["bridge", "2 containers"], ["supabase_net", "2 containers"], ["host", ""]]);
  });

  it("says so when the daemon is down, or docker isn't there", async () => {
    let d = await docker.fetch({}, fake({ daemon: false }).ctx);
    assert.match(d.down, /isn't running/);
    assert.deepEqual(d.containers, []);
    d = await docker.fetch({}, fake({ installed: false }).ctx);
    assert.match(d.down, /No docker command/);
  });
});
