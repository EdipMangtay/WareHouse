"""Four-sector extension of the existing procedural facility (metres, +z south)."""
from math import dist


def add_network(layout, cfg):
    w, d = cfg.width, cfg.depth
    cx, split = cfg.zone_split_x or w // 2, cfg.zone_split_z or (d - 6) // 2
    if not 24 <= split <= d - 30:
        raise ValueError('Zone split must leave usable north and south storage sectors')
    north, south = 20, d - 28
    offset = 4
    west, east, front, rear = -offset, w + offset, -offset, d + offset
    colors = ['#61b8d0', '#c6a364', '#70b79f', '#a99bcc']
    zones = []
    for i, (letter, name, rect) in enumerate([
        ('A','Northwest',[2,15,cx,split]), ('B','Northeast',[cx,15,w-2,split]),
        ('C','Southwest',[2,split,cx,d-21]), ('D','Southeast',[cx,split,w-2,d-21]),
    ]):
        x0,z0,x1,z1=rect
        zones.append(dict(id='ZONE_'+letter,name=name,color=colors[i],floor=1,polygon=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]))
    # Department areas remain distinct from the four robot controllers.
    service = [z for z in layout['zones'] if z['id'] in ('A','D','E','F','G')]
    for z in service:
        if z['id']=='A': z['id']='RECEIVING'
        elif z['id']=='D': z['id']='SORTING'
    layout['zones'] = zones + service
    for collection in ('stations','docks','cameras','sensors'):
        for obj in layout[collection]:
            obj['zone']={'A':'RECEIVING','D':'SORTING','B':'ZONE_A','C':'ZONE_B'}.get(obj['zone'],obj['zone'])
    # Retain the east service aisle and the unobstructed mid-sector cross aisle.
    layout['racks'] = [
        r for r in layout['racks'] if r['position'][0]+r['size'][0] <= w-10
        and not (r['position'][2] < split+2 and r['position'][2]+r['size'][2] > split-2)]
    rack_ids = {r['id'] for r in layout['racks']}
    layout['locations'] = [l for l in layout['locations'] if not l.get('rack_id') or l['rack_id'] in rack_ids]
    layout['storage_slots'] = [s for s in layout['storage_slots'] if s['rack_id'] in rack_ids]
    for r in layout['racks']:
        r['zone']='ZONE_'+('A' if r['position'][0]<cx else 'B') if r['position'][2]<split else 'ZONE_'+('C' if r['position'][0]<cx else 'D')
    by_rack={r['id']:r['zone'] for r in layout['racks']}
    for l in layout['locations']:
        if l.get('rack_id'): l['zone']=by_rack[l['rack_id']]
        elif l['zone']=='A': l['zone']='RECEIVING'
        elif l['zone']=='D': l['zone']='SORTING'
    # The shell carries perimeter roof supports; keep the central aisle clear.
    layout['obstacles']=[o for o in layout['obstacles'] if o['kind']!='PILLAR']
    layout['conveyors']=[]
    segments=layout['conveyors']
    def belt(sid,a,b,zone='E',feeds=None,role='perimeter'):
        segments.append(dict(id=sid,name=sid,zone=zone,path=[a,b],width=1.2,speed_mps=cfg.conveyor_speed,
            direction='FORWARD',blocks_grid=True,next=[],feeds=feeds,placement='exterior',role=role,length_m=dist(a,b),
            capacity=max(1,int(dist(a,b)//cfg.parcel_pitch)),pitch_m=cfg.parcel_pitch))
        return sid
    points={}
    for letter,z,sign in [('A',north,-1),('B',north,1),('C',south,-1),('D',south,1)]:
        zid='ZONE_'+letter; sid='IND-'+letter; point=[2.5 if sign<0 else w-2.5,z+.5]
        belt(sid,[-.8 if sign<0 else w+.8,z+.5],[west if sign<0 else east,z+.5],zid,role='induction')
        layout['locations'].append(dict(id=sid,kind='INDUCTION',zone=zid,floor=1,rack_id=None,level_range=None,access_point=point))
        points[sid]=dict(id=sid,zone_id=zid,segment_id=sid,capacity=1,access_point=point)
    # A continuous outside loop; each junction is a separate straight segment so
    # both authoritative and rendered parcel positions follow the same geometry.
    def edge(name, nodes):
        for i,(a,b) in enumerate(zip(nodes,nodes[1:]),1):
            belt(f'PERIM-{name}-{i:02d}',a,b)
    edge('WEST',[[west,front],[west,north+.5],[west,south+.5],[west,rear]])
    packs=sorted((s for s in layout['stations'] if s['kind']=='PACKING'),key=lambda s:s['rect'][0])
    south_nodes=[[west,rear]]
    transfers={}
    for s in packs:
        x=(s['rect'][0]+s['rect'][2])/2
        node=[x,rear]
        south_nodes.append(node)
        belt('EXIT-'+s['id'],node,[x,d+.8],feeds=s['id'],role='exit')
        transfers[s['id']]=dict(wall='south',position=[x,d],segment_id='EXIT-'+s['id'])
    edge('SOUTH',south_nodes+[[east,rear]])
    edge('EAST',[[east,rear],[east,south+.5],[east,north+.5],[east,front]])
    edge('NORTH',[[east,front],[w-12,front],[west,front]])
    belt('EXIT-OUT-01',[w-12,front],[w-12,-.8],feeds='OUT-01',role='exit')
    transfers['OUT-01']=dict(wall='north',position=[w-12,0],segment_id='EXIT-OUT-01')
    # OUT-01 is the right-hand receiving dock for the dispatch belt.
    out1=next(l for l in layout['locations'] if l['id']=='OUT-01')
    out2=next(l for l in layout['locations'] if l['id']=='OUT-02')
    out1['access_point'],out2['access_point']=out2['access_point'],out1['access_point']
    docks=[o for o in layout['docks'] if o['kind']=='OUTBOUND']
    docks[0]['rect'],docks[1]['rect']=docks[1]['rect'],docks[0]['rect']
    docks[0]['door'],docks[1]['door']=docks[1]['door'],docks[0]['door']
    # A service induction allows packed orders to enter the same dispatch network.
    # It shares the southeast loading cell; its capacity is enforced by that segment.
    for a in segments:
        a['next']=[b['id'] for b in segments if a['path'][-1]==b['path'][0] and a is not b]
    # Packing terminals do not continue into other lines.
    for s in segments:
        if s.get('feeds'): s['next']=[]
    layout['conveyor_network']=dict(version=2,placement='exterior',perimeter_offset_m=offset,
        apron_bounds=[west-2,front-2,east+2,rear+2],transfer_points=transfers,
        induction_points=points,zone_split_z=split,
        unloading_points={s['feeds']:dict(capacity=cfg.unloading_capacity,enabled=True) for s in segments if s.get('feeds')},
        package_gap_m=cfg.parcel_gap,seed=cfg.seed)
    # Assign storage robots round-robin and retain a small shared service fleet.
    # Staging rows use the central cross aisle, away from induction approaches.
    service_count=min(4,max(1,cfg.robot_count//6))
    per=[0,0,0,0]
    for i,r in enumerate(layout['spawn']['robots']):
        if i < cfg.robot_count-service_count:
            q=i%4; n=per[q]; per[q]+=1
            sign=-1 if q%2==0 else 1
            r['position']=[6.5+n*3 if sign<0 else cx+10.5+n*3,0,split+(-1.5 if q<2 else 1.5)]
            r['home_zone']='ZONE_'+'ABCD'[q]
        else: r['home_zone']='SERVICE'
    for q,letter in enumerate('ABCD'):
        sign=-1 if q%2==0 else 1
        x=cx+sign*3.5
        z=(split-3.5) if q<2 else d-23.5
        sid='CHG-Z'+letter; ap=[cx+sign*5.5,z]
        layout['charging_stations'].append(dict(id=sid,zone='ZONE_'+letter,position=[x,0,z],heading=0,power_kw=22,access_point=ap))
        layout['locations'].append(dict(id=sid,kind='CHARGING',zone='ZONE_'+letter,floor=1,rack_id=None,level_range=None,access_point=ap))
    layout['id']=f'waretwin-{cfg.preset}-conveyor-v2'
    layout['metadata']['counts'].update(racks=len(layout['racks']),storage_slots=len(layout['storage_slots']),zones=4)


def validate_network(layout):
    segments={s['id']:s for s in layout['conveyors']}
    if len(segments)!=len(layout['conveyors']): raise ValueError('Duplicate conveyor ID')
    terminals={s['feeds']:s['id'] for s in segments.values() if s.get('feeds')}
    for s in segments.values():
        if s['length_m']<=0 or s['capacity']<1: raise ValueError('Invalid conveyor geometry/capacity')
        for nxt in s['next']:
            if nxt not in segments or s['path'][-1]!=segments[nxt]['path'][0]:
                raise ValueError('Disconnected conveyor segment: '+s['id'])
    for entry in layout['conveyor_network']['induction_points'].values():
        seen=set(); pending=[entry['segment_id']]
        while pending:
            sid=pending.pop()
            if sid in seen: continue
            seen.add(sid); pending.extend(segments[sid]['next'])
        if not set(terminals.values())<=seen: raise ValueError('Invalid destination routes from '+entry['id'])
    return dict(segments=len(segments),destinations=len(terminals),connected=True)
