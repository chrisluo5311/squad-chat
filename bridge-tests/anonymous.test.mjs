// Signing in with just a name (Supabase anonymous sign-ins), against the
// local stack, which enables them in supabase/config.toml.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { Bridge, localStackUp, runId } from "./helpers.mjs";

const up = await localStackUp();

describe("sign in with a name", { skip: !up && "local Supabase is not running (supabase start)" }, () => {
  const id = runId();
  const owl = new Bridge("owl");
  after(async () => { await owl.stop(); owl.cleanup(); });

  it("rejects names that can't be display names", async () => {
    await owl.start();
    await owl.waitFor((e) => e.type === "auth" && e.state === "signed_out");
    assert.equal((await owl.call("POST", "/login/name", { name: "has spaces" })).status, 400);
  });

  it("creates an account named after the name, with no email", async () => {
    const res = await owl.ok("POST", "/login/name", { name: `owl-${id}` });
    assert.equal(res.user.name, `owl-${id}`);
    assert.equal(res.user.email, null);
    assert.equal(res.user.anonymous, true);
  });

  it("can create a room and chat like anyone else", async () => {
    await owl.ok("POST", "/room", { slug: `nest-${id}`, passcode: "hoot1234" });
    const sent = await owl.ok("POST", "/send", { text: "hoo" });
    await owl.waitFor((e) => e.type === "message" && e.message.id === sent.id);
  });

  it("keeps the account across a restart", async () => {
    await owl.stop();
    await owl.start();
    const auth = await owl.waitFor((e) => e.type === "auth", 15_000, "auth");
    assert.equal(auth.state, "signed_in");
    assert.equal(auth.user.name, `owl-${id}`);
  });
});
