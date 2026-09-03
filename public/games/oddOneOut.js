import { BaseGameScene } from './base.js';

const SETS = [
  { common: '\u{1F355}', odd: '\u{1F354}' }, // pizza / burger
  { common: '\u{1F363}', odd: '\u{1F361}' }, // sushi / dango
  { common: '\u{1F32E}', odd: '\u{1F32F}' }, // taco / burrito
  { common: '\u{1F35C}', odd: '\u{1F35D}' }, // ramen / spaghetti
];

/** ODD ONE OUT! — one of these is not like the others. Click it. */
export class OddOneOutScene extends BaseGameScene {
  setup() {
    const { width, height } = this.scale;
    const set = Phaser.Utils.Array.GetRandom(SETS);

    const cols = 5, rows = 3;
    const oddIndex = Phaser.Math.Between(0, cols * rows - 1);
    const cellW = width / (cols + 1);
    const cellH = (height - 120) / (rows + 0.5);

    for (let i = 0; i < cols * rows; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = cellW * (col + 1);
      const y = 110 + cellH * (row + 0.4);
      const isOdd = i === oddIndex;

      const item = this.add.text(x, y, isOdd ? set.odd : set.common, { fontSize: '46px' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      item.on('pointerdown', () => {
        if (this.settled) return;
        if (isOdd) {
          this.tweens.add({ targets: item, scale: 1.6, duration: 180 });
          this.finish('success', { reason: 'spotted-it' });
        } else {
          this.cameras.main.shake(160, 0.015);
          this.finish('fail', { reason: 'wrong-item' });
        }
      });
    }
  }
}
