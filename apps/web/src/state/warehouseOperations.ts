import { create } from 'zustand';
import type { Order } from '../commerce/api';
export type WarehouseOrder = Omit<Order, 'events' | 'items'> & {
    created_tick: number; elapsed_base: number; simulation_elapsed_seconds: number;
    packing_station: string | null; packing_until_tick: number | null;
    items: (Order['items'][number] & { rack_id: string })[];
    jobs: { task_id: string; package_id?: string; kind: string; source: string; destination: string; quantity: number; done: boolean }[];
    events: { status: string; message: string; at: string; tick?: number }[];
};
export interface WarehouseOperations {
    orders: WarehouseOrder[]; orders_limit: number;
    metrics: { total_orders: number; active_orders: number; ready_orders: number; avg_preparation_seconds: number; packing_busy: number; packing_capacity: number; packing_queue: number; status_counts: Record<string, number> };
}
export const useWarehouseOperations = create<{
    data: WarehouseOperations | null; error: string | null; receivedAt: number | null;
    setData: (data: WarehouseOperations) => void; setError: (error: string) => void;
    developer: boolean; setDeveloper: (v: boolean) => void;
    racksVisible: boolean; toggleRacks: () => void;
    flowVisible: boolean; toggleFlow: () => void;
    gapVisible: boolean; toggleGap: () => void;
    renderStats: { fps: number; calls: number; triangles: number }; setRenderStats: (value: { fps: number; calls: number; triangles: number }) => void;
}>(set => ({ data: null, error: null, receivedAt: null, developer: false, racksVisible: true, flowVisible: true, gapVisible: false, renderStats: { fps: 0, calls: 0, triangles: 0 },
    setData: data => set({ data, error: null, receivedAt: Date.now() }), setError: error => set({ error }),
    setDeveloper: developer => set({ developer }), toggleRacks: () => set(s => ({ racksVisible: !s.racksVisible })), toggleFlow: () => set(s => ({ flowVisible: !s.flowVisible })), toggleGap: () => set(s => ({ gapVisible: !s.gapVisible })), setRenderStats: renderStats => set({ renderStats }),
}));
