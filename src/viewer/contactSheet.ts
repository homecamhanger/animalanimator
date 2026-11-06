/**
 * contactSheet.ts — composes the "weight × pose" study sheet: a labelled
 * grid of rendered kitten stills, exported as one printable PNG.
 *
 * The viewer renders each cell (3D → transparent canvas); this module does
 * the pure 2D composition: cards, labels, header and footer.
 */

import { fakeKilograms, bodyCondition, type PoseId } from '../animal/profiles';

export interface SheetCell {
  pose: PoseId;
  weight: number;
  weightName: string;
  canvas: HTMLCanvasElement;
}

const SHEET = {
  cell: 320,
  gap: 22,
  margin: 56,
  headerH: 128,
  colHeaderH: 96,
  rowLabelW: 176,
  footerH: 96,
};

export function sheetDimensions(columns: number, rows: number): { width: number; height: number } {
  const gridW = columns * SHEET.cell + (columns - 1) * SHEET.gap;
  const gridH = rows * SHEET.cell + (rows - 1) * SHEET.gap;
  return {
    width: SHEET.margin * 2 + SHEET.rowLabelW + gridW,
    height: SHEET.margin + SHEET.headerH + SHEET.colHeaderH + gridH + SHEET.footerH,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function composeContactSheet(
  cells: SheetCell[],
  columns: Array<{ weight: number; name: string }>,
  rows: Array<{ pose: PoseId; label: string }>,
  title: string,
  subtitle: string,
): HTMLCanvasElement {
  const { width, height } = sheetDimensions(columns.length, rows.length);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Page background
  ctx.fillStyle = '#16120f';
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, -height * 0.25, 80, width / 2, -height * 0.25, height);
  glow.addColorStop(0, 'rgba(226,166,63,0.14)');
  glow.addColorStop(1, 'rgba(226,166,63,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const gridLeft = SHEET.margin + SHEET.rowLabelW;
  const gridTop = SHEET.margin + SHEET.headerH + SHEET.colHeaderH;

  /* ------------------------------ Header ------------------------------ */
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ece5d8';
  ctx.font = 'italic 600 54px Georgia, "Times New Roman", serif';
  ctx.fillText(title, SHEET.margin, SHEET.margin + 46);
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#a89c8d';
  ctx.fillText(subtitle.toUpperCase(), SHEET.margin, SHEET.margin + 78);

  const dateText = new Date().toISOString().slice(0, 10);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6f655a';
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(dateText, width - SHEET.margin, SHEET.margin + 30);
  ctx.fillStyle = '#e2a63f';
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('ANIMALANIMATOR', width - SHEET.margin, SHEET.margin + 50);
  ctx.textAlign = 'left';

  // Accent rule under the title
  ctx.fillStyle = '#e2a63f';
  ctx.fillRect(SHEET.margin, SHEET.margin + 96, 84, 3);

  /* --------------------------- Column headers -------------------------- */
  columns.forEach((column, colIndex) => {
    const x = gridLeft + colIndex * (SHEET.cell + SHEET.gap) + SHEET.cell / 2;
    const kg = fakeKilograms(column.weight);
    const { bcs, ideal } = bodyCondition(column.weight);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ece5d8';
    ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(column.name.toUpperCase(), x, SHEET.margin + SHEET.headerH + 26);
    ctx.fillStyle = '#a89c8d';
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${kg.toFixed(1)} KG · BCS ${bcs}/9`, x, SHEET.margin + SHEET.headerH + 46);
    if (ideal) {
      const tag = 'IDEAL';
      const tagW = 44;
      roundRect(ctx, x - tagW / 2, SHEET.margin + SHEET.headerH + 56, tagW, 17, 8);
      ctx.fillStyle = 'rgba(132,201,138,0.16)';
      ctx.fill();
      ctx.fillStyle = '#84c98a';
      ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(tag, x, SHEET.margin + SHEET.headerH + 68);
    }
    ctx.textAlign = 'left';
  });

  /* ------------------------------ Cells -------------------------------- */
  rows.forEach((row, rowIndex) => {
    const y = gridTop + rowIndex * (SHEET.cell + SHEET.gap);
    // Row label
    ctx.fillStyle = '#ece5d8';
    ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(row.label.toUpperCase(), SHEET.margin, y + SHEET.cell / 2 - 4);
    ctx.fillStyle = '#6f655a';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`0${rowIndex + 1}`, SHEET.margin, y + SHEET.cell / 2 + 16);

    columns.forEach((column, colIndex) => {
      const x = gridLeft + colIndex * (SHEET.cell + SHEET.gap);
      const cell = cells.find(
        (candidate) => candidate.pose === row.pose && candidate.weight === column.weight,
      );
      // Card
      roundRect(ctx, x, y, SHEET.cell, SHEET.cell, 18);
      const cardGradient = ctx.createRadialGradient(
        x + SHEET.cell / 2,
        y + SHEET.cell * 0.36,
        20,
        x + SHEET.cell / 2,
        y + SHEET.cell * 0.52,
        SHEET.cell * 0.85,
      );
      cardGradient.addColorStop(0, '#2c2620');
      cardGradient.addColorStop(1, '#1e1a16');
      ctx.fillStyle = cardGradient;
      ctx.fill();
      ctx.strokeStyle = 'rgba(236,229,216,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Clipped kitten render
      if (cell) {
        ctx.save();
        roundRect(ctx, x, y, SHEET.cell, SHEET.cell, 18);
        ctx.clip();
        const renderSize = cell.canvas.width;
        ctx.drawImage(cell.canvas, 0, 0, renderSize, renderSize, x, y, SHEET.cell, SHEET.cell);
        ctx.restore();
      }
    });
  });

  /* ------------------------------ Footer ------------------------------- */
  const footerY = height - SHEET.footerH / 2;
  ctx.strokeStyle = 'rgba(236,229,216,0.08)';
  ctx.beginPath();
  ctx.moveTo(SHEET.margin, height - SHEET.footerH);
  ctx.lineTo(width - SHEET.margin, height - SHEET.footerH);
  ctx.stroke();
  ctx.fillStyle = '#6f655a';
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    'GEOMETRY GENERATED AT RUNTIME · ZERO MESH FILES · ANIMALANIMATOR',
    SHEET.margin,
    footerY + 4,
  );
  ctx.textAlign = 'right';
  ctx.fillText('WEIGHT × POSE STUDY', width - SHEET.margin, footerY + 4);
  ctx.textAlign = 'left';

  return canvas;
}
