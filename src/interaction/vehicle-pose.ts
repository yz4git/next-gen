export interface VehicleGroundPose {
  groundY: number;
  pitch: number;
  roll: number;
  frontY: number;
  rearY: number;
  leftY: number;
  rightY: number;
}

/**
 * Sample four points around the chassis and derive a stable pitch/roll pose.
 * The returned pitch is positive when the road rises in the vehicle's +Z
 * forward direction. Roll is positive when the right side of the car is high.
 */
export function resolveVehicleGroundPose(
  state: { x: number; z: number; heading: number },
  groundHeightAt: (x: number, z: number) => number,
  wheelbase = 3.8,
  track = 2.45,
): VehicleGroundPose {
  const forwardX = Math.sin(state.heading);
  const forwardZ = Math.cos(state.heading);
  const rightX = Math.cos(state.heading);
  const rightZ = -Math.sin(state.heading);
  const halfWheelbase = wheelbase / 2;
  const halfTrack = track / 2;

  const frontY = sampleOffset(state, forwardX * halfWheelbase, forwardZ * halfWheelbase, groundHeightAt);
  const rearY = sampleOffset(state, -forwardX * halfWheelbase, -forwardZ * halfWheelbase, groundHeightAt);
  const rightY = sampleOffset(state, rightX * halfTrack, rightZ * halfTrack, groundHeightAt);
  const leftY = sampleOffset(state, -rightX * halfTrack, -rightZ * halfTrack, groundHeightAt);
  const centerY = groundHeightAt(state.x, state.z);
  const groundY = Math.max(centerY, (frontY + rearY + leftY + rightY) / 4);
  const pitch = clamp(Math.atan2(frontY - rearY, wheelbase), -0.62, 0.62);
  const roll = clamp(Math.atan2(rightY - leftY, track), -0.48, 0.48);

  return { groundY, pitch, roll, frontY, rearY, leftY, rightY };
}

export function smoothVehicleTilt(current: number, target: number, delta: number, response = 7.5): number {
  const amount = 1 - Math.exp(-Math.max(0, delta) * response);
  return current + (target - current) * amount;
}

function sampleOffset(
  state: { x: number; z: number },
  offsetX: number,
  offsetZ: number,
  groundHeightAt: (x: number, z: number) => number,
): number {
  return groundHeightAt(state.x + offsetX, state.z + offsetZ);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
