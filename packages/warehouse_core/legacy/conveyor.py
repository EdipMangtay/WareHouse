"""Deterministic, fixed-tick parcel controller inside SimEngine.

Positions are metres along connected directed segments. Junctions use exclusive
reservations; FIFO accumulation propagates upstream. Rendering never advances it.
"""
from collections import deque, Counter
from math import dist, sqrt, isfinite


class ConveyorController:
    def __init__(self, layout):
        self.layout = layout
        self.segments = {s['id']: s for s in layout['conveyors']}
        self.network = layout.get('conveyor_network')
        self.acceleration = (self.network or {}).get('carrier_acceleration_mps2', .8)
        if not isfinite(self.acceleration) or self.acceleration <= 0:
            raise ValueError('Carrier acceleration must be positive m/s²')
        self.routes = {}
        if self.network:
            for start in self.segments:
                for destination in self.network['unloading_points']:
                    queue = deque([(start, [start])]); seen = set()
                    while queue:
                        sid, path = queue.popleft()
                        if sid in seen: continue
                        seen.add(sid)
                        if self.segments[sid].get('feeds') == destination:
                            self.routes[start+'>'+destination] = path; break
                        queue.extend((n, path+[n]) for n in self.segments[sid]['next'])

    def initialize(self, state):
        for conveyor in state['conveyors'].values():
            conveyor.setdefault('travelled_m', 0.)
        state.setdefault('packages', {})
        state.setdefault('conveyor_system', dict(
            junction_locks={}, induction_owners={}, induction_queues={}, unloading_points={k:dict(v,items=[],reservations={}) for k,v in (self.network or {}).get('unloading_points',{}).items()},
            routing_table=self.routes, induction_points=(self.network or {}).get('induction_points',{}),
            metrics=dict(delivered=0,on_conveyor=0,waiting=0,occupancy=0,throughput_per_min=0,routing_errors=0),
            delivery_ticks=[], zones={}))
        if self.network:
            for sid,s in self.segments.items():
                state['conveyors'][sid].update(items_on_belt=0,throughput_per_min=0,capacity=s['capacity'],length_m=s['length_m'])

    @staticmethod
    def transition(p, status, tick, location):
        p.update(status=status,current_location=location)
        p['timeline'].append(dict(tick=tick,status=status,location=location))

    def register(self, state, task, order_id=None, package_id=None):
        if not self.network: return None
        source=next(l for l in self.layout['locations'] if l['id']==task['source'])
        zone=source['zone']
        induction='IND-'+zone[-1] if zone.startswith('ZONE_') else 'IND-D'
        route=self.routes.get(induction+'>'+task['destination'])
        if route is None: return None
        pid=package_id or 'PKG-'+task['id']
        if pid in state['packages']:
            p=state['packages'][pid]
            if p['status'] in ('ON_CONVEYOR','DELIVERED'): raise ValueError('Cannot reassign an accepted parcel')
            p.update(task_id=task['id'],robot_id=None)
            self.transition(p,'AWAITING_PICKUP',state['sim']['tick'],task['source'])
        else:
            variant=sum(map(ord,pid))%3
            p=dict(package_id=pid,order_id=order_id or 'DEMO-'+task['id'],task_id=task['id'],source_zone=zone,
                destination_station=task['destination'],routing_destination=task['destination'],
                current_location=task['source'],current_conveyor_segment=None,conveyor_position=0.,
                package_dimensions=[.55+variant*.08,.32+variant*.07,.42+variant*.05],status='AWAITING_PICKUP',
                created_at=state['sim']['tick'],loaded_at=None,delivered_at=None,robot_id=None,induction_station=induction,
                route=route,route_index=0,timeline=[],estimated_remaining_s=None)
            self.transition(p,'AWAITING_PICKUP',state['sim']['tick'],task['source'])
            state['packages'][pid]=p
        task['package_id']=pid
        task['handoff_station']=induction
        return p

    def picked(self, state, task, robot):
        pid=task.get('package_id')
        if not pid: return
        p=state['packages'][pid]
        p['robot_id']=robot['id']
        self.transition(p,'ON_ROBOT',state['sim']['tick'],robot['id'])
        robot['payload_package_id']=pid

    def claim_induction(self,state,task,robot):
        system=state['conveyor_system'];sid=task['handoff_station']
        queue=system['induction_queues'].setdefault(sid,[])
        if robot['id'] not in queue: queue.append(robot['id'])
        if not system['induction_owners'].get(sid) and queue[0]==robot['id']:
            system['induction_owners'][sid]=robot['id']
        claimed=system['induction_owners'].get(sid)==robot['id']
        if not claimed:
            p=state['packages'][task['package_id']]
            if p['status']!='WAITING_INDUCTION': self.transition(p,'WAITING_INDUCTION',state['sim']['tick'],robot['id'])
        return claimed

    def release_induction(self,state,task,robot):
        sid=task.get('handoff_station')
        if not sid: return
        system=state['conveyor_system']
        if system['induction_owners'].get(sid)==robot['id']: system['induction_owners'].pop(sid)
        system['induction_queues'][sid]=[rid for rid in system['induction_queues'].get(sid,[]) if rid!=robot['id']]

    def begin_handoff(self,state,task,robot):
        p=state['packages'][task['package_id']]
        if p.get('handoff_started_at') is not None: return True
        sid=p['route'][0]; segment=self.segments[sid]
        peers=[q for q in state['packages'].values() if q['status']=='ON_CONVEYOR' and q['current_conveyor_segment']==sid]
        if state['conveyors'][sid]['status']!='RUNNING' or len(peers)>=segment['capacity'] or any(q['conveyor_position']<segment['pitch_m'] for q in peers):
            if p['status']!='WAITING_INDUCTION': self.transition(p,'WAITING_INDUCTION',state['sim']['tick'],p['induction_station'])
            return False
        p['handoff_started_at']=state['sim']['tick']
        self.transition(p,'LOADING',state['sim']['tick'],p['induction_station'])
        return True

    def accept(self, state, task, robot):
        pid=task.get('package_id')
        if not pid: return True
        p=state['packages'][pid]; tick=state['sim']['tick']
        if p['status'] in ('ON_CONVEYOR','DELIVERED'):
            return robot.get('payload_package_id') is None  # Idempotent acknowledgement.
        if p['robot_id']!=robot['id'] or robot.get('payload_package_id')!=pid: return False
        sid=p['route'][0]; segment=self.segments[sid]
        peers=[q for q in state['packages'].values() if q['status']=='ON_CONVEYOR' and q['current_conveyor_segment']==sid]
        if state['conveyors'][sid]['status']!='RUNNING' or len(peers)>=segment['capacity'] or any(q['conveyor_position']<segment['pitch_m'] for q in peers):
            if p['status']!='WAITING_INDUCTION': self.transition(p,'WAITING_INDUCTION',tick,p['induction_station'])
            return False
        # One transaction in the single engine tick: no intermediate double owner.
        p.update(current_conveyor_segment=sid,conveyor_position=0.,loaded_at=tick,robot_id=None,velocity_mps=0.)
        robot.update(payload_package_id=None)
        robot['load']['current']=0
        self.transition(p,'ON_CONVEYOR',tick,sid)
        return True

    def reserve_station(self,state,station,order_id,quantity):
        exit=state['conveyor_system']['unloading_points'][station]
        if order_id in exit['reservations']: return True
        if sum(exit['reservations'].values())+quantity>exit['capacity']: return False
        exit['reservations'][order_id]=quantity
        return True

    def release_order(self,state,order_id,station):
        exit=state['conveyor_system']['unloading_points'][station]
        exit['items']=[pid for pid in exit['items'] if state['packages'][pid]['order_id']!=order_id]
        exit['reservations'].pop(order_id,None)

    def step(self,state):
        tick=state['sim']['tick']; dt=state['sim']['tick_ms']/1000; delivered=[]
        for conveyor in state['conveyors'].values():
            if conveyor['status'] == 'RUNNING':
                conveyor['travelled_m'] += conveyor['speed_mps'] * dt
        if not self.network: return
        system=state['conveyor_system']; locks=system['junction_locks']; packages=state['packages']
        active=[p for p in packages.values() if p['status']=='ON_CONVEYOR']
        queues={sid:[] for sid in self.segments}
        for p in active: queues[p['current_conveyor_segment']].append(p)
        # Downstream first: a vacated slot may be used in this tick, never twice by
        # the same parcel. Distance tie-break is stable and oldest loaded wins.
        def remaining(p):
            return sum(self.segments[s]['length_m'] for s in p['route'][p['route_index']:])-p['conveyor_position']
        for p in sorted(active,key=lambda p:(remaining(p),p['loaded_at'],p['package_id'])):
            sid=p['current_conveyor_segment']; s=self.segments[sid]; status=state['conveyors'][sid]
            speed=status['speed_mps'] if status['status']=='RUNNING' else 0
            old=p['conveyor_position']
            # Carriers accelerate into the belt's speed after the robot releases
            # them. Accumulation is physical, not a renderer easing duration.
            cap=float('inf')
            ahead=[q['conveyor_position'] for q in queues[sid] if q is not p and q['conveyor_position']>old]
            if ahead: cap=min(cap,min(ahead)-s['pitch_m'])
            if p['route_index']+1<len(p['route']):
                next_id=p['route'][p['route_index']+1]; ns=self.segments[next_id]
                if len(queues[next_id])>=ns['capacity'] or any(q['conveyor_position']<ns['pitch_m'] for q in queues[next_id]) or state['conveyors'][next_id]['status']!='RUNNING':
                    cap=min(cap,s['length_m'])
                else:
                    speed=min(speed,state['conveyors'][next_id]['speed_mps'])
            else:
                exit=system['unloading_points'][p['destination_station']]
                reserved=p['order_id'] in exit['reservations']
                free=exit['capacity']-sum(exit['reservations'].values())-sum(packages[pid]['order_id'] not in exit['reservations'] for pid in exit['items'])
                if not exit['enabled'] or len(exit['items'])>=exit['capacity'] or not (reserved or free>0):
                    cap=min(cap,s['length_m'])
            node=','.join(map(str,s['path'][-1]))
            owner=locks.get(node)
            if owner and owner!=p['package_id']:
                cap=min(cap,max(0,s['length_m']-s['pitch_m']))
            clearance=max(0,cap-old)
            a=self.acceleration
            safe=max(0,sqrt((a*dt)**2+2*a*clearance)-a*dt)
            desired=min(speed,safe)
            velocity=p.get('velocity_mps',0.)
            velocity=max(0,velocity+max(-a*dt,min(a*dt,desired-velocity))) if speed>0 else 0.
            travel=velocity*dt
            if speed>0 and clearance<a*dt**2/2 and velocity<=a*dt: travel=clearance
            proposed=min(cap,old+travel)
            target=min(s['length_m'],proposed)
            # Hold the shared junction until the preceding parcel's tail clears it.
            node=','.join(map(str,s['path'][-1]))
            if target>s['length_m']-s['pitch_m']:
                owner=locks.get(node)
                if owner and owner!=p['package_id']:
                    target=min(target,max(0,s['length_m']-s['pitch_m']))
                elif speed>0: locks[node]=p['package_id']
            p['conveyor_position']=max(old,target)
            p['velocity_mps']=min(velocity,max(0,p['conveyor_position']-old)/dt)
            if p['conveyor_position']>=s['pitch_m']:
                entry=','.join(map(str,s['path'][0]))
                if locks.get(entry)==p['package_id']: locks.pop(entry)
            if p['conveyor_position']>=s['length_m']-1e-8 and speed>0:
                if p['route_index']+1<len(p['route']):
                    nxt=p['route'][p['route_index']+1]; ns=self.segments[nxt]
                    if len(queues[nxt])<ns['capacity'] and all(q['conveyor_position']>=ns['pitch_m'] for q in queues[nxt]) and state['conveyors'][nxt]['status']=='RUNNING':
                        queues[sid].remove(p); queues[nxt].append(p)
                        # Preserve sub-tick travel across segment boundaries.
                        overflow=max(0,proposed-s['length_m'])
                        room=min([q['conveyor_position']-ns['pitch_m'] for q in queues[nxt] if q is not p]+[ns['length_m']])
                        p.update(current_conveyor_segment=nxt,conveyor_position=min(overflow,max(0,room)),route_index=p['route_index']+1,current_location=nxt,velocity_mps=velocity)
                        p['timeline'].append(dict(tick=tick,status='SCANNED',location=nxt))
                else:
                    exit=system['unloading_points'][p['destination_station']]
                    reserved=p['order_id'] in exit['reservations']
                    free_unreserved=exit['capacity']-sum(exit['reservations'].values())-sum(packages[pid]['order_id'] not in exit['reservations'] for pid in exit['items'])
                    if exit['enabled'] and len(exit['items'])<exit['capacity'] and (reserved or free_unreserved>0):
                        queues[sid].remove(p); exit['items'].append(p['package_id'])
                        p.update(delivered_at=tick,current_conveyor_segment=None,estimated_remaining_s=0.)
                        self.transition(p,'DELIVERED',tick,p['destination_station'])
                        system['metrics']['delivered']+=1; system['delivery_ticks'].append(tick); delivered.append(p)
                        for key in list(locks):
                            if locks[key]==p['package_id']: locks.pop(key)
            if p['status']=='ON_CONVEYOR':
                route=p['route'][p['route_index']:]
                cruise=state['conveyors'][route[0]]['speed_mps']
                ramp=max(0,cruise-p['velocity_mps'])**2/(2*self.acceleration*max(.01,cruise))
                p['estimated_remaining_s']=round(ramp+sum((self.segments[sid]['length_m']-(p['conveyor_position'] if i==0 else 0))/max(.01,state['conveyors'][sid]['speed_mps']) for i,sid in enumerate(route)),1) if all(state['conveyors'][sid]['status']=='RUNNING' and state['conveyors'][sid]['speed_mps']>0 for sid in route) else None
        # Outbound is consumed by dispatch; demo cartons at packing are processed
        # automatically. Customer consolidation buffers are released by Commerce.
        for station,exit in system['unloading_points'].items():
            exit['items']=[pid for pid in exit['items'] if not ((station.startswith('OUT-') or packages[pid]['order_id'].startswith('DEMO-')) and tick-packages[pid]['delivered_at']>=100)]
        system['delivery_ticks']=[t for t in system['delivery_ticks'] if t>tick-600]
        for sid,queue in queues.items():
            state['conveyors'][sid]['items_on_belt']=len(queue)
            state['conveyors'][sid]['throughput_per_min']=sum(p['delivered_at'] is not None and p['delivered_at']>tick-600 and p['route'][-1]==sid for p in packages.values())
        m=system['metrics']; m.update(on_conveyor=sum(len(q) for q in queues.values()),waiting=sum(p['status']=='WAITING_INDUCTION' for p in packages.values()),
            throughput_per_min=len(system['delivery_ticks']),occupancy=round(sum(len(q) for q in queues.values())/max(1,sum(s['capacity'] for s in self.segments.values())),4))
        if tick%10==0:
            for zid in ('ZONE_A','ZONE_B','ZONE_C','ZONE_D'):
                robots=[r for r in state['robots'].values() if r.get('home_zone')==zid]
                tasks=[t for t in state['tasks'].values() if t.get('package_id') and packages[t['package_id']]['source_zone']==zid]
                system['zones'][zid]=dict(zone_id=zid,assigned_robots=[r['id'] for r in robots],storage_locations=[l['id'] for l in self.layout['locations'] if l['zone']==zid and l['kind']=='SHELF'],
                    pending_tasks=[t['id'] for t in tasks if t['status']=='WAITING'],active_tasks=[t['id'] for t in tasks if t['status'] in ('ASSIGNED','IN_PROGRESS')],
                    loading_stations=['IND-'+zid[-1]],robot_status_summary=dict(Counter(r['status'] for r in robots)),zone_operational_status=state['zones'][zid]['status'],
                    induction_queue=[p['package_id'] for p in packages.values() if p['source_zone']==zid and p['status']=='WAITING_INDUCTION'])

        return delivered

    def position(self,p):
        s=self.segments[p['current_conveyor_segment']]; a,b=s['path']; t=p['conveyor_position']/s['length_m']
        return [a[0]+(b[0]-a[0])*t,.87+p['package_dimensions'][1]/2,a[1]+(b[1]-a[1])*t]
