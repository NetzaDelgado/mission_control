/**
 * Órbita · modelo educativo 2D, unidades SI salvo parámetros documentados.
 * Curvas sintéticas de empuje, no curvas medidas ni certificación de vuelo.
 * No modela estabilidad, flexión, ráfagas ni la descarga final de aire del agua.
 */
const G = 9.80665;
const AMBIENT_PRESSURE = 101325;
const WATER_DENSITY = 1000;
const GAMMA = 1.4;
const MAX_TIME = 240;
const LIMIT_STEPS = 220000;

export const MOTORS = Object.freeze([
  { id: 'A8-3', name: 'Estes A8-3', impulse: 2.5, burnTime: 0.8, propellantMass: 0.0041, mass: 0.0156, delay: 3, diameter: 0.018, maxLiftMass: 0.085, source: 'https://estesrockets.com/products/a8-3-engines', description: '18 mm · impulso de catálogo · curva aproximada' },
  { id: 'B6-4', name: 'Estes B6-4', impulse: 5, burnTime: 0.8, propellantMass: 0.0065, mass: 0.0179, delay: 4, diameter: 0.018, maxLiftMass: 0.113, source: 'https://estesrockets.com/products/b6-4-engines', description: '18 mm · impulso de catálogo · curva aproximada' },
  { id: 'C6-5', name: 'Estes C6-5', impulse: 10, burnTime: 1.6, propellantMass: 0.0122, mass: 0.0241, delay: 5, diameter: 0.018, maxLiftMass: 0.113, source: 'https://estesrockets.com/products/c6-5-engines', description: '18 mm · impulso de catálogo · curva aproximada' },
  { id: 'D12-5', name: 'Estes D12-5', impulse: 20, burnTime: 1.6, propellantMass: 0.0242, mass: 0.0456, delay: 5, diameter: 0.024, maxLiftMass: 0.283, source: 'https://estesrockets.com/products/d12-5-engines', description: '24 mm · impulso de catálogo · curva aproximada' },
].map(Object.freeze));

const COMMON = {
  mode: 'estes', motorId: 'C6-5', dryMass: 0.045, diameter: 0.025,
  cd: 0.5, angle: 3, wind: 2, railLength: 1, parachute: true,
  chuteDiameter: 0.3, chuteCd: 1.5, bottleVolume: 2, waterFill: 35,
  pressure: 4, nozzleDiameter: 9,
};

export const DEFAULTS = Object.freeze({
  estes: Object.freeze({ ...COMMON }),
  water: Object.freeze({ ...COMMON, mode: 'water', dryMass: 0.18, diameter: 0.105, cd: 0.45, railLength: 0.8, chuteDiameter: 0.55 }),
});

// Límites del dominio numérico: no son límites de presión, diseño ni operación seguros.
export const LIMITS = Object.freeze({
  dryMass: [0.005, 5], diameter: [0.01, 0.4], cd: [0.05, 2],
  angle: [0, 20], wind: [-20, 20], railLength: [0.1, 5],
  chuteDiameter: [0.05, 2], chuteCd: [0.2, 2.5],
  bottleVolume: [0.25, 5], waterFill: [0, 90], pressure: [0, 8],
  nozzleDiameter: [2, 30],
});

// Perfil común esquemático: arranque, pico, meseta, apagado. Se normaliza
// exactamente al impulso de catálogo; NO reproduce un ensayo del fabricante.
const CURVE = [[0, 0], [0.055, 1.7], [0.14, 2.3], [0.24, 0.88], [0.83, 0.72], [0.95, 0.56], [1, 0]];
const CURVE_AREA = CURVE.slice(1).reduce((sum, p, i) => sum + (p[0] - CURVE[i][0]) * (p[1] + CURVE[i][1]) / 2, 0);
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));

