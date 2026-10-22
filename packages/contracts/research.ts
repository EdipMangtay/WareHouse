/** Wire contract v2. Operation state is authored only by warehouse_core. */
export type Policy = 'fifo' | 'order_aware' | 'gwo_conveyor' | 'local_search' | 'gwo_integrated';
export type ZoneConfig = {
    id: string;
    entry_m: number;
    robots: number;
    buffer_slots: number;
    pick_distance_m: number;
};
export interface ResearchConfig {
    tick_s: number;
    zones: ZoneConfig[];
    robot_speed_mps: number;
    pick_s: number;
    drop_s: number;
    belt_length_m: number;
    belt_speed_mps: number;
    carrier_length_m: number;
    safe_gap_m: number;
    consolidation_slots: number;
    packing_stations: number;
    packing_s: number;
    commitment_s: number;
}
export interface Order {
    id: string;
    arrival_s: number;
    due_s: number;
    item_ids: string[];
    status: string;
    admitted_s: number | null;
    packing_started_s: number | null;
    completed_s: number | null;
    missing_item_ids: string[];
    wait_reason: string | null;
}
export interface Item {
    id: string;
    sku: string;
    order_id: string;
    zone_id: string;
    location: string;
}
export interface Task {
    id: string;
    order_id: string;
    item_id: string;
    zone_id: string;
    status: string;
    robot_id: string | null;
    started_s: number | null;
    ready_s: number | null;
    completed_s: number | null;
}
export interface Robot {
    id: string;
    zone_id: string;
    lane: number;
    state: string;
    task_id: string | null;
    distance_m: number;
    phase_started_s: number;
    position: [
        number,
        number,
        number
    ];
    estimated_ready_s: number | null;
    failed_until_s: number | null;
    jobs_since_charge: number;
}
export interface Carrier {
    id: string;
    item_id: string;
    order_id: string;
    zone_id: string;
    task_id: string;
    state: string;
    position_m: number;
    entered_s: number | null;
    arrived_s: number | null;
}
export interface Reservation {
    task_id: string;
    order_id: string;
    zone_id: string;
    entry_s: number;
    exit_s: number;
    crossings: Record<string, number>;
    committed: boolean;
}
export interface Decision {
    id: string;
    time_s: number;
    policy: Policy;
    trigger: string;
    preparation: string[];
    conveyor: string[];
    cohort: string[];
    evaluations: number;
    score: number | null;
    compute_ms: number;
    fallback: boolean;
    explanation: string;
    robot_rule: string;
    commitment_s: number;
    budget: number;
    time_limit_ms: number | null;
    candidates: {
        evaluation: number;
        score: number | null;
        feasible: boolean;
        open_orders: number;
        preparation: string[];
        conveyor: string[];
    }[];
}
export interface Metrics {
    time_s: number;
    arrived_orders: number;
    completed_orders: number;
    open_orders: number;
    open_order_ids: string[];
    mean_completion_s: number | null;
    p95_completion_s: number | null;
    late_completed_ratio: number | null;
    overdue_open_orders: number;
    mean_open_age_s: number;
    mean_task_queue: number;
    mean_packing_queue: number;
    mean_local_occupancy: number;
    mean_consolidation_reserved: number;
    max_consolidation_reserved: number;
    max_local_claims: Record<string, number>;
    reservation_misses: number;
    reservation_revisions: number;
    decisions: number;
    mean_decision_ms: number;
    p95_decision_ms: number | null;
    evaluations: number;
}
export interface ResearchSnapshot {
    schema_version: '2.0';
    tick: number;
    time_s: number;
    tick_s: number;
    policy: Policy;
    scenario: string;
    scenario_seed: number;
    algorithm_seed: number;
    config: ResearchConfig;
    orders: Order[];
    items: Item[];
    tasks: Task[];
    robots: Robot[];
    carriers: Carrier[];
    packages: {
        id: string;
        order_id: string;
        item_ids: string[];
        completed_s: number;
    }[];
    packing: {
        id: string;
        order_id: string | null;
        remaining_s: number;
        failed_until_s: number | null;
    }[];
    zones: {
        id: string;
        queued: number;
        local_claims: number;
        buffer_occupancy: number;
        buffer_slots: number;
        robot_ids: string[];
        ready_estimates: Record<string, number>;
    }[];
    belt: {
        stopped: boolean;
        restore_at_s: number | null;
    };
    consolidation: {
        reserved_slots: number;
        capacity_slots: number;
        orders: Record<string, number>;
    };
    reservations: Reservation[];
    events: ({
        seq: number;
        time_s: number;
        kind: string;
    } & Record<string, unknown>)[];
    decisions: Decision[];
    metrics: Metrics;
    finished: boolean;
}
export interface SessionFrame {
    type: 'SNAPSHOT';
    session_id: string;
    revision: number;
    generation: number;
    paused: boolean;
    speed: number;
    error: string | null;
    state: ResearchSnapshot;
}
export type CommandPayload = {
    action: 'PLAY';
    speed: number;
} | {
    action: 'PAUSE';
} | {
    action: 'STEP';
    ticks: number;
} | {
    action: 'RESET';
} | {
    action: 'SET_POLICY';
    policy: Policy;
} | {
    action: 'INJECT';
    kind: 'BELT_STOP' | 'ROBOT_FAILURE' | 'PACKING_FAILURE';
    target?: string;
    duration_s: number;
} | {
    action: 'ADD_ORDER';
    order_id: string;
    zones: string[];
    due_after_s: number;
};
export type ResearchCommand = CommandPayload & {
    command_id: string;
};
export interface CreateSession {
    scenario: string;
    scenario_seed: number;
    algorithm_seed: number;
    policy: Policy;
    search_budget: number;
    time_limit_ms?: number;
}
