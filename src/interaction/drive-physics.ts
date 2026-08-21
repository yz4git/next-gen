export interface DrivePhysicsState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steering: number;
}

export interface DrivePhysicsInput {
  throttle: number;
  steering: number;
  brake: boolean;
}

export interface DrivePhysicsTuning {
  maximumForwardSpeed: number;
  maximumReverseSpeed: number;
  forwardAcceleration: number;
  reverseAcceleration: number;
  brakeDeceleration: number;
  rollingDrag: number;
  steeringRate: number;
}

/**
 * WorldSeed's Drive controls intentionally use an inverted steering feel:
 * positive pad/right input turns the vehicle toward negative heading and
 * negative pad/left input turns it toward positive heading.
 */
export const DRIVE_STEERING_POLARITY = -1;

export const DEFAULT_DRIVE_TUNING: DrivePhysicsTuning = {
  maximumForwardSpeed: 34,
  maximumReverseSpeed: 10,
  forwardAcceleration: 15,
  reverseAcceleration: 8,
  brakeDeceleration: 24,
  rollingDrag: 1.35,
  steeringRate: 1.65,
};

export function stepDrivePhysics(
  state: DrivePhysicsState,
  input: DrivePhysicsInput,
  delta: number,
  tuning: DrivePhysicsTuning = DEFAULT_DRIVE_TUNING,
): DrivePhysicsState {
  const dt = Math.max(0, Math.min(0.05, delta));
  const throttle = clamp(input.throttle, -1, 1);
  const steeringTarget = clamp(input.steering, -1, 1);
  const steeringResponse = 1 - Math.exp(-dt * 11);
  const steering = state.steering + (steeringTarget - state.steering) * steeringResponse;
  let speed = state.speed;

  if (input.brake) {
    // The brake pedal doubles as reverse: keep braking while moving forward,
    // then continue holding it to ease the car backwards from a full stop.
    if (speed > 0) speed = approach(speed, 0, tuning.brakeDeceleration * dt);
    else speed -= tuning.reverseAcceleration * 0.9 * dt;
  } else if (throttle > 0) {
    speed += throttle * tuning.forwardAcceleration * dt;
  } else if (throttle < 0) {
    if (speed > 0.8) speed = approach(speed, 0, tuning.brakeDeceleration * 0.72 * dt);
    else speed += throttle * tuning.reverseAcceleration * dt;
  } else {
    const drag = tuning.rollingDrag + Math.abs(speed) * 0.055;
    speed = approach(speed, 0, drag * dt);
  }

  speed = clamp(speed, -tuning.maximumReverseSpeed, tuning.maximumForwardSpeed);
  const speedRatio = clamp(Math.abs(speed) / 7.5, 0.16, 1);
  const direction = speed < -0.05 ? -1 : 1;
  const heading = normalizeAngle(
    state.heading + steering * tuning.steeringRate * speedRatio * direction * DRIVE_STEERING_POLARITY * dt,
  );
  return {
    x: state.x + Math.sin(heading) * speed * dt,
    z: state.z + Math.cos(heading) * speed * dt,
    heading,
    speed,
    steering,
  };
}

function approach(value: number, target: number, amount: number): number {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