function resolveMotor(motor) {
  const found = typeof motor === 'string' ? MOTORS.find(item => item.id === motor) : motor;
  if (!found || !MOTORS.includes(found)) throw new RangeError('Selecciona un motor Estes del catálogo.');
  return found;
}

/** Empuje sintético en N. motor puede ser un id o un objeto de MOTORS. */
export function motorThrust(motor, t) {
  const m = resolveMotor(motor);
  if (!Number.isFinite(t)) throw new RangeError('El tiempo debe ser finito.');
  if (t <= 0 || t >= m.burnTime) return 0;
  const u = t / m.burnTime;
  for (let i = 1; i < CURVE.length; i++) {
    const [a, fa] = CURVE[i - 1];
    const [b, fb] = CURVE[i];
    if (u <= b) return (fa + (fb - fa) * (u - a) / (b - a)) * m.impulse / (m.burnTime * CURVE_AREA);
  }
  return 0;
}

/** Impulso acumulado exacto del perfil por tramos, en N·s. */
export function motorImpulse(motor, t) {
  const m = resolveMotor(motor);
  if (!Number.isFinite(t)) throw new RangeError('El tiempo debe ser finito.');
  const u = clamp(t / m.burnTime, 0, 1);
  let area = 0;
  for (let i = 1; i < CURVE.length && u > CURVE[i - 1][0]; i++) {
    const [a, fa] = CURVE[i - 1];
    const [b, fb] = CURVE[i];
    const end = Math.min(u, b);
    const fend = fa + (fb - fa) * (end - a) / (b - a);
    area += (end - a) * (fa + fend) / 2;
  }
  return m.impulse * area / CURVE_AREA;
}

function validatedConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('La configuración debe ser un objeto.');
  const mode = input.mode ?? 'estes';
  if (!(mode === 'estes' || mode === 'water')) throw new RangeError('El modo debe ser estes o water.');
  const config = { ...DEFAULTS[mode], ...input, mode };
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    if (typeof config[key] !== 'number' || !Number.isFinite(config[key]) || config[key] < low || config[key] > high) {
      throw new RangeError(`${key}: introduce un número entre ${low} y ${high}.`);
    }
  }
  if (typeof config.parachute !== 'boolean') throw new TypeError('parachute debe ser verdadero o falso.');
  resolveMotor(config.motorId);
  return config;
}

/**
 * Simula desde liberación/ignición hasta el suelo (o 240 s).
 * dryMass: kg SIN motor ni agua; diameter/chuteDiameter/railLength: m;
 * bottleVolume: L; waterFill: %; pressure: bar manométrica; nozzleDiameter: mm.
 * El ángulo se mide desde vertical. Viento firmado sobre el eje x.
 * acceleration es la magnitud de la aceleración neta en m/s², no carga en g.
 */
