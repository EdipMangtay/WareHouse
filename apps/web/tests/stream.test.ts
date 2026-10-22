import {afterEach, expect, it, vi} from 'vitest';
import {layout, useStore} from '../src/state/store';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('coalesces rapid snapshots without losing task changes or controller fields', async()=>{
  vi.useFakeTimers();
  vi.stubGlobal('location',{hostname:'localhost'});
  vi.stubGlobal('window',globalThis);
  vi.stubGlobal('document',{addEventListener:vi.fn(),removeEventListener:vi.fn()});
  let connection: any;
  class Socket {
    static OPEN=1; readyState=1; onmessage: any; onclose: any;
    constructor(){connection=this;} send(){} close(){}
  }
  vi.stubGlobal('WebSocket',Socket);
  const {wsConnect,wsDisconnect}=await import('../src/services/ws');
  wsConnect(()=>{});
  vi.advanceTimersByTime(0); // Opening is deferred so StrictMode can cancel its first mount.
  const initial=structuredClone(useStore.getState().twin);
  initial.sim.tick=0;
  initial.conveyor_system={routing_table:{'IND-A>PACK-01':['IND-A']}} as any;
  connection.onmessage({data:JSON.stringify({type:'FULL',layout_revision:layout.revision,state:initial})});
  let publishes=0;
  const stop=useStore.subscribe((s,p)=>{if(s.twin!==p.twin)publishes++;});
  for(let tick=1;tick<=100;tick++){
    connection.onmessage({data:JSON.stringify({type:'PATCH',base_tick:tick-1,tick,patch:{sim:{tick},tasks:{['T'+tick]:{id:'T'+tick}},conveyor_system:{metrics:{delivered:tick}}},events:[]})});
    vi.advanceTimersByTime(1);
  }
  const result=useStore.getState().twin;
  expect(result.sim.tick).toBe(100);
  expect(Object.keys(result.tasks)).toHaveLength(100);
  expect(result.conveyor_system?.routing_table).toEqual(initial.conveyor_system.routing_table);
  expect(result.conveyor_system?.metrics.delivered).toBe(100);
  expect(publishes).toBe(2);
  connection.onmessage({data:JSON.stringify({type:'PATCH',base_tick:999,tick:1000,patch:{sim:{tick:1000}},events:[]})});
  connection.onmessage({data:JSON.stringify({type:'PATCH',base_tick:1000,tick:1001,patch:{sim:{tick:1001}},events:[]})});
  vi.advanceTimersByTime(100);
  expect(useStore.getState().twin.sim.tick).toBe(100);
  connection.onmessage({data:JSON.stringify({type:'FULL',layout_revision:layout.revision,state:result})});
  connection.onmessage({data:JSON.stringify({type:'PATCH',base_tick:100,tick:101,patch:{sim:{tick:101}},events:[]})});
  // A disconnect between reception and React publication must not rewind to 100.
  connection.onclose();
  expect(useStore.getState().twin.sim.tick).toBe(101);
  stop();wsDisconnect();
});

it('cancels the StrictMode mount and closes/reopens transport on network loss', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { hostname: 'localhost' });
  vi.stubGlobal('navigator', { onLine: true });
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('window', { setTimeout, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1; static CONNECTING = 0; readyState = 1;
    onmessage: unknown; onclose: unknown; onopen: unknown;
    closed = false;
    constructor() { sockets.push(this); }
    send() {} close() { this.closed = true; }
  }
  vi.stubGlobal('WebSocket', Socket);
  const { wsConnect, wsDisconnect } = await import('../src/services/ws');
  const changes = vi.fn();
  wsConnect(changes); wsDisconnect(); vi.advanceTimersByTime(0);
  expect(sockets).toHaveLength(0);
  wsConnect(changes); vi.advanceTimersByTime(0);
  expect(sockets).toHaveLength(1);
  listeners.get('offline')!();
  expect(sockets[0].closed).toBe(true);
  expect(sockets[0].onmessage).toBeNull();
  expect(changes).toHaveBeenLastCalledWith('offline');
  listeners.get('online')!();
  expect(sockets).toHaveLength(2);
  expect(changes).toHaveBeenLastCalledWith('connecting');
  wsDisconnect();
  expect(listeners.size).toBe(0);
});
