import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

test("the sidecar stays alive with its parent and exits after the parent is killed", { timeout: 15000 }, async () => {
  const guard = fileURLToPath(new URL("./sidecar-guard.js", import.meta.url));
  const parent = spawn(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-r', process.argv[1], '-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: true });
    child.unref();
    console.log(child.pid);
    setInterval(() => {}, 1000);
  `, guard], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let childPid;
  try {
    const [output] = await once(parent.stdout, "data");
    childPid = Number(output.toString().trim());
    assert.ok(Number.isInteger(childPid) && childPid > 0, "parent reports its sidecar PID");
    await delay(2500);
    assert.ok(alive(childPid), "sidecar remains alive while parent runs");
    const parentExited = once(parent, "exit");
    parent.kill();
    await parentExited;
    const deadline = Date.now() + 7000;
    while (alive(childPid) && Date.now() < deadline) await delay(100);
    assert.equal(alive(childPid), false, "sidecar exits after its parent disappears");
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill();
    if (childPid && alive(childPid)) process.kill(childPid);
  }
});
