// 文字標籤 Sprite:艦名、部隊名(含指揮官)、地名
import * as THREE from 'three';

const SIDE_CSS = { red: '#ff6b5e', blue: '#5ea8ff', neutral: '#ffd97a' };

export function makeLabel(text, { side = 'neutral', sub = '', big = false } = {}) {
  const c = document.createElement('canvas');
  const scaleFactor = 2;
  const fontMain = big ? 34 : 26;
  const fontSub = 18;
  c.width = 512 * scaleFactor;
  c.height = (sub ? 96 : 64) * scaleFactor;
  const g = c.getContext('2d');
  g.scale(scaleFactor, scaleFactor);

  g.font = `bold ${fontMain}px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  if (big) {
    // 部隊大標:底色框
    const w = g.measureText(text).width + 36;
    g.fillStyle = 'rgba(8,12,20,0.72)';
    g.strokeStyle = SIDE_CSS[side];
    g.lineWidth = 2.5;
    roundRect(g, 256 - w / 2, 6, w, fontMain + 18, 6);
    g.fill();
    g.stroke();
  } else {
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 6;
  }

  g.fillStyle = big ? '#f3efe4' : SIDE_CSS[side];
  g.fillText(text, 256, big ? fontMain / 2 + 15 : 26);

  if (sub) {
    g.font = `${fontSub}px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`;
    g.fillStyle = SIDE_CSS[side];
    g.fillText(sub, 256, fontMain + 38);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  );
  const h = big ? 46 : 30;
  sp.scale.set(h * (c.width / c.height), h, 1);
  sp.renderOrder = 10;
  return sp;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
