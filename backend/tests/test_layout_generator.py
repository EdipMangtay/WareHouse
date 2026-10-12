"""Industrial presets must run real orders on the same geometry they render."""
import copy
import math
import uuid

import pytest
from app.layout_generator import generate_layout, validate_layout, preset_config, solid_rectangles
from app.sim.engine import SimEngine
from app.sim.navgrid import build_nav_grid
from app.commerce import Commerce, Checkout


@pytest.mark.parametrize('preset,dimensions', [('small',(80,60)),('medium',(120,80)),('large',(180,120)),('mega',(240,160))])
def test_presets_are_connected_and_addressable(preset, dimensions):
    layout = generate_layout(preset)
    assert (layout['size']['width'],layout['size']['depth']) == dimensions
    assert layout == generate_layout(preset)
    assert layout['metadata']['validation']['connected']
    assert layout['metadata']['counts']['storage_slots'] >= 800
    assert len({s['id'] for s in layout['storage_slots']}) == len(layout['storage_slots'])
    grid = build_nav_grid(layout)
    # A centre in the aisle directly against a rack is forbidden by the body envelope.
    rack = layout['racks'][0]
    x,_,z = rack['position']
    assert grid.cells[(z-1)*grid.cols+x] == 1
    assert grid.cells[0] == 1


def test_rejects_overlaps_and_inaccessible_stations():
    layout = generate_layout('small')
    layout['racks'][1]['position'] = layout['racks'][0]['position'][:]
    with pytest.raises(ValueError, match='overlap'): validate_layout(layout)
    layout = generate_layout('small')
    layout['locations'][0]['access_point'] = [4.5,18.5]
    with pytest.raises(ValueError, match='blocked'): validate_layout(layout)


def test_rejects_unsafe_configuration():
    for overrides in ({'corridor':2}, {'cell_size':2}, {'robot_count':1000}, {'packing_stations':20}, {'robot_radius':2}):
        with pytest.raises(ValueError): generate_layout(preset_config('small', **overrides))


@pytest.mark.parametrize('preset', ['small','medium','large'])
def test_order_traverses_generated_warehouse(preset, tmp_path):
    layout = generate_layout(preset)
    engine = SimEngine(layout, seed=42)
    engine.next_task_tick = 10**12
    commerce = Commerce(str(tmp_path / f'{preset}.db'), engine)
    request = Checkout(customer_name='Depo Testi', email='test@example.com', address='Test teslim noktası', delivery_method='standard',
                       items=[{'product_id':'WT-001','quantity':1}], idempotency_key=uuid.uuid4().hex)
    order = commerce.checkout(request)
    observed = {'received'}
    solids = solid_rectangles(layout)
    try:
        for tick in range(10000):
            engine.step(); commerce.advance()
            if tick % 10 == 0:
                for robot in engine.state['robots'].values():
                    if not robot['current_task_id']: continue
                    x,_,z = robot['position']
                    for solid, (x0,z0,x1,z1) in solids:
                        distance = math.hypot(max(x0-x,0,x-x1),max(z0-z,0,z-z1))
                        assert distance >= .65 - 1e-5, (preset,robot['id'],solid,x,z)
            if tick % 5 == 0:
                order = commerce.get_order(order['tracking_code']); observed.add(order['status'])
                if order['status'] == 'ready': break
        assert order['status'] == 'ready', (preset,order['status'],engine.state['sim']['tick'])
        assert observed == {'received','picking','packing','loading','ready'}
        assert len(order['task_ids']) >= 2
    finally:
        commerce.conn.close()


def test_layout_migration_preserves_order_identity_and_reserved_stock(tmp_path):
    import json
    from app.sim.navgrid import load_layout
    legacy = SimEngine(load_layout(), seed=42)
    path = str(tmp_path / 'migration.db')
    original = Commerce(path, legacy)
    # Model a catalog assignment to a valid legacy shelf absent in the smaller facility.
    product = original.products()[0]
    product['rack_id'] = 'SHELF-D40'
    with original.conn:
        original.conn.execute('UPDATE commerce_products SET data=? WHERE id=?', (json.dumps(product),product['id']))
    order = original.checkout(Checkout(customer_name='Taşıma Testi',email='test@example.com',address='Test adresi',delivery_method='standard',items=[{'product_id':product['id'],'quantity':2}],idempotency_key=uuid.uuid4().hex))
    stock = original.products()[0]['stock']
    original.conn.close()
    engine = SimEngine(generate_layout('small'), seed=42)
    migrated = Commerce(path,engine)
    try:
        restored = migrated.get_order(order['tracking_code'])
        assert restored['id'] == order['id']
        assert restored['total_cents'] == order['total_cents']
        assert migrated.products()[0]['stock'] == stock
        assert restored['items'][0]['rack_id'] in engine.loc
        for _ in range(6):
            engine.step(); migrated.advance()
        assert migrated.get_order(order['tracking_code'])['status'] == 'picking'
    finally:
        migrated.conn.close()
