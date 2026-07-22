import fs from "node:fs/promises";
import path from "node:path";

const debugPort = Number(process.env.CDP_PORT ?? 9222);
const appUrl = process.env.APP_URL ?? "http://localhost:5173";
const outputDir = path.resolve(process.env.UI_AUDIT_OUTPUT ?? "outputs/ui-audit");
const views = ["Dashboard", "Warehouse", "Inventory", "Logistics", "Monitoring", "Audit"];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findPage() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page" && item.url.startsWith(appUrl));
      if (page) return page;
    } catch {
      // Browser startup is asynchronous; retry until the deadline.
    }
    await delay(250);
  }
  throw new Error(`No ${appUrl} page found on CDP port ${debugPort}.`);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      this.events.push(message);
    });
  }

  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

await fs.mkdir(outputDir, { recursive: true });
const page = await findPage();
console.log(`Auditing ${page.url} through CDP port ${debugPort}`);
const cdp = new CdpClient(page.webSocketDebuggerUrl);
await cdp.ready();
console.log("CDP connected");
await cdp.call("Runtime.enable");
await cdp.call("Log.enable");
await cdp.call("Page.enable");
await cdp.call("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false
});
await delay(2_500);

const findings = [];
for (const view of views) {
  const clicked = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll("nav button")].find((item) => item.textContent.trim() === ${JSON.stringify(view)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) {
    findings.push({ view, severity: "error", message: "Navigation button was not found." });
    continue;
  }
  await delay(view === "Warehouse" || view === "Logistics" ? 2_500 : 1_200);
  const state = await cdp.evaluate(`(() => {
    const text = document.body.innerText;
    const badTokens = ["NaN", "undefined", "Invalid Date", "[object Object]"]
      .filter((token) => text.includes(token));
    const main = document.querySelector("main");
    const visibleButtons = [...document.querySelectorAll("button")].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
    const isInsideHorizontalScroller = (element) => {
      let current = element.parentElement;
      while (current) {
        const style = getComputedStyle(current);
        if (current.scrollWidth > current.clientWidth + 1 && ["auto", "scroll"].includes(style.overflowX)) return true;
        current = current.parentElement;
      }
      return false;
    };
    const clippedButtons = visibleButtons.filter((element) => {
      const rect = element.getBoundingClientRect();
      return (rect.right > innerWidth + 1 || rect.left < -1) && !isInsideHorizontalScroller(element);
    }).map((element) => element.textContent.trim()).filter(Boolean).slice(0, 10);
    return {
      title: document.title,
      text,
      badTokens,
      mainScrollWidth: main?.scrollWidth ?? 0,
      mainClientWidth: main?.clientWidth ?? 0,
      clippedButtons,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: innerWidth
    };
  })()`);
  if (!state.text.includes(view)) findings.push({ view, severity: "error", message: `View label ${view} is absent after navigation.` });
  for (const token of state.badTokens) findings.push({ view, severity: "error", message: `Rendered invalid token: ${token}.` });
  if (state.clippedButtons.length) findings.push({ view, severity: "warning", message: `Buttons outside the viewport: ${state.clippedButtons.join(", ")}.` });
  try {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(path.join(outputDir, `${view.toLowerCase()}.png`), Buffer.from(screenshot.data, "base64"));
  } catch (error) {
    findings.push({ view, severity: "warning", message: `Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}.` });
  }
  await fs.writeFile(path.join(outputDir, `${view.toLowerCase()}.txt`), state.text, "utf8");
  console.log(`${view}: ${state.text.split("\n").filter(Boolean).length} text lines, main ${state.mainClientWidth}/${state.mainScrollWidth}px, ${state.clippedButtons.length} clipped buttons`);
}

