import type { WarehouseLayout } from "./types";
import { isWalkable, type NavGrid } from "../simulation/astar";

/**
 * 由 layout 產生導航網格。0 = 可通行、1 = 障礙、2 = walkway (可通行但減速)。
 * 規則見格式說明「導航網格的產生規則」。後端 Python 需實作同樣規則並以同一 layout 做比對測試。
 */
export function buildNavGrid(layout: WarehouseLayout, floor = 1): NavGrid {
  const graph=layout.navigation_graph,data=graph?.floors[String(floor)];
  if(data)return {cols:data.cols,rows:data.rows,cells:Uint8Array.from(data.cells),outgoing:Uint8Array.from(data.outgoing),cellSize:graph!.cell_size};
  const grid=rasterizeGrid(layout,floor);grid.cellSize=layout.grid.cell_size;applyClearance(layout,grid);
  const directions=[[1,0],[-1,0],[0,1],[0,-1]], rules=new Map<string,number[][]>();
  const named:Record<string,number[]>={'+x':[1,0],'-x':[-1,0],'+z':[0,1],'-z':[0,-1]};
  for(const corridor of layout.navigation?.corridors??[]){
    if((corridor.floor??1)!==floor||corridor.mode==='two_way')continue;
    const dir=named[corridor.direction??''];if(!dir)throw new Error('Invalid corridor direction');
    const [x0,z0,x1,z1]=corridor.rect;
    for(let r=0;r<grid.rows;r++)for(let c=0;c<grid.cols;c++){
      const x=(c+.5)*grid.cellSize,z=(r+.5)*grid.cellSize;
      if(x>=x0&&x<x1&&z>=z0&&z<z1&&isWalkable(grid,c,r)){const key=`${c},${r}`,v=rules.get(key)??[];v.push(dir);rules.set(key,v);}
    }
  }
  grid.outgoing=new Uint8Array(grid.cells.length);
  for(let r=0;r<grid.rows;r++)for(let c=0;c<grid.cols;c++)if(isWalkable(grid,c,r))directions.forEach(([dx,dz],bit)=>{
    if(!isWalkable(grid,c+dx,r+dz))return;
    const constraints=[...(rules.get(`${c},${r}`)??[]),...(rules.get(`${c+dx},${r+dz}`)??[])];
    if(!constraints.some(([vx,vz])=>dx*vx+dz*vz<0))grid.outgoing![r*grid.cols+c]|=1<<bit;
  });
  return grid;
}
function rasterizeGrid(layout: WarehouseLayout, floor = 1): NavGrid {
  const { cols, rows, cell_size: cs } = layout.grid;
  const cells = new Uint8Array(cols * rows);
  // 電梯井道（鋼架＋護網）在每個樓層都是實體障礙：一般路徑必須繞過，
  // 進出轎廂只走電梯狀態機的 microMove（不經網格）。
  // round-9g：井道 3D 外觀是 W 2.8 × D 3.6（Mezzanine LIFT_SHAFT），x 方向封 ±1.4（3 格，
  // 覆蓋 2.8 + 兩側餘裕）夠用，但 z 方向若同樣只封 ±1.4（3 格 = 3.0 m）會讓南北護網各突出
  // 0.4 m 到可走格 —— 貼著走的機器人（半寬 0.34、旋轉掃掠 0.58）會插進護網與角柱。
  // 故 z 封 ±1.9（5 格），涵蓋 3.6 m 井道深度＋掃掠餘裕。排隊格（cell-4-i）、門軸中繼格
  // 與全部出口候選點（dc −2/−3）都在封鎖範圍外、維持可走。
  const blockLifts = () => {
    for (const l of layout.lifts ?? []) {
      const x = l.cell[0] + 0.5, z = l.cell[1] + 0.5;
      const c0 = Math.max(0, Math.floor((x - 1.4) / cs)), c1 = Math.min(cols - 1, Math.ceil((x + 1.4) / cs) - 1);
      const r0 = Math.max(0, Math.floor((z - 1.9) / cs)), r1 = Math.min(rows - 1, Math.ceil((z + 1.9) / cs) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c] = 1;
    }
  };
  if (floor !== 1) {
    // 二樓（夾層）：footprint 之外全是「不存在的樓板」= 障礙；footprint 內可走，再扣掉該樓層貨架
    cells.fill(1);
    const fp = layout.floors.find((f) => f.id === floor)?.footprint;
    if (fp) {
      const xs = fp.map((p) => p[0]), zs = fp.map((p) => p[1]);
      const c0 = Math.max(0, Math.floor(Math.min(...xs) / cs)), c1 = Math.min(cols - 1, Math.ceil(Math.max(...xs) / cs) - 1);
      const r0 = Math.max(0, Math.floor(Math.min(...zs) / cs)), r1 = Math.min(rows - 1, Math.ceil(Math.max(...zs) / cs) - 1);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c] = 0;
    }
    for (const r of layout.racks) if (r.blocks_grid && (r.floor ?? 1) === floor) {
      const x0 = r.position[0], z0 = r.position[2], x1 = x0 + r.size[0], z1 = z0 + r.size[2];
      const c0 = Math.max(0, Math.floor(x0 / cs)), c1 = Math.min(cols - 1, Math.ceil(x1 / cs) - 1);
      const r0 = Math.max(0, Math.floor(z0 / cs)), r1 = Math.min(rows - 1, Math.ceil(z1 / cs) - 1);
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) cells[rr * cols + cc] = 1;
    }
    blockLifts();
    return { cols, rows, cells };
  }
  const fillRect = (x0: number, z0: number, x1: number, z1: number, v: number) => {
    const c0 = Math.max(0, Math.floor(x0 / cs)), c1 = Math.min(cols - 1, Math.ceil(x1 / cs) - 1);
    const r0 = Math.max(0, Math.floor(z0 / cs)), r1 = Math.min(rows - 1, Math.ceil(z1 / cs) - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c] = v;
  };
  for (const w of layout.walkways) {
    const xs = w.polygon.map((p) => p[0]), zs = w.polygon.map((p) => p[1]);
    fillRect(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), w.robots_allowed ? 2 : 1);
  }
  for (const r of layout.racks) if (r.blocks_grid && (r.floor ?? 1) === 1) fillRect(r.position[0], r.position[2], r.position[0] + r.size[0], r.position[2] + r.size[2], 1);
  for (const c of layout.conveyors) if (c.blocks_grid) {
    for (let i = 0; i < c.path.length - 1; i++) {
      const [ax, az] = c.path[i], [bx, bz] = c.path[i + 1], hw = c.width / 2;
      fillRect(Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw, 1);
    }
  }
  for (const ra of layout.restricted_areas) if (!ra.robots_allowed) fillRect(ra.rect[0], ra.rect[1], ra.rect[2], ra.rect[3], 1);
  for (const s of layout.stations) fillRect(s.rect[0], s.rect[1], s.rect[2], s.rect[3], 1);
  // 夾層支撐柱（立在 F1 地面、撐到樓板）：以柱底板 0.9×0.9 m 封成障礙 —— 路徑必須繞柱，不能穿過
  for (const [cx, cz] of layout.columns ?? []) fillRect(cx - 0.45, cz - 0.45, cx + 0.45, cz + 0.45, 1);
  // 建築結構柱等實體障礙（round-9d）：整塊封鎖 —— 原本只在 3D 場景程序生成，網格不知道，機器人會穿柱
  for (const o of layout.obstacles ?? []) fillRect(o.rect[0], o.rect[1], o.rect[2], o.rect[3], 1);
  // 充電樁櫃體（round-9e）：櫃體是實體 —— 封格後通行走廊固定在停車排南側一格，不會有人從櫃體穿過
  for (const c of layout.charging_stations) fillRect(c.position[0] - 0.45, c.position[2] - 0.4, c.position[0] + 0.45, c.position[2] + 0.5, 1);
  blockLifts();
  return { cols, rows, cells };
}

function applyClearance(layout: WarehouseLayout, grid: NavGrid) {
  const {cols,rows,cells}=grid,cs=layout.grid.cell_size;
  // Must match Python: one conservative clearance envelope, built once per grid.
  const padding = Math.max(layout.navigation?.clearance_padding ?? 0,Math.ceil(((layout.navigation?.robot_radius??0)+(layout.navigation?.safety_margin??0))/cs));
  if (padding) {
    const source = cells.slice();
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      if (source[row * cols + col] === 1) {
        for (let dz = -padding; dz <= padding; dz++) for (let dx = -padding; dx <= padding; dx++) {
          const x = col + dx, z = row + dz;
          if (x >= 0 && z >= 0 && x < cols && z < rows) cells[z * cols + x] = 1;
        }
      }
      if (col < padding || row < padding || col >= cols-padding || row >= rows-padding) cells[row * cols + col] = 1;
    }
  }
}
