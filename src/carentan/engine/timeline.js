// 時間軸引擎 — 純邏輯,不依賴 Three.js
// 時間單位:分鐘(戰役自訂原點);座標:場景單位;heading:北(-z)為 0,順時針(弧度)
//
// M-1 升級(全戰役美術升級,自巴斯通移植):航點間改用「以航點時間 t 為節點」的非均勻 Catmull-Rom 曲線插值,
//   轉彎為平滑弧線、無瞬間轉頭。時間參數沿用航點 t(非弧長參數化),對位置為「確定性映射」,
//   確保冷場自動快轉與拖曳跳轉時位置正確、不飛點。起步/停止只對頭尾段各套一次緩動。
//   對外 API 與回傳格式 { x, z, heading } 不變;unitStateAt 等呼叫端不需改。

// ── 緩動(僅作用於頭尾段的局部參數 f;皆滿足 f=0→0、f=1→1) ──
// easeIn:起步靜止(f'(0)=0)、於內段接點速度=1,避免第一個航點出現停頓
// easeOut:於內段接點速度=1、停止靜止(f'(1)=0)
// smooth :整條 track 只有一段時的 ease-in-out
const clamp01 = (f) => (f < 0 ? 0 : f > 1 ? 1 : f);
const easeIn = (f) => { f = clamp01(f); return f * f * (2 - f); };        // 2f²−f³
const easeOut = (f) => { f = clamp01(f); return f * (1 + f * (1 - f)); }; // f+f²−f³
const smooth = (f) => { f = clamp01(f); return f * f * (3 - 2 * f); };    // 3f²−2f³

// 兩點在其節點區間對參數 t 的線性(可外插)混合 — Barry–Goldman 遞迴的基本步
function mix(a, b, ka, kb, t) {
  const f = kb === ka ? 0 : (t - ka) / (kb - ka);
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

// 非均勻 Catmull-Rom(Barry–Goldman 金字塔式)在區段 [P1,P2] 求值,節點 = 航點時間
function crPoint(P0, P1, P2, P3, k0, k1, k2, k3, t) {
  const A1 = mix(P0, P1, k0, k1, t);
  const A2 = mix(P1, P2, k1, k2, t);
  const A3 = mix(P2, P3, k2, k3, t);
  const B1 = mix(A1, A2, k0, k2, t);
  const B2 = mix(A2, A3, k1, k3, t);
  return mix(B1, B2, k1, k2, t);
}

// 在曲線上對時間 t 求位置(含頭尾段緩動)。呼叫端須確保 track.length >= 3 且 t 在 (t0, tN) 之間。
function evalCurve(track, t) {
  const n = track.length;
  let i = 0;
  while (i < n - 2 && t > track[i + 1].t) i++;        // 找 t 所在區段 [i, i+1]
  const P1 = track[i], P2 = track[i + 1];
  const P0 = i > 0 ? track[i - 1] : track[0];          // 頭尾以端點複製補
  const P3 = i + 2 < n ? track[i + 2] : track[n - 1];
  const k1 = P1.t, k2 = P2.t;
  const k0 = i > 0 ? track[i - 1].t : k1 - (k2 - k1);  // 補點節點以等距外插,避免除零
  const k3 = i + 2 < n ? track[i + 2].t : k2 + (k2 - k1);

  // 頭尾段緩動:把局部參數 f 經緩動函式重映射回時間 te,再於曲線上求值(仍為 t 的確定性函式)
  let te = t;
  const isFirst = i === 0, isLast = i === n - 2;
  if (isFirst || isLast) {
    const f = k2 === k1 ? 0 : (t - k1) / (k2 - k1);
    const fe = isFirst && isLast ? smooth(f) : isFirst ? easeIn(f) : easeOut(f);
    te = k1 + fe * (k2 - k1);
  }
  return crPoint(P0, P1, P2, P3, k0, k1, k2, k3, te);
}

// 由曲線切線(中央差分)求 heading;北為 -z、東為 +x,北 = 0 順時針
function headingAtCurve(track, t) {
  const t0 = track[0].t, tN = track[track.length - 1].t;
  const h = (tN - t0 || 1) * 1e-3;
  let ta = t - h, tb = t + h;
  if (ta < t0) { ta = t0; tb = t0 + 2 * h; }
  if (tb > tN) { tb = tN; ta = tN - 2 * h; }
  const a = evalCurve(track, ta), b = evalCurve(track, tb);
  const dx = b.x - a.x, dz = b.z - a.z;
  if (dx * dx + dz * dz < 1e-9) return headingBetween(track[0], track[track.length - 1]);
  return Math.atan2(dx, -dz);
}

export function interpolateTrack(track, t) {
  const n = track.length;
  if (n === 1) {
    return { x: track[0].x, z: track[0].z, heading: track[0].heading ?? 0 };
  }
  if (t <= track[0].t) {
    return { x: track[0].x, z: track[0].z, heading: headingBetween(track[0], track[1]) };
  }
  const last = track[n - 1];
  if (t >= last.t) {
    return { x: last.x, z: last.z, heading: headingBetween(track[n - 2], last) };
  }
  if (n === 2) {                       // 只有兩點:退回直線插值
    const a = track[0], b = track[1];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: headingBetween(a, b) };
  }
  const p = evalCurve(track, t);       // 三點以上:Catmull-Rom 曲線
  return { x: p.x, z: p.z, heading: headingAtCurve(track, t) };
}

function headingBetween(a, b) {
  // 北為 -z、東為 +x;北 = 0,順時針增加
  return Math.atan2(b.x - a.x, -(b.z - a.z));
}

export function activeEvents(events, t) {
  return events.filter((e) => e.t <= t);
}

export function newEvents(events, prevT, t) {
  return events.filter((e) => e.t > prevT && e.t <= t);
}

export function unitStateAt(unit, t) {
  let status = 'normal';
  const strength = { ...unit.strength };
  let downAt = null; // 失效時刻(沉沒/摧毀)

  for (const c of unit.statusChanges ?? []) {
    if (c.t > t) break;
    if (c.status) status = c.status;
    if (c.strengthDelta) {
      for (const [k, v] of Object.entries(c.strengthDelta)) {
        strength[k] = Math.max(0, (strength[k] ?? 0) + v);
      }
    }
    if ((c.status === 'destroyed' || c.status === 'sunk') && downAt === null) downAt = c.t;
  }

  const pos = interpolateTrack(unit.track, downAt !== null ? Math.min(t, downAt) : t);
  return { pos, heading: pos.heading, status, strength };
}
