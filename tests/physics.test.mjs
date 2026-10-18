import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, MOTORS, DEFAULTS, motorThrust, motorImpulse } from '../dist/physics.js';

function verifyFiniteFlight(result) {
  assert.ok(result.samples.length > 0);
  assert.ok(result.samples.length < 25000);
  let previousTime = -1;
  let previousMass = Infinity;
  for (const sample of result.samples) {
    for (const key of ['t', 'x', 'y', 'vx', 'vy', 'speed', 'acceleration', 'thrust', 'mass']) {
      assert.ok(Number.isFinite(sample[key]), `${key} must be finite`);
    }
    assert.ok(sample.t > previousTime, 'sample time increases');
    assert.ok(sample.y >= 0, 'ground is a boundary');
    assert.ok(sample.mass > 0);
    assert.ok(sample.mass <= previousMass + 1e-9, 'mass cannot increase');
    previousTime = sample.t;
    previousMass = sample.mass;
  }
  for (const value of Object.values(result.summary)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
  assert.ok(result.summary.flightTime <= 240);
  assert.equal(result.samples.at(-1).t, result.summary.flightTime);
  assert.ok(result.events.every((e, i, events) => i === 0 || events[i - 1].t <= e.t));
}

test('each synthetic motor curve integrates to its declared impulse', () => {
  for (const motor of MOTORS) {
    const dt = motor.burnTime / 10000;
    let integral = 0;
    for (let i = 0; i < 10000; i++) integral += motorThrust(motor, (i + 0.5) * dt) * dt;
    assert.ok(Math.abs(integral - motor.impulse) < 1e-7);
    assert.equal(motorThrust(motor, -1), 0);
    assert.equal(motorThrust(motor, motor.burnTime), 0);
    assert.ok(Math.abs(motorImpulse(motor, 100) - motor.impulse) < 1e-12);
    assert.equal(motorImpulse(motor, 0), 0);
  }
});

test('motor mass is added once and propellant is exhausted at burnout', () => {
  for (const motor of MOTORS) {
    const result = simulate({ motorId: motor.id, dryMass: 0.045, parachute: false, wind: 0, angle: 0 });
    verifyFiniteFlight(result);
    assert.ok(Math.abs(result.summary.initialMass - (0.045 + motor.mass)) < 1e-12);
    assert.ok(Math.abs(result.summary.finalMass - (0.045 + motor.mass - motor.propellantMass)) < 1e-12);
    assert.ok(Math.abs(result.summary.impulse - motor.impulse) < 0.002);
    assert.equal(result.summary.burnTime, motor.burnTime);
    assert.equal(result.samples.at(-1).y, 0);
  }
});

test('water defaults conserve remaining dry and air mass and land', () => {
  const result = simulate(DEFAULTS.water);
  verifyFiniteFlight(result);
  assert.ok(result.summary.apogee > 1 && result.summary.apogee < 200);
  assert.ok(Math.abs(result.summary.initialMass - result.summary.finalMass - 0.7) < 1e-7);
  assert.ok(result.summary.finalMass > DEFAULTS.water.dryMass, 'air has positive mass');
  assert.ok(result.summary.burnTime > 0 && result.summary.burnTime < 3);
  assert.equal(result.summary.landed, true);
  assert.equal(result.samples.at(-1).phase, 'landed');
});

test('water depletion finishes without stalling for 25, 30, 40 and 50 percent fill', () => {
  for (const waterFill of [25, 30, 40, 50]) {
    const result = simulate({ mode: 'water', waterFill });
    verifyFiniteFlight(result);
    assert.equal(result.summary.landed, true, `fill ${waterFill}% lands`);
    assert.equal(result.samples.at(-1).y, 0);
    assert.ok(!result.events.some(event => event.type === 'timeout'));
    const burnouts = result.events.filter(event => event.type === 'burnout');
    assert.equal(burnouts.length, 1);
    assert.ok(burnouts[0].t > 0 && burnouts[0].t < 3);
    assert.ok(result.samples.filter(sample => sample.t > burnouts[0].t).every(sample => sample.thrust === 0), 'burnout cannot restart water thrust');
    assert.ok(Math.abs(result.summary.initialMass - result.summary.finalMass - 2 * waterFill / 100) < 1e-7);
  }
});

test('100 ordinary water configurations finish the burn and land without numerical timeout', () => {
  for (let i = 0; i < 100; i++) {
    const result = simulate({
      mode: 'water', waterFill: 15 + (i % 10) * 5,
      bottleVolume: 1.25 + Math.floor(i / 10) * 0.15,
      pressure: 3.5 + (i % 7) * 0.35, nozzleDiameter: 8 + (i % 11) * 0.5,
      dryMass: 0.12 + (i % 9) * 0.015, diameter: 0.09 + (i % 6) * 0.003,
      chuteDiameter: 0.35 + (i % 8) * 0.03, wind: (i % 9) - 4, angle: i % 10,
    });
    verifyFiniteFlight(result);
    assert.equal(result.summary.landed, true, `configuration ${i} lands`);
    assert.equal(result.events.filter(event => event.type === 'burnout').length, 1);
    assert.ok(!result.events.some(event => event.type === 'timeout'), `configuration ${i} does not time out`);
    assert.equal(result.samples.at(-1).phase, 'landed');
  }
});

test('zero gauge pressure cannot launch and does not expel water', () => {
  const result = simulate({ mode: 'water', pressure: 0, angle: 20, wind: 20 });
  verifyFiniteFlight(result);
  assert.equal(result.summary.apogee, 0);
  assert.equal(result.summary.maxSpeed, 0);
  assert.equal(result.summary.drift, 0);
  assert.equal(result.summary.burnTime, 0);
  assert.equal(result.summary.initialMass, result.summary.finalMass);
  assert.equal(result.summary.landed, false);
  assert.ok(result.events.some(event => event.type === 'no-liftoff'));
});

test('empty water tank explicitly does not simulate an air rocket', () => {
  const result = simulate({ mode: 'water', waterFill: 0 });
  verifyFiniteFlight(result);
  assert.equal(result.summary.apogee, 0);
  assert.equal(result.summary.impulse, 0);
  assert.ok(result.warnings.some(warning => warning.includes('sólo con aire')));
});

test('a heavy rocket remains on its launch support', () => {
  const result = simulate({ motorId: 'A8-3', dryMass: 5, angle: 20, wind: 20 });
  verifyFiniteFlight(result);
  assert.equal(result.summary.apogee, 0);
  assert.equal(result.summary.drift, 0);
  assert.equal(result.summary.railSpeed, 0);
  assert.ok(result.warnings.some(warning => warning.includes('no logra despegar')));
});

test('vertical launch has no lateral motion without wind', () => {
  for (const mode of ['estes', 'water']) {
    const result = simulate({ mode, angle: 0, wind: 0 });
    verifyFiniteFlight(result);
    assert.ok(result.samples.every(sample => sample.x === 0 && sample.vx === 0));
    assert.equal(result.summary.drift, 0);
  }
});

test('launch guide constrains direction before rail exit', () => {
  const result = simulate({ mode: 'estes', angle: 15, wind: -10, railLength: 3, parachute: false });
  const exit = result.events.find(event => event.type === 'rail-exit');
  assert.ok(exit && result.summary.railSpeed > 0);
  const tangent = Math.tan(15 * Math.PI / 180);
  for (const sample of result.samples.filter(sample => sample.t < exit.t)) {
    assert.ok(Math.abs(sample.x - sample.y * tangent) < 1e-9);
  }
});

test('Estes recovery follows burnout plus motor delay; water recovery follows apogee', () => {
  const solid = simulate({ motorId: 'B6-4', dryMass: 0.045, wind: 0, angle: 0 });
  assert.equal(solid.events.find(event => event.type === 'deployment').t, 4.8);
  const water = simulate(DEFAULTS.water);
  const apogee = water.events.find(event => event.type === 'apogee');
  const deployment = water.events.find(event => event.type === 'deployment');
  assert.ok(Math.abs(deployment.t - apogee.t) <= 0.011);
  const ballistic = simulate({ ...DEFAULTS.water, parachute: false });
  assert.ok(water.summary.flightTime > ballistic.summary.flightTime);
  assert.ok(water.summary.landingSpeed < ballistic.summary.landingSpeed / 2);
  assert.ok(!ballistic.events.some(event => event.type === 'deployment'));
});

test('a large parachute cannot create energy or reverse high upward velocity in its first step', () => {
  for (const diameter of [0.024, 0.01]) {
    const result = simulate({ motorId: 'D12-5', dryMass: 0.005, diameter, cd: 0.05, chuteDiameter: 2, angle: 0, wind: 0 });
    verifyFiniteFlight(result);
    const deployment = result.events.find(event => event.type === 'deployment');
    assert.ok(deployment);
    const firstAfterOpening = result.samples.find(sample => sample.t > deployment.t + 1e-9);
    assert.ok(firstAfterOpening.t - deployment.t < 0.02);
    assert.ok(firstAfterOpening.vy > 0, 'opening decelerates the ascending rocket without a numerical velocity reversal');
    let previousEnergy = Infinity;
    for (const sample of result.samples.filter(sample => sample.t >= result.summary.burnTime)) {
      // After burnout mass is constant. With zero wind, only gravity and
      // dissipative drag remain: kinetic + gravitational energy cannot grow.
      const energy = sample.mass * (0.5 * sample.speed ** 2 + 9.80665 * sample.y);
      assert.ok(energy <= previousEnergy + 1e-6, `diameter ${diameter}, t=${sample.t}: drag must not add energy`);
      previousEnergy = energy;
    }
    const speedBeforeOpening = Math.max(...result.samples.filter(sample => sample.t <= deployment.t).map(sample => sample.speed));
    assert.ok(result.samples.filter(sample => sample.t > deployment.t).every(sample => sample.speed <= speedBeforeOpening));
  }
});

test('higher body drag reduces ballistic apogee', () => {
  const config = { mode: 'estes', wind: 0, angle: 0, parachute: false };
  const low = simulate({ ...config, cd: 0.2 });
  const high = simulate({ ...config, cd: 1.2 });
  assert.ok(high.summary.apogee < low.summary.apogee);
});

test('late recovery is identified and recovery after ground contact is not fabricated', () => {
  const late = simulate({ motorId: 'A8-3', dryMass: 0.06, wind: 0, angle: 0 });
  assert.ok(late.events.find(event => event.type === 'apogee').t < late.events.find(event => event.type === 'deployment').t);
  assert.ok(late.warnings.some(warning => warning.includes('durante el descenso')));
  const tooLate = simulate({ motorId: 'A8-3', dryMass: 0.12, wind: 0, angle: 0 });
  assert.ok(!tooLate.events.some(event => event.type === 'deployment'));
  assert.ok(tooLate.warnings.some(warning => warning.includes('antes de la expulsión')));
});

test('pressure equilibration can retain water instead of inventing further thrust', () => {
  const result = simulate({ mode: 'water', pressure: 0.2, waterFill: 90 });
  verifyFiniteFlight(result);
  assert.ok(result.summary.initialMass > result.summary.finalMass);
  assert.ok(result.summary.finalMass > result.config.dryMass + 1);
  assert.ok(result.warnings.some(warning => warning.includes('antes de expulsar toda el agua')));
});

test('horizontal wind direction is symmetric for vertical launches', () => {
  const east = simulate({ mode: 'water', angle: 0, wind: 3 });
  const west = simulate({ mode: 'water', angle: 0, wind: -3 });
  assert.ok(east.summary.drift > 0 && west.summary.drift < 0);
  assert.ok(Math.abs(east.summary.drift + west.summary.drift) < 1e-8);
  assert.ok(Math.abs(east.summary.apogee - west.summary.apogee) < 1e-8);
});

test('representative parameter boundaries stay finite and terminate', () => {
  const configurations = [
    { mode: 'water', pressure: 8, bottleVolume: 5, waterFill: 90, nozzleDiameter: 30, dryMass: 0.005, diameter: 0.01, chuteDiameter: 2, wind: 20, angle: 20 },
    { mode: 'water', pressure: 0.01, waterFill: 90, nozzleDiameter: 2, dryMass: 5 },
    { mode: 'water', pressure: 8, bottleVolume: 0.25, waterFill: 1, nozzleDiameter: 30, parachute: false },
    { mode: 'estes', motorId: 'D12-5', dryMass: 0.005, diameter: 0.01, cd: 0.05, chuteDiameter: 2, wind: -20 },
    { mode: 'estes', motorId: 'A8-3', dryMass: 0.15, diameter: 0.4, cd: 2, parachute: false },
  ];
  for (const config of configurations) verifyFiniteFlight(simulate(config));
});

test('invalid values fail clearly and input and defaults remain unmodified', () => {
  for (const patch of [
    { dryMass: NaN }, { dryMass: 0 }, { dryMass: '0.045' }, { wind: Infinity },
    { diameter: -0.1 }, { pressure: 9 }, { waterFill: 100 }, { mode: 'nuclear' },
    { motorId: 'unknown' }, { angle: 21 }, { parachute: 'yes' },
  ]) assert.throws(() => simulate(patch), /número|modo|motor|parachute/);
  assert.throws(() => simulate(null), TypeError);
  const input = { mode: 'water', wind: 0 };
  const before = JSON.stringify(input);
  const defaults = JSON.stringify(DEFAULTS);
  simulate(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(DEFAULTS), defaults);
});
