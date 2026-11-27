import { ART_PALETTE } from './art-profile.ts';

/** The flower-basket motif shared by Ada’s shop sign and her stamp. */
export function paintAdaFlowerBasket(context: CanvasRenderingContext2D) {
  context.lineCap = 'round';
  context.lineJoin = 'round';

  context.beginPath();
  context.moveTo(145, 175);
  context.bezierCurveTo(145, 16, 365, 16, 367, 175);
  context.lineWidth = 15;
  context.strokeStyle = ART_PALETTE.wood;
  context.stroke();

  for (const [x, y, angle] of [[166, 141, .72], [217, 159, -.48], [300, 144, .68], [347, 154, -.58]]) {
    context.beginPath();
    context.ellipse(x, y, 25, 11, angle, 0, 2 * Math.PI);
    context.fillStyle = ART_PALETTE.leafDark;
    context.fill();
  }
  for (const [x, y, color] of [[177, 109, '#bc624e'], [258, 91, '#cf9341'], [331, 114, '#bc624e']] as const) {
    context.beginPath();
    for (let petal = 0; petal < 5; petal++) {
      const angle = petal * Math.PI * 2 / 5 - Math.PI / 2;
      const px = x + Math.cos(angle) * 15, py = y + Math.sin(angle) * 15;
      context.moveTo(px + 13, py);
      context.arc(px, py, 13, 0, 2 * Math.PI);
    }
    context.fillStyle = color;
    context.fill();
    context.beginPath();
    context.arc(x, y, 9, 0, 2 * Math.PI);
    context.fillStyle = '#fff1cb';
    context.fill();
  }

  context.beginPath();
  context.moveTo(129, 167);
  context.lineTo(383, 167);
  context.lineTo(354, 222);
  context.quadraticCurveTo(348, 233, 334, 234);
  context.lineTo(178, 234);
  context.quadraticCurveTo(164, 233, 158, 222);
  context.closePath();
  context.fillStyle = '#b67b48';
  context.fill();
  context.lineWidth = 9;
  context.strokeStyle = ART_PALETTE.wood;
  context.stroke();
  context.beginPath();
  context.moveTo(171, 194);
  context.lineTo(341, 194);
  context.moveTo(186, 214);
  context.lineTo(326, 214);
  context.lineWidth = 6;
  context.strokeStyle = '#e7b76e';
  context.stroke();
}
