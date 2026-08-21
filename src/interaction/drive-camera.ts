export interface DriveCameraPoint {
  x: number;
  y: number;
  z: number;
}

export interface DriveCameraPose {
  desired: DriveCameraPoint;
  target: DriveCameraPoint;
}

/**
 * Build a chase-camera pose that follows the terrain under the camera and the
 * look-ahead point, not only the terrain under the vehicle. This prevents a
 * steep uphill from putting the camera target inside the hillside.
 */
export function resolveDriveCameraPose(
  state: { x: number; z: number; heading: number; speed: number },
  groundHeightAt: (x: number, z: number) => number,
): DriveCameraPose {
  const ground = groundHeightAt(state.x, state.z);
  const forwardX = Math.sin(state.heading);
  const forwardZ = Math.cos(state.heading);
  const speed = Math.abs(state.speed);
  const speedLift = Math.min(2.3, speed * 0.065);
  const chaseDistance = 11.5 + speed * 0.075;

  const desiredX = state.x - forwardX * chaseDistance;
  const desiredZ = state.z - forwardZ * chaseDistance;
  const desiredGround = groundHeightAt(desiredX, desiredZ);
  const desiredY = Math.max(ground + 6.1 + speedLift, desiredGround + 3.2);

  const targetX = state.x + forwardX * 5.5;
  const targetZ = state.z + forwardZ * 5.5;
  const targetGround = groundHeightAt(targetX, targetZ);
  const targetY = Math.max(ground + 1.35, targetGround + 1.35);

  return {
    desired: { x: desiredX, y: desiredY, z: desiredZ },
    target: { x: targetX, y: targetY, z: targetZ },
  };
}

export function safeDriveCameraHeight(
  x: number,
  z: number,
  currentY: number,
  groundHeightAt: (x: number, z: number) => number,
  clearance = 2.2,
): number {
  return Math.max(currentY, groundHeightAt(x, z) + clearance);
}
