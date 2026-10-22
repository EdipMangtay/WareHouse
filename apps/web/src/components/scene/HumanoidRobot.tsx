import type { MutableRefObject } from "react";
import { HumanoidRobot as Model, type HumanoidMotion } from "../../assets/models/HumanoidRobot";
import type { RobotState } from "../../schema/twin_state";
import { useStore } from "../../state/store";
export type { HumanoidMotion } from "../../assets/models/HumanoidRobot";
/** Adapter from the preserved navigation snapshot to the shared visual asset. */
export function HumanoidRobot(props: {r: RobotState; motion: MutableRefObject<HumanoidMotion>; lite?: boolean; preview?: boolean}) {
  const sim = useStore(s => s.twin.sim);
  return <Model {...props} simulationTimeS={sim.tick*sim.tick_ms/1000} phaseStartedS={props.r.fsm_since_tick*sim.tick_ms/1000}/>;
}
