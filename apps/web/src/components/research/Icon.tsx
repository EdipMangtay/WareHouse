import type { CSSProperties } from 'react';
const paths = {
    layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
    cube: 'm12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10v9M3 8l9 5 9-5M7 5.8l9 5',
    robot: 'M8 3h8v6H8zM6 12h12v7H6zM3 12v6m18-6v6M9 19v3m6-3v3M10 6h.01M14 6h.01',
    belt: 'M5 8h14a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8Zm0 4h.01M10 12h.01M15 12h.01M19 12h.01M6 16v4m12-4v4',
    focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 12h6m-3-3v6',
    home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7',
    top: 'M3 3h18v18H3zM3 9h18M9 9v12m6-12v12',
    chevron: 'm9 5 7 7-7 7',
    close: 'm6 6 12 12M6 18 18 6',
    play: 'm8 4 12 8-12 8V4Z',
    pause: 'M8 4v16m8-16v16',
    step: 'm5 5 10 7-10 7V5Zm14 0v14',
    reset: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
    settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
    list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3h.01',
    arrow: 'M3 12h18m-6-6 6 6-6 6',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    clock: 'M12 7v5l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    check: 'm4 12 5 5L20 6',
    eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
} as const;
export function Icon({ name, size = 17, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]}/></svg>;
}
