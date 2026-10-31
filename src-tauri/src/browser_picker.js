// Fork (L-207): MonoCode's pick-and-comment tool, injected into a Browser
// page. Everything it draws lives in a closed shadow root so page styles
// cannot reach it. Results go back through the `__monocodeBridge` binding
// (a CDP Runtime binding MonoCode adds); nothing is sent until Submit.
(() => {
  if (window.__monocodePicker) return;
  const BRIDGE = "__monocodeBridge";
  const MAX_PICKS = 30;
  const send = (payload) => {
    const bridge = window[BRIDGE];
    if (typeof bridge === "function") bridge(JSON.stringify(payload));
  };
  const clip = (value, max) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  // ---------- element facts (compact, for a coding agent) ----------
  const cssEscape = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : value);
  const stepFor = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && !/^\d|:/.test(el.id)) return `${tag}#${cssEscape(el.id)}`;
    const classes = Array.from(el.classList)
      .filter((name) => name.length < 32 && !/[:[\]/]/.test(name))
      .slice(0, 2);
    let step = classes.length ? `${tag}.${classes.map(cssEscape).join(".")}` : tag;
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return step;
  };
  const pathFor = (el) => {
    const steps = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && steps.length < 5) {
      steps.unshift(stepFor(node));
      if (node.id) break;
      node = node.parentElement;
    }
    return steps.join(" > ");
  };
  const sourceFromStack = (stack) => {
    if (typeof stack !== "string") return "";
    for (const line of stack.split("\n").slice(1)) {
      const match = line.match(/\(?((?:https?|file):\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/);
      if (!match) continue;
      const file = match[1].replace(/^[a-z]+:\/\/[^/]+/i, "").replace(/\?.*$/, "");
      if (/node_modules|react-dom|react\.development|scheduler|\/@vite\/|\/@fs\/.*node_modules/.test(file)) continue;
      return `${file.replace(/^\//, "")}:${match[2]}`;
    }
    return "";
  };
  const reactFacts = (el) => {
    const key = Object.keys(el).find((name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
    if (!key) return null;
    const names = [];
    let source = "";
    let fiber = el[key];
    let guard = 0;
    while (fiber && guard++ < 60 && names.length < 4) {
      const type = fiber.type;
      const name = typeof type === "function"
        ? type.displayName || type.name
        : type && typeof type === "object"
          ? type.displayName || (type.render && (type.render.displayName || type.render.name)) || (type.type && (type.type.displayName || type.type.name))
          : "";
      if (name && /^[A-Z]/.test(name) && !names.includes(name)) {
        names.push(name);
        if (!source) {
          const debug = fiber._debugSource;
          if (debug && debug.fileName) source = `${debug.fileName}:${debug.lineNumber}`;
          else if (fiber._debugStack) source = sourceFromStack(fiber._debugStack.stack || String(fiber._debugStack));
        }
      }
      fiber = fiber.return;
    }
    return names.length ? { components: names, source } : null;
  };
  const otherFrameworkFacts = (el) => {
    let node = el;
    for (let i = 0; node && i < 8; i += 1, node = node.parentElement) {
      const vue = node.__vueParentComponent;
      if (vue && vue.type) {
        return { components: [vue.type.name || vue.type.__name || "Vue component"], source: vue.type.__file || "" };
      }
      const svelte = node.__svelte_meta;
      if (svelte && svelte.loc) return { components: [], source: `${svelte.loc.file}:${svelte.loc.line}` };
    }
    return null;
  };
  const DEFAULTS = new Set(["0px", "normal", "none", "auto", "rgba(0, 0, 0, 0)", "static", "visible"]);
  const styleFacts = (el) => {
    const style = getComputedStyle(el);
    const out = {};
    for (const name of ["display", "position", "font-size", "font-weight", "line-height", "color", "background-color", "padding", "margin", "gap", "border-radius", "border", "width", "height", "opacity"]) {
      const value = style.getPropertyValue(name);
      if (value && !DEFAULTS.has(value) && !(name === "border" && value.startsWith("0px"))) out[name] = value;
    }
    return out;
  };
  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    const framework = reactFacts(el) || otherFrameworkFacts(el);
    return {
      tag: el.tagName.toLowerCase(),
      path: clip(pathFor(el), 300),
      text: clip(el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || "", 120),
      role: el.getAttribute("role") || "",
      label: clip(el.getAttribute("aria-label") || "", 80),
      href: el.tagName === "A" ? clip(el.getAttribute("href"), 200) : "",
      components: framework ? framework.components : [],
      source: framework ? clip(framework.source, 240) : "",
      rect: { x: Math.round(rect.left + scrollX), y: Math.round(rect.top + scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
      styles: styleFacts(el),
    };
  };

  // ---------- overlay ----------
  const host = document.createElement("monocode-picker");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
    .hover{position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.08);border-radius:3px;transition:all 60ms ease-out;display:none}
    .tag{position:fixed;pointer-events:none;background:#1e293b;color:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:11px;display:none;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
    .marker{position:absolute;pointer-events:auto;width:20px;height:20px;border-radius:10px;background:#3b82f6;color:#fff;font-weight:600;font-size:11px;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer}
    .outline{position:absolute;pointer-events:none;border:1.5px dashed #3b82f6;border-radius:3px}
    .card{position:fixed;pointer-events:auto;width:280px;background:#0f172a;color:#e2e8f0;border:1px solid rgba(148,163,184,.25);border-radius:10px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
    .card .who{color:#94a3b8;font-size:11px;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    textarea{width:100%;min-height:64px;resize:vertical;background:#020617;color:#e2e8f0;border:1px solid rgba(148,163,184,.3);border-radius:6px;padding:6px;outline:none}
    textarea:focus{border-color:#3b82f6}
    .row{display:flex;gap:6px;justify-content:flex-end;margin-top:8px;align-items:center}
    button{border:0;border-radius:6px;padding:5px 10px;cursor:pointer;background:rgba(148,163,184,.15);color:#e2e8f0}
    button:hover{background:rgba(148,163,184,.28)}
    button.primary{background:#3b82f6;color:#fff}
    button.primary:hover{background:#2563eb}
    button:active{transform:scale(.96)}
    .list{position:fixed;right:12px;bottom:12px;pointer-events:auto;width:300px;max-height:50vh;display:flex;flex-direction:column;background:#0f172a;color:#e2e8f0;border:1px solid rgba(148,163,184,.25);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
    .list header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.18);font-weight:600}
    .list ol{list-style:none;margin:0;padding:4px;overflow:auto}
    .list li{display:flex;gap:8px;align-items:flex-start;padding:6px;border-radius:6px}
    .list li:hover{background:rgba(148,163,184,.1)}
    .num{flex:none;width:18px;height:18px;border-radius:9px;background:#3b82f6;color:#fff;font-size:10px;font-weight:600;display:grid;place-items:center}
    .body{flex:1;min-width:0}
    .body .el{color:#94a3b8;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .x{flex:none;padding:0 6px;background:transparent;color:#94a3b8}
    .hint{color:#94a3b8;font-weight:400;font-size:11px}
    .area{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;background:rgba(15,23,42,.12)}
    .sel{position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,.12);display:none}
  </style>
  <div class="hover"></div><div class="tag"></div><div class="layer"></div>`;
  const hover = root.querySelector(".hover");
  const tag = root.querySelector(".tag");
  const layer = root.querySelector(".layer");

  let mode = "off";
  let picks = [];
  let card = null;
  let list = null;
  let area = null;
  let current = null;

  const ownsEvent = (event) => event.composedPath().includes(host);
  const targetAt = (x, y) => {
    host.style.display = "none";
    const el = document.elementFromPoint(x, y);
    host.style.display = "";
    return el;
  };
  const showHover = (el) => {
    if (!el) {
      hover.style.display = tag.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(hover.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const facts = reactFacts(el);
    tag.textContent = `${facts ? `${facts.components[0]} · ` : ""}${stepFor(el)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    Object.assign(tag.style, { display: "block", left: `${Math.max(4, rect.left)}px`, top: `${rect.top > 24 ? rect.top - 22 : rect.bottom + 4}px` });
  };

  const renderMarkers = () => {
    layer.querySelectorAll(".marker,.outline").forEach((node) => node.remove());
    layer.style.cssText = `position:absolute;left:${-scrollX}px;top:${-scrollY}px;`;
    picks.forEach((pick, index) => {
      const outline = document.createElement("div");
      outline.className = "outline";
      Object.assign(outline.style, { left: `${pick.rect.x}px`, top: `${pick.rect.y}px`, width: `${pick.rect.width}px`, height: `${pick.rect.height}px` });
      const marker = document.createElement("div");
      marker.className = "marker";
      marker.textContent = String(index + 1);
      marker.title = pick.comment;
      Object.assign(marker.style, { left: `${pick.rect.x - 10}px`, top: `${pick.rect.y - 10}px` });
      layer.append(outline, marker);
    });
  };
  const onScroll = () => {
    layer.style.cssText = `position:absolute;left:${-scrollX}px;top:${-scrollY}px;`;
    if (current) showHover(current);
  };

  const renderList = () => {
    if (!picks.length) {
      list?.remove();
      list = null;
      return;
    }
    if (!list) {
      list = document.createElement("section");
      list.className = "list";
      root.append(list);
    }
    list.innerHTML = "";
    const header = document.createElement("header");
    header.innerHTML = `<span>Changes <span class="hint">${picks.length}</span></span>`;
    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.marginTop = "0";
    const clear = document.createElement("button");
    clear.textContent = "Clear";
    clear.onclick = () => {
      picks = [];
      renderMarkers();
      renderList();
    };
    const submit = document.createElement("button");
    submit.className = "primary";
    submit.textContent = "Add to chat";
    submit.title = "Adds these to the chat box. Nothing is sent until you send it.";
    submit.onclick = () => {
      send({ kind: "picks", url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, items: picks });
      picks = [];
      renderMarkers();
      renderList();
    };
    actions.append(clear, submit);
    header.append(actions);
    const ol = document.createElement("ol");
    picks.forEach((pick, index) => {
      const li = document.createElement("li");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(index + 1);
      const body = document.createElement("div");
      body.className = "body";
      const text = document.createElement("div");
      text.textContent = pick.comment || "(no comment)";
      const el = document.createElement("div");
      el.className = "el";
      el.textContent = pick.components[0] ? `${pick.components[0]} · ${pick.path}` : pick.path;
      body.append(text, el);
      const remove = document.createElement("button");
      remove.className = "x";
      remove.textContent = "×";
      remove.title = "Remove";
      remove.onclick = () => {
        picks.splice(index, 1);
        renderMarkers();
        renderList();
      };
      li.append(num, body, remove);
      ol.append(li);
    });
    list.append(header, ol);
  };

  const closeCard = () => {
    card?.remove();
    card = null;
  };
  const openCard = (el) => {
    closeCard();
    const facts = describe(el);
    const rect = el.getBoundingClientRect();
    card = document.createElement("div");
    card.className = "card";
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = facts.components[0] ? `${facts.components[0]} · ${facts.path}` : facts.path;
    const input = document.createElement("textarea");
    input.placeholder = "What should change here?";
    const row = document.createElement("div");
    row.className = "row";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = closeCard;
    const add = document.createElement("button");
    add.className = "primary";
    add.textContent = "Add";
    const commit = () => {
      if (picks.length >= MAX_PICKS) return;
      picks.push({ ...facts, comment: clip(input.value, 1000) });
      closeCard();
      renderMarkers();
      renderList();
    };
    add.onclick = commit;
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") closeCard();
    });
    row.append(cancel, add);
    card.append(who, input, row);
    const left = Math.min(Math.max(8, rect.left), innerWidth - 288);
    const below = rect.bottom + 8;
    const top = below + 150 < innerHeight ? below : Math.max(8, rect.top - 158);
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    root.append(card);
    setTimeout(() => input.focus(), 0);
  };

  const onMove = (event) => {
    if (mode !== "element" || ownsEvent(event) || card) return;
    current = targetAt(event.clientX, event.clientY);
    showHover(current);
  };
  const block = (event) => {
    if (mode !== "element" || ownsEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onClick = (event) => {
    if (mode !== "element" || ownsEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const el = targetAt(event.clientX, event.clientY);
    if (el) openCard(el);
  };
  const onKey = (event) => {
    if (event.key !== "Escape" || mode === "off") return;
    if (card) closeCard();
    else stop(true);
  };

  const startArea = () => {
    area = document.createElement("div");
    area.className = "area";
    const sel = document.createElement("div");
    sel.className = "sel";
    area.append(sel);
    root.append(area);
    let start = null;
    area.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, y: event.clientY };
      area.setPointerCapture(event.pointerId);
    });
    area.addEventListener("pointermove", (event) => {
      if (!start) return;
      const x = Math.min(start.x, event.clientX);
      const y = Math.min(start.y, event.clientY);
      Object.assign(sel.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${Math.abs(event.clientX - start.x)}px`, height: `${Math.abs(event.clientY - start.y)}px` });
    });
    area.addEventListener("pointerup", (event) => {
      if (!start) return;
      const rect = {
        x: Math.min(start.x, event.clientX) + scrollX,
        y: Math.min(start.y, event.clientY) + scrollY,
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
      start = null;
      stop(false);
      if (rect.width < 4 || rect.height < 4) {
        send({ kind: "cancel" });
        return;
      }
      // Two frames so the overlay is gone from the captured pixels.
      requestAnimationFrame(() => requestAnimationFrame(() => send({ kind: "area", url: location.href, rect })));
    });
  };

  function start(next) {
    stop(false);
    mode = next;
    if (!host.isConnected) document.documentElement.append(host);
    addEventListener("keydown", onKey, true);
    addEventListener("scroll", onScroll, true);
    if (mode === "area") {
      startArea();
      return;
    }
    addEventListener("mousemove", onMove, true);
    addEventListener("click", onClick, true);
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu", "auxclick"]) addEventListener(type, block, true);
    renderMarkers();
    renderList();
  }
  function stop(notify) {
    if (mode === "off") return;
    const was = mode;
    mode = "off";
    removeEventListener("keydown", onKey, true);
    removeEventListener("scroll", onScroll, true);
    removeEventListener("mousemove", onMove, true);
    removeEventListener("click", onClick, true);
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu", "auxclick"]) removeEventListener(type, block, true);
    closeCard();
    area?.remove();
    area = null;
    current = null;
    showHover(null);
    if (was === "element") {
      // Unsent picks stay listed so turning the tool back on keeps them.
      layer.querySelectorAll(".marker,.outline").forEach((node) => node.remove());
      list?.remove();
      list = null;
    }
    host.remove();
    if (notify) send({ kind: "cancel" });
  }

  window.__monocodePicker = { start, stop: () => stop(false) };
})();
