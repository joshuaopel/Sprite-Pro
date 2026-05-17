// Undo/Redo history manager
class History {
  constructor(maxSteps = 50) {
    this.stack = [];
    this.index = -1;
    this.max = maxSteps;
  }

  // Save a snapshot of all layer ImageData
  push(layers) {
    // Drop redo states
    this.stack.splice(this.index + 1);
    // Serialize each layer's pixel data
    const snapshot = layers.map(l => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      frames: l.frames.map(f => cloneImageData(f))
    }));
    this.stack.push(snapshot);
    if (this.stack.length > this.max) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.stack.length - 1; }

  undo() {
    if (!this.canUndo()) return null;
    this.index--;
    return this._deserialize(this.stack[this.index]);
  }

  redo() {
    if (!this.canRedo()) return null;
    this.index++;
    return this._deserialize(this.stack[this.index]);
  }

  _deserialize(snapshot) {
    return snapshot.map(l => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      frames: l.frames.map(f => cloneImageData(f))
    }));
  }
}