export function simulate(input = {}) {
  const config = validatedConfig(input);
  const motor = resolveMotor(config.motorId);
  const isWater = config.mode === 'water';
  const warnings = [];
  const events = [];
  const samples = [];
  const event = (type, t, label) => events.push({ type, t, label });
  const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
  const radians = config.angle * Math.PI / 180;
  const direction = { x: Math.sin(radians), y: Math.cos(radians) };
  const bodyArea = Math.PI * config.diameter ** 2 / 4;
  const chuteArea = Math.PI * config.chuteDiameter ** 2 / 4;
  const bottleVolume = config.bottleVolume / 1000;
  const initialWater = WATER_DENSITY * bottleVolume * config.waterFill / 100;
  const initialAirVolume = bottleVolume - initialWater / WATER_DENSITY;
  const initialPressure = AMBIENT_PRESSURE + config.pressure * 1e5;
  const airMass = initialPressure * initialAirVolume / (287.05 * 288.15);
  const nozzleArea = Math.PI * (config.nozzleDiameter / 1000) ** 2 / 4;
  // Agua residual al igualarse las presiones (puede ser > 0).
  const residualWater = Math.max(0, WATER_DENSITY * (bottleVolume - initialAirVolume * (initialPressure / AMBIENT_PRESSURE) ** (1 / GAMMA)));
  let state = { x: 0, y: 0, vx: 0, vy: 0, water: initialWater };
  let t = 0;
  let rail = true;
  let lifted = false;
  let apogeeSeen = false;
  let deployedAt = null;
  let burnoutAt = isWater ? null : motor.burnTime;
  let burnoutSeen = false;
  let finished = false;
  let impulse = 0;
  let nextSample = 0;
  let apogee = 0;
  let timeToApogee = 0;
  let maxSpeed = 0;
  let maxAcceleration = 0;
  let railSpeed = 0;
  let steps = 0;

  function propulsion(at, s) {
    if (!isWater) {
      const spent = motor.propellantMass * motorImpulse(motor, at) / motor.impulse;
      return { thrust: motorThrust(motor, at), mass: config.dryMass + motor.mass - spent, flow: 0 };
    }
    const water = clamp(s.water, residualWater, initialWater);
    const airVolume = bottleVolume - water / WATER_DENSITY;
    const pressure = initialPressure * (initialAirVolume / airVolume) ** GAMMA;
    const delta = Math.max(0, pressure - AMBIENT_PRESSURE);
    const available = !burnoutSeen && water > residualWater + 1e-9 && config.pressure > 0;
    const exhaustSpeed = available ? Math.sqrt(2 * delta / WATER_DENSITY) : 0;
    // Coeficiente de descarga fijo: supuesto de modelado, no medición de tobera.
    const flow = 0.85 * WATER_DENSITY * nozzleArea * exhaustSpeed;
    return { thrust: flow * exhaustSpeed, mass: config.dryMass + airMass + water, flow };
  }

  function forces(at, s) {
    const prop = propulsion(at, s);
    const rho = 1.225 * Math.exp(-Math.max(0, s.y) / 8500);
    const relativeX = s.vx - config.wind;
    const relativeY = s.vy;
    const relativeSpeed = Math.hypot(relativeX, relativeY);
    // Inflado gradual de 0.4 s evita una discontinuidad de resistencia idealizada.
    const inflation = deployedAt === null ? 0 : clamp((at - deployedAt) / 0.4, 0, 1);
    const dragArea = config.cd * bodyArea + config.chuteCd * chuteArea * inflation;
    const dragFactor = 0.5 * rho * dragArea * relativeSpeed;
    // El área puede crecer dentro del siguiente paso aunque inflation sea 0.
    // Desde la apertura, el límite de estabilidad anticipa el área completa.
    const potentialDragArea = config.cd * bodyArea + (deployedAt === null ? 0 : config.chuteCd * chuteArea);
    const dragLimitFactor = 0.5 * rho * potentialDragArea * relativeSpeed;
    let ax = (prop.thrust * direction.x - dragFactor * relativeX) / prop.mass;
    let ay = (prop.thrust * direction.y - dragFactor * relativeY) / prop.mass - G;
    let dx = s.vx;
    let dy = s.vy;
    if (rail) {
      const distance = s.x * direction.x + s.y * direction.y;
      let speed = s.vx * direction.x + s.vy * direction.y;
      let acceleration = ax * direction.x + ay * direction.y;
      if (distance <= 1e-12 && speed <= 0 && acceleration <= 0) { speed = 0; acceleration = 0; }
      dx = speed * direction.x;
      dy = speed * direction.y;
      ax = acceleration * direction.x;
      ay = acceleration * direction.y;
    }
    return { ...prop, dx, dy, ax, ay, dragFactor, dragLimitFactor };
  }

  function phase(s, at) {
    if (finished && s.y <= 0) return lifted ? 'landed' : 'pad';
    if (!lifted) return 'pad';
    if (deployedAt !== null && at >= deployedAt) return 'recovery';
    if (!burnoutSeen) return 'boost';
    return s.vy >= 0 ? 'coast' : 'descent';
  }

  function record(at, s) {
    const f = forces(at, s);
    const sample = { t: at, x: s.x, y: Math.max(0, s.y), vx: s.vx, vy: s.vy, speed: Math.hypot(s.vx, s.vy), acceleration: finished && s.y <= 0 ? 0 : Math.hypot(f.ax, f.ay), thrust: f.thrust, mass: f.mass, phase: phase(s, at) };
    if (samples.length && Math.abs(samples.at(-1).t - at) < 1e-10) samples[samples.length - 1] = sample;
    else samples.push(sample);
  }

  function deploy(at, label) {
    deployedAt = at;
    event('deployment', at, label);
    if (!isWater && state.vy < 0) warn('La expulsión del motor ocurre durante el descenso; revisa el retardo con un modelo validado.');
    if (!isWater && state.vy > 5) warn('La expulsión del motor ocurre durante el ascenso; la apertura se idealiza y no calcula cargas estructurales.');
  }

  event('ignition', 0, isWater ? 'Liberación simulada' : 'Ignición simulada');
  const initialMass = propulsion(0, state).mass;
  if (isWater) {
    warn('Hidrocohete: se calcula sólo la expulsión de agua con expansión adiabática; se omite el empuje posterior del aire.');
    if (config.pressure === 0 || initialWater === 0) {
      warn(config.pressure === 0 ? 'Sin presión manométrica no hay empuje en este modelo.' : 'Sin agua no hay empuje en este modelo; la propulsión sólo con aire no está implementada.');
    }
  } else {
    warn('Los perfiles Estes son aproximaciones normalizadas al impulso de catálogo, no curvas de ensayo.');
    if (initialMass > motor.maxLiftMass) warn('La masa inicial supera la masa máxima de despegue indicada por Estes para este motor.');
    if (config.diameter < motor.diameter) warn('El diámetro exterior configurado es menor que el diámetro del motor elegido.');
  }
  if (!config.parachute) warn('Recuperación desactivada: se representa una trayectoria balística hasta el suelo.');
  record(t, state);

  while (t < MAX_TIME && steps++ < LIMIT_STEPS && !finished) {
    let start = forces(t, state);
    if (isWater && !burnoutSeen && (start.flow <= 1e-7 || state.water <= residualWater + 1e-8)) {
      burnoutSeen = true;
      burnoutAt = t;
      event('burnout', t, 'Fin del empuje de agua');
      if (state.water > 0.001) warn('La presión se iguala con el ambiente antes de expulsar toda el agua.');
      // El cambio de fase anula el caudal desde este mismo paso. El residuo
      // numérico no puede reactivar el empuje ni limitar el paso de inercia.
      start = forces(t, state);
    } else if (!isWater && !burnoutSeen && t >= motor.burnTime - 1e-9) {
      burnoutSeen = true;
      event('burnout', motor.burnTime, 'Fin del impulso');
    }
    if (burnoutSeen && !lifted) {
      event('no-liftoff', t, 'Sin despegue');
      warn('La configuración no logra despegar en el modelo.');
      finished = true;
      break;
    }
    if (!isWater && config.parachute && deployedAt === null && t >= motor.burnTime + motor.delay - 1e-9 && state.y > 0) {
      deploy(motor.burnTime + motor.delay, 'Expulsión y apertura');
      start = forces(t, state);
      record(t, state);
    }

    let dt = burnoutSeen ? 0.01 : 0.0025;
    if (start.dragLimitFactor > 0) dt = Math.min(dt, 0.15 * start.mass / start.dragLimitFactor);
    // Sin piso artificial: el punto medio debe conservar agua disponible.
    // Con un piso, el estado intermedio podía agotarla, obtener caudal cero
    // y conservar indefinidamente el agua del estado inicial de ese paso.
    if (isWater && start.flow > 0) dt = Math.min(dt, (state.water - residualWater) / start.flow * 0.2);
    if (!isWater) {
      for (const boundary of [motor.burnTime, motor.burnTime + motor.delay]) {
        if (boundary > t + 1e-9) dt = Math.min(dt, boundary - t);
      }
    }
    dt = Math.min(dt, MAX_TIME - t);
    if (!(dt > 0) || t + dt === t) break;
    const mid = {
      x: state.x + start.dx * dt / 2, y: state.y + start.dy * dt / 2,
      vx: state.vx + start.ax * dt / 2, vy: state.vy + start.ay * dt / 2,
      water: Math.max(residualWater, state.water - start.flow * dt / 2),
    };
    const middle = forces(t + dt / 2, mid);
    let next = {
      x: state.x + middle.dx * dt, y: state.y + middle.dy * dt,
      vx: state.vx + middle.ax * dt, vy: state.vy + middle.ay * dt,
      water: Math.max(residualWater, state.water - middle.flow * dt),
    };
    let nextTime = t + dt;
    if (rail && next.y < 0 && !lifted) next = { ...next, x: 0, y: 0, vx: 0, vy: 0 };
    if (!lifted && next.y > 1e-6) { lifted = true; event('liftoff', nextTime, 'Despegue'); }
    if (rail && Math.hypot(next.x, next.y) >= config.railLength) {
      rail = false;
      railSpeed = Math.hypot(next.vx, next.vy);
      event('rail-exit', nextTime, 'Salida de guía');
      if (railSpeed < 10) warn('Salida de guía inferior a 10 m/s: señal diagnóstica, no criterio de estabilidad ni autorización de lanzamiento.');
    }
    if (lifted && !apogeeSeen && state.vy > 0 && next.vy <= 0) {
      const fraction = state.vy / (state.vy - next.vy);
      timeToApogee = t + dt * fraction;
      apogeeSeen = true;
      event('apogee', timeToApogee, 'Apogeo');
      if (isWater && config.parachute) deploy(nextTime, 'Apertura ideal en apogeo');
    }
    if (lifted && next.y <= 0 && next.vy < 0) {
      const fraction = clamp(state.y / (state.y - next.y), 0, 1);
      nextTime = t + dt * fraction;
      next = { x: state.x + (next.x - state.x) * fraction, y: 0, vx: state.vx + (next.vx - state.vx) * fraction, vy: state.vy + (next.vy - state.vy) * fraction, water: state.water + (next.water - state.water) * fraction };
      finished = true;
      event('landing', nextTime, 'Contacto con el suelo');
      if (!isWater && config.parachute && deployedAt === null) warn('El contacto con el suelo ocurre antes de la expulsión del motor.');
    }
    impulse += middle.thrust * (nextTime - t);
    state = next;
    t = nextTime;
    if (state.y > apogee) { apogee = state.y; if (!apogeeSeen) timeToApogee = t; }
    maxSpeed = Math.max(maxSpeed, Math.hypot(state.vx, state.vy));
    maxAcceleration = Math.max(maxAcceleration, Math.hypot(middle.ax, middle.ay));
    if (t >= nextSample - 1e-9 || finished) {
      record(t, state);
      nextSample = t + (burnoutSeen ? 0.04 : 0.01);
    }
  }

  if (!finished) {
    event('timeout', t, 'Límite de simulación');
    warn('Se alcanzó el límite numérico o de 240 s; la duración y deriva son parciales.');
  }
  if (lifted && rail) warn('El modelo no alcanza el extremo de la guía.');
  record(t, state);
  events.sort((a, b) => a.t - b.t);
  return {
    config, samples, events, warnings,
    summary: { apogee, maxSpeed, maxAcceleration, flightTime: t, drift: state.x, burnTime: burnoutAt ?? t, railSpeed, timeToApogee, landingSpeed: finished && lifted ? Math.hypot(state.vx, state.vy) : 0, initialMass, finalMass: propulsion(t, state).mass, impulse, landed: finished && lifted },
  };
}
