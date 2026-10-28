const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Section reveals ----------

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

// ---------- Patch panel: light the port for the section on screen ----------

const ports = new Map(
  Array.from(document.querySelectorAll(".port")).map((port) => [port.getAttribute("href").slice(1), port])
);

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      ports.forEach((port, id) => port.classList.toggle("is-current", id === entry.target.id));
    });
  },
  { rootMargin: "-45% 0px -45% 0px" }
);

ports.forEach((_, id) => {
  const section = document.getElementById(id);
  if (section) sectionObserver.observe(section);
});

// ---------- Rotating headline word ----------

const rotator = document.querySelector(".rotator");
const ROTATOR_WORDS = ["online.", "secure.", "connected.", "on air.", "patched."];

if (rotator && !reduceMotion) {
  let wordIndex = 0;
  setInterval(() => {
    if (document.hidden) return;
    rotator.classList.remove("is-in");
    rotator.classList.add("is-out");
    setTimeout(() => {
      wordIndex = (wordIndex + 1) % ROTATOR_WORDS.length;
      rotator.textContent = ROTATOR_WORDS[wordIndex];
      rotator.classList.remove("is-out");
      void rotator.offsetWidth; // restart the animation
      rotator.classList.add("is-in");
    }, 280);
  }, 2800);
}

// ---------- Scroll: parallax drift + the work cable drawing itself ----------

const drifters = Array.from(document.querySelectorAll("[data-speed]"));
const cableRun = document.querySelector(".cable-run");

function onScroll() {
  const viewH = window.innerHeight;

  if (cableRun) {
    const rect = cableRun.getBoundingClientRect();
    const progress = (viewH * 0.75 - rect.top) / rect.height;
    cableRun.style.setProperty("--draw", Math.min(1, Math.max(0, progress)).toFixed(3));
  }

  drifters.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const fromCenter = rect.top + rect.height / 2 - viewH / 2;
    // Remove the current offset so the drift is measured from the resting position
    const current = parseFloat(el.dataset.offset || 0);
    const offset = (fromCenter - current) * -parseFloat(el.dataset.speed);
    el.dataset.offset = offset;
    el.style.translate = `0 ${offset.toFixed(1)}px`;
  });
}

if (!reduceMotion) {
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    },
    { passive: true }
  );
  window.addEventListener("resize", onScroll);
  onScroll();
}

// ---------- Badges flip over on click ----------

document.querySelectorAll(".badge-card").forEach((card) => {
  const toggle = () => {
    const flipped = card.classList.toggle("is-flipped");
    card.setAttribute("aria-pressed", String(flipped));
    card.querySelector(".badge-front").setAttribute("aria-hidden", String(flipped));
    card.querySelector(".badge-back").setAttribute("aria-hidden", String(!flipped));
  };
  card.addEventListener("click", toggle);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
});

// ---------- Ticket: request types build the email subject ----------

const ticket = document.querySelector(".ticket-card");

