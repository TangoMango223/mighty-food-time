import { BaseGameScene } from './base.js';

/** DODGE! — survive the falling junk. Arrow keys or drag. */
export class DodgeScene extends BaseGameScene {
  constructor() { super('dodge'); }

  setup() {
    const { width, height } = this.scale;

    this.player = this.add.rectangle(width / 2, height - 50, 44, 44, 0x22e3d6)
      .setStrokeStyle(4, 0x000000);
    this.cursors = this.input.keyboard.createCursorKeys();
    this.blocks = [];
    this.hits = 0;

    // Drag/point to steer, for anyone not on a keyboard.
    this.input.on('pointermove', (p) => { this.player.x = Phaser.Math.Clamp(p.x, 24, width - 24); });

    this.spawner = this.time.addEvent({
      delay: 260,
      loop: true,
      callback: () => {
        const b = this.add.rectangle(
          Phaser.Math.Between(28, width - 28), -20,
          Phaser.Math.Between(24, 44), 24,
          0xff2e88,
        ).setStrokeStyle(3, 0x000000);
        b.speed = Phaser.Math.Between(240, 380) / 60;
        this.blocks.push(b);
      },
    });
  }

  tick() {
    const { width, height } = this.scale;
    const speed = 6;

    if (this.cursors.left.isDown) this.player.x -= speed;
    if (this.cursors.right.isDown) this.player.x += speed;
    this.player.x = Phaser.Math.Clamp(this.player.x, 24, width - 24);

    const playerBounds = this.player.getBounds();

    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      b.y += b.speed * 3;

      if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, b.getBounds())) {
        this.spawner.remove();
        this.cameras.main.shake(200, 0.02);
        this.finish('fail', { reason: 'hit', survivedMs: Math.round(this.time.now - this.startedAt) });
        return;
      }

      if (b.y > height + 30) { b.destroy(); this.blocks.splice(i, 1); }
    }
  }

  onTimeout() {
    this.spawner?.remove();
    this.finish('success', { reason: 'survived' });
  }
}