const clickText = async (selector, label) => cdp.evaluate(`(() => {
  const item = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((element) => element.textContent.trim() === ${JSON.stringify(label)});
  if (!item) return false;
  item.click();
  return true;
})()`);
const expectText = async (flow, labels) => {
  const result = await cdp.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      text,
      missing: ${JSON.stringify(labels)}.filter((label) => !text.toLowerCase().includes(label.toLowerCase())),
      badTokens: ["NaN", "undefined", "Invalid Date", "[object Object]"].filter((token) => text.includes(token))
    };
  })()`);
  result.missing.forEach((label) => findings.push({ view: flow, severity: "error", message: `Expected text is missing: ${label}.` }));
  result.badTokens.forEach((token) => findings.push({ view: flow, severity: "error", message: `Rendered invalid token: ${token}.` }));
  if (result.missing.length) {
    await fs.writeFile(path.join(outputDir, `debug-${flow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`), result.text, "utf8");
  }
};

const auditClippedControls = async (flow, scopeSelector = "main") => {
  const result = await cdp.evaluate(`(() => {
    const scope = document.querySelector(${JSON.stringify(scopeSelector)});
    if (!scope) return { scopeFound: false, clipped: [] };
    const scopeRect = scope.getBoundingClientRect();
    const leftBoundary = Math.max(0, scopeRect.left);
    const rightBoundary = Math.min(innerWidth, scopeRect.right);
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const isInsideHorizontalScroller = (element) => {
      let current = element.parentElement;
      while (current && current !== scope) {
        const style = getComputedStyle(current);
        if (current.scrollWidth > current.clientWidth + 1 && ["auto", "scroll"].includes(style.overflowX)) return true;
        current = current.parentElement;
      }
      return false;
    };
    const controls = [...scope.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"]')]
      .filter(isVisible);
    const clipped = controls.filter((element) => {
      const rect = element.getBoundingClientRect();
      return (rect.left < leftBoundary - 1 || rect.right > rightBoundary + 1) && !isInsideHorizontalScroller(element);
    }).map((element) => ({
      label: element.getAttribute("aria-label") || element.textContent?.trim() || element.getAttribute("name") || element.tagName,
      left: Math.round(element.getBoundingClientRect().left),
      right: Math.round(element.getBoundingClientRect().right)
    })).slice(0, 12);
    return { scopeFound: true, clipped };
  })()`);
  if (!result.scopeFound) {
    findings.push({ view: flow, severity: "error", message: `Control-clipping scope was not found: ${scopeSelector}.` });
  } else if (result.clipped.length) {
    findings.push({
      view: flow,
      severity: "warning",
      message: `Interactive controls extend outside their visible container: ${result.clipped.map((item) => `${item.label} (${item.left}-${item.right}px)`).join(", ")}.`
    });
  }
};

const captureFlowScreenshot = async (flow, filename) => {
  try {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(path.join(outputDir, filename), Buffer.from(screenshot.data, "base64"));
  } catch (error) {
    findings.push({ view: flow, severity: "warning", message: `Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}.` });
  }
};

const openAuditDetails = async ({ flow, openerSelector, dialogLabel, required }) => {
  const result = await cdp.evaluate(`new Promise((resolve) => {
    const opener = document.querySelector(${JSON.stringify(openerSelector)});
    if (!opener) return resolve({ openerFound: false, dialogFound: false });
    opener.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    setTimeout(() => resolve({
      openerFound: true,
      dialogFound: Boolean(document.querySelector(${JSON.stringify(`[role="dialog"][aria-label="${dialogLabel}"]`)})),
      closeFound: Boolean(document.querySelector('[aria-label="Close audit details"]'))
    }), 200);
  })`);
  if (!result.openerFound) {
    if (required) findings.push({ view: flow, severity: "error", message: "No detail opener was available for a populated audit workspace." });
    return false;
  }
  if (!result.dialogFound) {
    findings.push({ view: flow, severity: "error", message: `The ${dialogLabel} drawer did not open.` });
    return false;
  }
  if (!result.closeFound) findings.push({ view: flow, severity: "error", message: "The audit details drawer has no accessible close control." });
  await auditClippedControls(flow, `[role="dialog"][aria-label="${dialogLabel}"]`);
  await captureFlowScreenshot(flow, `${flow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
  await cdp.evaluate(`document.querySelector('[aria-label="Close audit details"]')?.click()`);
  await delay(150);
  const remainedOpen = await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(`[role="dialog"][aria-label="${dialogLabel}"]`)}))`);
  if (remainedOpen) findings.push({ view: flow, severity: "error", message: "The audit details drawer remained open after using its close control." });
  return true;
};

// Exercise Inventory's operational sub-views and drawers, not only its default overview.
await clickText("nav button", "Inventory");
await delay(500);
for (const [tab, expected] of [
  ["Overview", "Inventory health"],
  ["Inventory", "Stock ledger"],
  ["Inbound", "Live inbound queue"],
  ["Outbound", "Live outbound queue"],
  ["Movements", "Inventory movement history"]
]) {
  if (!await clickText('nav[aria-label="Inventory Control sections"] button', tab)) {
    findings.push({ view: `Inventory / ${tab}`, severity: "error", message: "Sub-view button was not found." });
    continue;
  }
  await delay(450);
  await expectText(`Inventory / ${tab}`, [expected]);
}

await clickText('nav[aria-label="Inventory Control sections"] button', "Inbound");
await delay(400);
const inboundOpened = await cdp.evaluate(`new Promise((resolve) => {
  const row = document.querySelector('[aria-label="Open ASN-1002 details"]');
  if (!row) return resolve(false);
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  setTimeout(() => resolve(Boolean(document.querySelector('[aria-label="ASN-1002 details"]'))), 150);
})`);
if (!inboundOpened) findings.push({ view: "Inbound details", severity: "error", message: "ASN-1002 row could not be opened." });
else {
  await delay(400);
  await expectText("Inbound details", ["Purchase order", "Goods receipt", "Schedule adherence", "110 / 210 units"]);
  await clickText("button", "Products & Lots");
  await delay(250);
  await expectText("Inbound product trace", ["Stock provenance STO", "Linked inspection lot", "Linked handling unit"]);
  await clickText("button", "Transport");
  await delay(250);
  await expectText("Inbound transport trace", ["Transport record", "Dock appointment", "Planned arrival", "Actual arrival"]);
}

await clickText('nav[aria-label="Inventory Control sections"] button', "Outbound");
await delay(400);
const outboundOpened = await cdp.evaluate(`new Promise((resolve) => {
  const row = document.querySelector('[aria-label="Open SHIP-005 details"]');
  if (!row) return resolve(false);
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  setTimeout(() => resolve(Boolean(document.querySelector('[aria-label="SHIP-005 details"]'))), 150);
})`);
if (!outboundOpened) findings.push({ view: "Outbound details", severity: "error", message: "SHIP-005 row could not be opened." });
else {
  await delay(400);
  await expectText("Outbound details", ["Customer order", "Delivery deadline", "Unallocated quantity", "Goods issue"]);
  await clickText("button", "Products & Lots");
  await delay(250);
  await expectText("Outbound product trace", ["Candidate stock balance", "Linked inspection lot", "Allocation status"]);
  await clickText("button", "Preview inventory impact");
  await delay(350);
  await expectText("Outbound simulation", ["Projection only", "Inventory change", "Shipment is blocked", "Database", "Unchanged"]);
  await cdp.evaluate(`document.querySelector('[aria-label="Close simulation"]')?.click()`);
}

// Logistics exposes one focused workspace at a time; verify every operational mode.
await clickText("nav button", "Logistics");
await delay(900);
for (const [tab, expected] of [
  ["Network", ["Transport network", "Movement queue"]],
  ["Transport board", ["Transport execution board", "Operational time", "Dock / WMS"]],
  ["Dock schedule", ["Yard and dock handoffs", "active"]]
]) {
  const clicked = await cdp.evaluate(`(() => {
    const button = document.querySelector('nav[aria-label="Logistics workspace"] button[aria-label=${JSON.stringify(tab)}]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) {
    findings.push({ view: `Logistics / ${tab}`, severity: "error", message: "Workspace button was not found." });
    continue;
  }
  await delay(tab === "Network" ? 900 : 350);
  if (tab === "Network") {
    await cdp.evaluate(`document.querySelector('[aria-label="Close transport detail"]')?.click()`);
    await delay(150);
  }
  await expectText(`Logistics / ${tab}`, expected);
  try {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(path.join(outputDir, `logistics-${tab.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`), Buffer.from(screenshot.data, "base64"));
  } catch (error) {
    findings.push({ view: `Logistics / ${tab}`, severity: "warning", message: `Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}.` });
  }
}

// Pausing monitoring must visibly stop claiming that its frozen data is live.
await clickText("nav button", "Monitoring");
await delay(450);
if (await clickText("button", "Pause feed")) {
  await delay(200);
  await expectText("Monitoring paused state", ["Paused"]);
  await clickText("button", "Resume feed");
}

// Audit is an operational workspace with three distinct modes. Exercise every mode, its
// responsive controls, and the shared details drawer rather than validating only the landing view.
await clickText("nav button", "Audit");
await delay(600);
for (const mode of ["Event Ledger", "Exception Cases", "Approvals & Decisions"]) {
  const flow = `Audit / ${mode}`;
  const workspaceOpened = await cdp.evaluate(`(() => {
    const button = document.querySelector('button[aria-label=${JSON.stringify(mode)}]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!workspaceOpened) {
    findings.push({ view: flow, severity: "error", message: "Audit workspace button was not found." });
    continue;
  }
  await delay(350);
  await expectText(flow, [mode]);
  await auditClippedControls(flow, "main");
  await captureFlowScreenshot(flow, `audit-${mode.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);

  if (mode === "Event Ledger") {
    const controls = await cdp.evaluate(`(() => {
      const labels = ["Audit date range", "Audit domain", "Audit outcome", "Refresh audit records"];
      return labels.filter((label) => !document.querySelector('[aria-label="' + label + '"]'));
    })()`);
    controls.forEach((label) => findings.push({ view: flow, severity: "error", message: `Required ledger control is missing: ${label}.` }));
    await openAuditDetails({
      flow: "Audit event details",
      openerSelector: 'tr[aria-label^="Open audit event "]',
      dialogLabel: "Audit event details",
      required: true
    });
  } else if (mode === "Exception Cases") {
    await openAuditDetails({
      flow: "Audit exception details",
      openerSelector: '[aria-label^="Open exception case "]',
      dialogLabel: "Exception case details",
      required: true
    });
  } else {
    // A clean proof-of-concept database may legitimately have no decisions. When a decision is
    // present, still require it to open the same accessible, unclipped drawer interaction.
    await openAuditDetails({
      flow: "Audit decision details",
      openerSelector: 'tr[aria-label^="Open decision "]',
      dialogLabel: "Approval decision details",
      required: false
    });
  }
}

const runtimeErrors = cdp.events
  .filter((event) => event.method === "Runtime.exceptionThrown" || (event.method === "Log.entryAdded" && ["error", "warning"].includes(event.params.entry.level)))
  .map((event) => event.method === "Runtime.exceptionThrown"
    ? event.params.exceptionDetails.text
    : `${event.params.entry.level}: ${event.params.entry.text}`);
runtimeErrors.forEach((message) => findings.push({ view: "Application", severity: "error", message }));

await fs.writeFile(path.join(outputDir, "findings.json"), JSON.stringify({ checkedAt: new Date().toISOString(), appUrl, findings }, null, 2));
console.log(`Findings: ${findings.length}`);
for (const finding of findings) console.log(`${finding.severity.toUpperCase()} [${finding.view}] ${finding.message}`);
cdp.close();
if (findings.some((finding) => finding.severity === "error")) process.exitCode = 1;