if (ticket) {
  const boxes = Array.from(ticket.querySelectorAll(".request-types input"));
  const subjectLine = ticket.querySelector("#subject-line");
  const submit = ticket.querySelector("#submit-ticket");
  const EMAIL = "benjaminleebrown93@gmail.com";

  const updateSubject = () => {
    const picked = boxes.filter((box) => box.checked).map((box) => box.value);
    const subject = picked.length ? `Request: ${picked.join(" + ")}` : "New request";
    subjectLine.textContent = subject;
    submit.href = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}`;
  };

  boxes.forEach((box) => box.addEventListener("change", updateSubject));
  updateSubject();

  submit.addEventListener("click", (event) => {
    if (reduceMotion) return;
    event.preventDefault();
    ticket.classList.remove("is-submitted");
    void ticket.offsetWidth;
    ticket.classList.add("is-submitted");
    setTimeout(() => {
      window.location.href = submit.href;
    }, 650);
  });
}

// ---------- Status ticker mirrors the network map ----------

const tickerEl = document.querySelector(".ticker");

document.addEventListener("network:status", (event) => {
  if (!tickerEl) return;
  const { online, total } = event.detail;
  tickerEl.querySelectorAll("[data-online]").forEach((el) => (el.textContent = online));
  const incident = online < total;
  tickerEl.classList.toggle("has-incident", incident);
  tickerEl.querySelectorAll("[data-status-text]").forEach((el) => {
    el.textContent = incident ? "incident in progress" : "all systems operational";
  });
});

// ---------- Network map ----------
// 74 offices across the US, each uplinked to one of 6 regional switches, which trunk
// to HQ in Provo, UT. Packets ride the links. Hover an office to trace its route;
// click it to knock it offline and watch a technician ride out from HQ to fix it.

const REPAIR_DELAY = 0.7; // seconds an office stays down before the fix goes out
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  parent?.appendChild(el);
  return el;
}

// Quadratic arc from a to b, bowed sideways so links read like flight paths
function arc(a, b, bend) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const c = [mx - dy * bend, my + dx * bend];
  return { a, b, c, d: `M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}` };
}

function pointOn({ a, b, c }, t) {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

async function initNetwork() {
  const svg = document.querySelector("#network");
  if (!svg) return;

  const { VIEW, HQ, SWITCHES, OFFICES, UPLINK, NATION, BORDERS } = await import("./map-data.js");
  const frame = svg.parentElement;
  const tip = frame.querySelector(".node-tip");
  const counter = frame.querySelector(".incidents");

  // Layers, back to front
  const mapLayer = svgEl("g", {}, svg);
  const linkLayer = svgEl("g", {}, svg);
  const routeLayer = svgEl("g", {}, svg);
  const packetLayer = svgEl("g", {}, svg);
  const nodeLayer = svgEl("g", {}, svg);
  const fxLayer = svgEl("g", {}, svg);

  svgEl("path", { d: NATION, class: "us-nation" }, mapLayer);
  svgEl("path", { d: BORDERS, class: "us-borders" }, mapLayer);

  const trunks = SWITCHES.map((sw, s) => arc(sw, HQ, s % 2 ? 0.12 : -0.12));
  const uplinks = OFFICES.map((o, i) => arc(o, SWITCHES[UPLINK[i]], i % 2 ? 0.1 : -0.1));

  trunks.forEach((t) => svgEl("path", { d: t.d, class: "link trunk" }, linkLayer));
  const uplinkEls = uplinks.map((u) => svgEl("path", { d: u.d, class: "link" }, linkLayer));

  const route = svgEl("path", { class: "route", visibility: "hidden" }, routeLayer);

  // Node and hit sizes grow on small screens so offices stay visible and tappable
  let OFFICE_R = 4.5;
  const officeEls = OFFICES.map(([x, y]) => svgEl("circle", { cx: x, cy: y, r: OFFICE_R, class: "office" }, nodeLayer));
  SWITCHES.forEach(([x, y]) => svgEl("circle", { cx: x, cy: y, r: 6.5, class: "switch" }, nodeLayer));
  const halo = svgEl("circle", { cx: HQ[0], cy: HQ[1], r: 18, class: "hq-halo" }, nodeLayer);
  svgEl("circle", { cx: HQ[0], cy: HQ[1], r: 10, class: "hq" }, nodeLayer);
  svgEl("text", { x: HQ[0] + 16, y: HQ[1] - 14, class: "hq-label" }, nodeLayer).textContent = "HQ · Provo";
  const hoverRing = svgEl("circle", { r: 10, class: "hover-ring", visibility: "hidden" }, fxLayer);

  // Generous invisible hit targets on top of everything
  const hitEls = OFFICES.map(([x, y], i) => {
    const hit = svgEl("circle", { cx: x, cy: y, r: 13, class: "hit" }, fxLayer);
    hit.dataset.index = i;
    return hit;
  });

  // "up" | "down" | "repairing"
  const status = OFFICES.map(() => "up");
  let resolved = 0;
  let hovered = -1;

  const TIP_TEXT = { up: "link up", down: "down", repairing: "tech en route" };

  function updateTip() {
    if (hovered === -1) return;
    const [x, y] = OFFICES[hovered];
    const { width, height } = svg.getBoundingClientRect();
    tip.textContent = `office ${hovered + 1} · ${TIP_TEXT[status[hovered]]}`;
    tip.dataset.status = status[hovered];
    // Keep the label inside the map's edges
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max((x / VIEW[0]) * width, half), width - half)}px`;
    tip.style.top = `${(y / VIEW[1]) * height}px`;
  }

  function setHovered(i) {
    if (i === hovered) return;
    if (hovered !== -1 && status[hovered] === "up") officeEls[hovered].setAttribute("r", OFFICE_R);
    hovered = i;
    const show = i === -1 ? "hidden" : "visible";
    route.setAttribute("visibility", show);
    hoverRing.setAttribute("visibility", show);
    tip.hidden = i === -1;
    if (i === -1) return;
    if (status[i] === "up") officeEls[i].setAttribute("r", OFFICE_R * 1.6);
    hoverRing.setAttribute("cx", OFFICES[i][0]);
    hoverRing.setAttribute("cy", OFFICES[i][1]);
    route.setAttribute("d", `${uplinks[i].d} ${trunks[UPLINK[i]].d}`);
    updateTip();
  }

  // ---- Incidents ----
  const techs = [];
  const bursts = [];

  function breakOffice(i) {
    if (status[i] !== "up") return;
    status[i] = "down";
    officeEls[i].classList.add("is-down");
    uplinkEls[i].classList.add("is-down");
    const el = svgEl("circle", { r: 6, class: "tech", visibility: "hidden" }, fxLayer);
    techs.push({ office: i, el, wait: REPAIR_DELAY, t: 0 });
    updateTip();
    broadcast();
  }

  function restoreOffice(i) {
    status[i] = "up";
    officeEls[i].classList.remove("is-down");
    uplinkEls[i].classList.remove("is-down");
    officeEls[i].setAttribute("r", i === hovered ? OFFICE_R * 1.6 : OFFICE_R);
    resolved += 1;
    counter.textContent = `incidents resolved: ${resolved}`;
    const [x, y] = OFFICES[i];
    bursts.push({ el: svgEl("circle", { cx: x, cy: y, r: 6, class: "burst" }, fxLayer), age: 0 });
    updateTip();
    broadcast();
  }

  function broadcast() {
    const online = status.filter((s) => s === "up").length;
    document.dispatchEvent(
      new CustomEvent("network:status", { detail: { online, total: OFFICES.length, resolved } })
    );
  }

  function updateIncidents(delta, elapsed) {
    for (let k = techs.length - 1; k >= 0; k -= 1) {
      const tech = techs[k];
      if (tech.wait > 0) {
        tech.wait -= delta;
        if (tech.wait <= 0) {
          status[tech.office] = "repairing";
          tech.el.setAttribute("visibility", "visible");
          updateTip();
        }
        continue;
      }
      tech.t = Math.min(1, tech.t + delta * 0.6);
      // HQ → switch (trunk, reversed), then switch → office (uplink, reversed)
      const [x, y] =
        tech.t < 0.5
          ? pointOn(trunks[UPLINK[tech.office]], 1 - tech.t * 2)
          : pointOn(uplinks[tech.office], 1 - (tech.t - 0.5) * 2);
      tech.el.setAttribute("cx", x);
      tech.el.setAttribute("cy", y);
      if (tech.t >= 1) {
        tech.el.remove();
        techs.splice(k, 1);
        restoreOffice(tech.office);
      }
    }

    // Downed offices throb until fixed
    status.forEach((s, i) => {
      if (s !== "up") officeEls[i].setAttribute("r", OFFICE_R * (1.4 + Math.sin(elapsed * 10) * 0.35));
    });

    for (let k = bursts.length - 1; k >= 0; k -= 1) {
      const burst = bursts[k];
      burst.age += delta;
      const p = burst.age / 0.7;
      burst.el.setAttribute("r", 6 + p * 22);
      burst.el.setAttribute("opacity", Math.max(0, 1 - p));
      if (p >= 1) {
        burst.el.remove();
        bursts.splice(k, 1);
      }
    }
  }

  // ---- Ambient traffic (skips offices that are down) ----
  const PACKET_COUNT = reduceMotion ? 0 : 40;

  function newRoute() {
    let i;
    do i = Math.floor(Math.random() * OFFICES.length);
    while (status[i] !== "up");
    // Office → switch → HQ, or the reverse
    return Math.random() < 0.5
      ? [{ curve: uplinks[i], reverse: false }, { curve: trunks[UPLINK[i]], reverse: false }]
      : [{ curve: trunks[UPLINK[i]], reverse: true }, { curve: uplinks[i], reverse: true }];
  }

  const packets = Array.from({ length: PACKET_COUNT }, () => ({
    el: svgEl("circle", { r: 2.4, class: "packet" }, packetLayer),
    hops: newRoute(),
    t: Math.random(),
    speed: 0.2 + Math.random() * 0.2
  }));

  function updatePackets(delta) {
    packets.forEach((packet) => {
      packet.t += delta * packet.speed;
      if (packet.t >= 1) {
        packet.t = 0;
        packet.hops = newRoute();
      }
      const hop = packet.hops[packet.t < 0.5 ? 0 : 1];
      const local = packet.t < 0.5 ? packet.t * 2 : (packet.t - 0.5) * 2;
      const [x, y] = pointOn(hop.curve, hop.reverse ? 1 - local : local);
      packet.el.setAttribute("cx", x);
      packet.el.setAttribute("cy", y);
    });
  }

  // ---- Pointer handling ----
  hitEls.forEach((hit, i) => {
    hit.addEventListener("pointerenter", () => setHovered(i));
    hit.addEventListener("pointerleave", () => setHovered(-1));
    hit.addEventListener("click", () => {
      setHovered(i);
      breakOffice(i);
    });
  });

  function resize() {
    const scale = svg.getBoundingClientRect().width / VIEW[0];
    if (!scale) return;
    OFFICE_R = Math.max(4.5, 2.6 / scale);
    const hitR = Math.max(13, 16 / scale);
    officeEls.forEach((el, i) => {
      if (status[i] === "up") el.setAttribute("r", i === hovered ? OFFICE_R * 1.6 : OFFICE_R);
    });
    hitEls.forEach((el) => el.setAttribute("r", hitR));
    updateTip();
  }

  new ResizeObserver(resize).observe(svg);
  resize();

  // ---- Loop (paused while the map is off screen) ----
  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  }).observe(frame);

  let last = performance.now();
  let elapsed = 0;

  function frameLoop(now) {
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (visible) {
      elapsed += delta;
      updatePackets(delta);
      updateIncidents(delta, elapsed);
      if (!reduceMotion) halo.setAttribute("r", 18 + Math.sin(elapsed * 2) * 3);
    }
    requestAnimationFrame(frameLoop);
  }

  updatePackets(0);
  requestAnimationFrame(frameLoop);
}

initNetwork();
