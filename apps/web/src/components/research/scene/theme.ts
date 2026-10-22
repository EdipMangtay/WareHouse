/** Scene material palette. UI equivalents live in research-tokens.css. */
export const palette = {
    background: '#dce3e6', floor: '#d0d6d4', apron: '#c3cdcb', line: '#f5f4e9', grid: '#b4bfbd',
    steel: '#40545b', dark: '#23383e', rail: '#a6b7b9', belt: '#344f55',
    carton: '#be9765', label: '#fbf7eb', selection: '#117d89',
    error: '#cc514a', warning: '#b57724', good: '#277b65', ghost: '#6b64a5',
    zone: ['#378f98', '#6680aa', '#8b77a3', '#8b9471'],
};
export const zoneColor = (index: number) => palette.zone[((index % palette.zone.length) + palette.zone.length) % palette.zone.length];
