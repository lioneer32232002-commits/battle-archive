// 時間軸引擎 — 純邏輯,不依賴 Three.js
// 時間單位:分鐘(戰役自訂原點);座標:場景單位;heading:北(-z)為 0,順時針(弧度)
// 註:與 midway 共用同一份引擎,跨戰役行為一致。

export function interpolateTrack(track, t) {
  if (track.length === 1) {
    return { x: track[0].x, z: track[0].z, heading: track[0].heading ?? 0 };
  }
  if (t <= track[0].t) {
    return { x: track[0].x, z: track[0].z, heading: headingBetween(track[0], track[1]) };
  }
  const last = track[track.length - 1];
  if (t >= last.t) {
    return { x: last.x, z: last.z, heading: headingBetween(track[track.length - 2], last) };
  }
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        heading: headingBetween(a, b),
      };
    }
  }
  return { x: last.x, z: last.z, heading: 0 };
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
