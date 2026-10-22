import { layout } from '../../state/store';
import type { Parcel } from '../../schema/conveyor';

export const PARCEL_COLORS = { component: '#607f94', packed: '#bd936a', selected: '#8fe4d5' };
const outbound = new Set(layout.locations.filter(l => l.kind === 'OUTBOUND').map(l => l.id));
/** The destination is assigned by the core; visual color never changes the parcel status. */
export const parcelColor = (parcel: Parcel | undefined, selected: boolean) => selected ? PARCEL_COLORS.selected : parcel && outbound.has(parcel.destination_station) ? PARCEL_COLORS.packed : PARCEL_COLORS.component;
