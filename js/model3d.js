// 3D GLB Model → Sprite Renderer using Three.js
class Model3DRenderer {
  constructor() {
    this.scene = null;
    this.camera = null;   // perspective, used for interactive preview
    this.controls = null; // OrbitControls
    this.renderer = null;
    this.model = null;
    this.mixer = null;
    this.clock = null;
    this.animActions = [];
    this.currentAnimIdx = 0;
    this.animFrame = 0;
    this.totalAnimFrames = 0;
    this.isPlaying = false;
    this._rafId = null;
    this.renderedSprites = [];

    // Pose mode
    this.poseMode = false;
    this.bones = [];
    this.skeleton = null;
    this.boneOriginalQuaternions = new Map();
    this.selectedBone = null;
    this._boneDragging = false;
    this._boneDragStart = null;
    this._boneStartWorldQ = null;
    this._boneStartLocalQ = null;
    this.boneOverlayCanvas = null;
    this.boneOverlayCtx = null;

    this.previewCanvas = document.getElementById('model-preview-canvas');
    this.hint = document.getElementById('model-hint');
    this.renderBtn = document.getElementById('render-sprites-btn');
    this.importBtn = document.getElementById('import-to-editor-btn');
    this.renderGrid = document.getElementById('render-grid');

    this._initThree();
    this._bindUI();
    this._initBoneOverlay();
    this._initBoneInteraction();
  }

  _initThree() {
    if (typeof THREE === 'undefined') {
      console.error('Three.js not loaded');
      return;
    }
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();

    // Perspective camera for interactive preview
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this._setCameraToPreset('isometric');

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.previewCanvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._resizeRenderer();

    // OrbitControls — mouse drag / touch rotate, pinch zoom, two-finger pan
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.target.set(0, 0.5, 0);
      this.controls.minDistance = 1;
      this.controls.maxDistance = 30;
      this.controls.update();
    }

    // Lighting
    this._applyLighting('standard');

    // Start preview render loop
    this._previewLoop();
  }

  _resizeRenderer() {
    const area = document.getElementById('model-preview-area');
    const w = area.clientWidth || 600;
    const h = area.clientHeight || 400;
    this.renderer.setSize(w, h);
    if (this.camera && this.camera.isPerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.controls) this.controls.update();
    if (this.boneOverlayCanvas) {
      const pr = window.devicePixelRatio || 1;
      this.boneOverlayCanvas.width = Math.floor(w * pr);
      this.boneOverlayCanvas.height = Math.floor(h * pr);
      this.boneOverlayCanvas.style.width = w + 'px';
      this.boneOverlayCanvas.style.height = h + 'px';
      this.boneOverlayCtx = this.boneOverlayCanvas.getContext('2d');
    }
  }

  // Returns {elevation, azimuth, distance} for a named preset
  _presetAngles(preset) {
    const elev = +document.getElementById('camera-elev').value;
    const dist = +document.getElementById('camera-dist').value;
    switch(preset) {
      case 'isometric': return { elevation: 35.264, azimuth: 45,  distance: 5 };
      case 'top-down':  return { elevation: 80,     azimuth: 0,   distance: 5 };
      case 'side':      return { elevation: 5,      azimuth: 90,  distance: 5 };
      case '3quarter':  return { elevation: 30,     azimuth: 30,  distance: 5 };
      case 'custom':    return { elevation: elev,   azimuth: 0,   distance: dist };
      default:          return { elevation: 35.264, azimuth: 45,  distance: 5 };
    }
  }

  // Move perspective camera to preset position and sync OrbitControls
  _setCameraToPreset(preset) {
    if (!this.camera) return;
    const { elevation, azimuth, distance } = this._presetAngles(preset || 'isometric');
    const elevRad = elevation * Math.PI / 180;
    const azRad   = azimuth   * Math.PI / 180;
    const target = new THREE.Vector3(0, 0.5, 0);

    this.camera.position.set(
      target.x + distance * Math.cos(elevRad) * Math.sin(azRad),
      target.y + distance * Math.sin(elevRad),
      target.z + distance * Math.cos(elevRad) * Math.cos(azRad)
    );
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();

    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }

    if (this.model) this._frameModel();
  }

  // Legacy alias used elsewhere
  _applyCamera(preset) { this._setCameraToPreset(preset); }

  // Auto-fit camera distance and target to the loaded model's bounding sphere
  _frameModel() {
    if (!this.model || !this.camera || !this.controls) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const r = Math.max(sphere.radius, 0.1);
    const halfFovRad = (this.camera.fov / 2) * Math.PI / 180;
    const dist = (r / Math.sin(halfFovRad)) * 1.25;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.controls.minDistance = r * 0.05;
    this.controls.maxDistance = dist * 10;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  _applyLighting(preset) {
    // Remove existing lights
    this.scene.children.filter(c => c.isLight).forEach(l => this.scene.remove(l));

    switch(preset) {
      case 'standard': {
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        const dir = new THREE.DirectionalLight(0xffffff, 1.0);
        dir.position.set(5, 10, 5);
        dir.castShadow = true;
        this.scene.add(ambient, dir);
        break;
      }
      case 'soft': {
        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        const h = new THREE.HemisphereLight(0xffeeb1, 0x080820, 0.8);
        this.scene.add(ambient, h);
        break;
      }
      case 'hard': {
        const ambient = new THREE.AmbientLight(0x111111, 1);
        const dir = new THREE.DirectionalLight(0xffffff, 2.0);
        dir.position.set(3, 8, 2);
        dir.castShadow = true;
        this.scene.add(ambient, dir);
        break;
      }
      case 'flat': {
        const ambient = new THREE.AmbientLight(0xffffff, 2.0);
        this.scene.add(ambient);
        break;
      }
    }
  }

  getCameraAzimuth() {
    if (!this.camera) return 0;
    const target = this.controls ? this.controls.target.clone() : new THREE.Vector3(0, 0.5, 0);
    const pos = this.camera.position.clone().sub(target);
    return Math.atan2(pos.x, pos.z) * 180 / Math.PI;
  }

  getCameraElevation() {
    if (!this.camera) return 35;
    const target = this.controls ? this.controls.target.clone() : new THREE.Vector3(0, 0.5, 0);
    const pos = this.camera.position.clone().sub(target);
    const dist = pos.length();
    return Math.asin(Math.max(-1, Math.min(1, pos.y / (dist || 1)))) * 180 / Math.PI;
  }

  _previewLoop() {
    const loop = () => {
      this._rafId = requestAnimationFrame(loop);
      const delta = this.clock.getDelta();
      if (this.mixer) this.mixer.update(delta);
      if (this.controls) this.controls.update();
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      this._drawBoneOverlay();
    };
    loop();
  }

  _showLoading(msg) {
    const el = document.getElementById('model-loading');
    document.getElementById('model-load-status').textContent = msg || '';
    el.classList.add('visible');
  }

  _hideLoading() {
    document.getElementById('model-loading').classList.remove('visible');
  }

  _showHint(msg, isError) {
    this.hint.textContent = msg;
    this.hint.style.color = isError ? '#e05555' : '';
    this.hint.style.display = '';
  }

  loadModel(file) {
    if (typeof THREE === 'undefined') {
      this._showHint('Three.js failed to load. Check network and reload.', true);
      return;
    }
    if (typeof THREE.GLTFLoader === 'undefined') {
      this._showHint('GLTFLoader failed to load. Check network and reload.', true);
      return;
    }

    this._showLoading('Reading file…');
    const url = URL.createObjectURL(file);
    const loader = new THREE.GLTFLoader();

    loader.load(
      url,
      gltf => {
        this._hideLoading();
        if (this.model) this.scene.remove(this.model);
        this.model = gltf.scene;

        // Center and normalize scale
        const box = new THREE.Box3().setFromObject(this.model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2 / maxDim;
        this.model.scale.setScalar(scale);
        // Recompute center after scaling
        this.model.position.set(
          -center.x * scale,
          -center.y * scale + (size.y * scale) / 2,
          -center.z * scale
        );
        this.scene.add(this.model);

        // Detect skeleton for pose mode
        this.bones = [];
        this.skeleton = null;
        this.boneOriginalQuaternions = new Map();
        this.model.traverse(child => {
          if (child.isSkinnedMesh && child.skeleton && !this.skeleton) {
            this.skeleton = child.skeleton;
            this.bones = [...child.skeleton.bones];
          }
        });
        if (this.bones.length > 0) {
          this.boneOriginalQuaternions = new Map(
            this.bones.map(b => [b.uuid, b.quaternion.clone()])
          );
          document.getElementById('pose-mode-section').style.display = '';
        } else {
          document.getElementById('pose-mode-section').style.display = 'none';
          if (this.poseMode) this._exitPoseMode();
        }

        // Animations
        this.mixer = new THREE.AnimationMixer(this.model);
        this.animActions = (gltf.animations || []).map(clip => this.mixer.clipAction(clip));

        if (this.animActions.length > 0) {
          this.totalAnimFrames = Math.round(this.animActions[0].getClip().duration * 30);
          const slider = document.getElementById('anim-frame-slider');
          slider.max = this.totalAnimFrames; slider.disabled = false;
          document.getElementById('anim-play-btn').disabled = false;
          document.getElementById('anim-frame-info').textContent =
            `${this.animActions.length} animation(s), ${this.totalAnimFrames} frames`;
        } else {
          document.getElementById('anim-frame-info').textContent = 'No animation';
          document.getElementById('anim-frame-slider').disabled = true;
          document.getElementById('anim-play-btn').disabled = true;
        }

        this.hint.style.display = 'none';
        this.renderBtn.disabled = false;
        this._frameModel();
        URL.revokeObjectURL(url);
      },
      xhr => {
        if (xhr.total) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          document.getElementById('model-load-status').textContent = `${pct}%`;
        } else {
          document.getElementById('model-load-status').textContent =
            `${(xhr.loaded / 1024).toFixed(0)} KB…`;
        }
      },
      err => {
        this._hideLoading();
        URL.revokeObjectURL(url);
        const msg = err && err.message ? err.message : String(err);
        console.error('GLB load error:', msg);
        this._showHint('Failed to load: ' + msg, true);
      }
    );
  }

  renderSprites() {
    if (!this.model) return;
    const w = +document.getElementById('sprite-w').value;
    const h = +document.getElementById('sprite-h').value;
    const dirs = +document.querySelector('input[name="dirs"]:checked').value;
    const framesPerDir = +document.getElementById('frames-per-dir').value;
    const bgMode = document.querySelector('input[name="bg"]:checked').value;
    const bgColor = document.getElementById('render-bg-color').value;

    let overrideElev = null, overrideDist = null;
    const dirAngles = dirs === 8
      ? [0, 45, 90, 135, 180, 225, 270, 315]
      : dirs === 4
      ? [0, 90, 180, 270]
      : (() => {
          const capmode = (document.querySelector('input[name="capmode"]:checked') || {}).value || 'view';
          if (capmode === 'view') {
            overrideElev = this.getCameraElevation();
            const tgt = this.controls ? this.controls.target : new THREE.Vector3(0, 0.5, 0);
            overrideDist = this.camera.position.distanceTo(tgt);
            return [this.getCameraAzimuth()];
          } else {
            overrideElev = +document.getElementById('cap-elevation').value;
            return [+document.getElementById('cap-azimuth').value];
          }
        })();

    const dirNames = {
      1: ['S'],
      4: ['S','E','N','W'],
      8: ['S','SE','E','NE','N','NW','W','SW']
    };

    this.renderedSprites = [];
    this.renderGrid.innerHTML = '';

    // Offscreen renderer
    const offCanvas = document.createElement('canvas');
    offCanvas.width = w; offCanvas.height = h;
    const offRenderer = new THREE.WebGLRenderer({
      canvas: offCanvas, antialias: false, alpha: true,
      preserveDrawingBuffer: true
    });
    offRenderer.setSize(w, h, false);
    offRenderer.setPixelRatio(1);

    // Setup offscreen orthographic camera (independent of preview camera)
    const cameraPreset = document.getElementById('camera-preset').value;
    const { elevation: baseElev } = this._presetAngles(cameraPreset);
    const elevation = overrideElev !== null ? overrideElev : baseElev;
    const elevRad = elevation * Math.PI / 180;
    const aspect = w / h;

    // Auto-size frustum from model bounding sphere so any model fits
    const _box = new THREE.Box3().setFromObject(this.model);
    const _sphere = new THREE.Sphere();
    _box.getBoundingSphere(_sphere);
    const modelCenter = _sphere.center;
    const s = _sphere.radius * 1.2;
    const renderDist = Math.max(_sphere.radius * 6, 10);
    const offCamera = new THREE.OrthographicCamera(-s * aspect, s * aspect, s, -s, 0.01, renderDist * 2 + _sphere.radius * 2);

    // Apply lighting to scene
    this._applyLighting(document.getElementById('lighting-preset').value);

    dirAngles.forEach((dirAngle, di) => {
      const baseAzRad = dirAngle * Math.PI / 180;

      for (let fi = 0; fi < framesPerDir; fi++) {
        // Set animation time
        if (this.mixer && this.animActions.length > 0) {
          const t = (fi / framesPerDir) * this.animActions[0].getClip().duration;
          this.mixer.setTime(t);
        }

        // Position camera around model center
        const azRad = baseAzRad;
        offCamera.position.set(
          modelCenter.x + renderDist * Math.cos(elevRad) * Math.sin(azRad),
          modelCenter.y + renderDist * Math.sin(elevRad),
          modelCenter.z + renderDist * Math.cos(elevRad) * Math.cos(azRad)
        );
        offCamera.lookAt(modelCenter);
        offCamera.updateProjectionMatrix();

        // Set background
        if (bgMode === 'transparent') {
          offRenderer.setClearColor(0x000000, 0);
        } else {
          const c = new THREE.Color(bgColor);
          offRenderer.setClearColor(c, 1);
        }

        offRenderer.render(this.scene, offCamera);

        // Grab pixels via WebGL readPixels (renderer uses WebGL context)
        const imageData = this._getRendererPixels(offRenderer, w, h);

        this.renderedSprites.push({
          dir: dirAngles[di],
          dirName: (dirNames[dirs] || ['?'])[di] || di,
          frame: fi,
          imageData,
          width: w,
          height: h
        });

        // Add to grid
        this._addSpriteCard(imageData, w, h, (dirNames[dirs]||['?'])[di]||di, fi, framesPerDir);
      }
    });

    this.importBtn.disabled = false;
    offRenderer.dispose();
  }

  _getRendererPixels(renderer, w, h) {
    // Use 2D canvas drawImage — more reliable than gl.readPixels across devices
    const canvas2d = document.createElement('canvas');
    canvas2d.width = w;
    canvas2d.height = h;
    const ctx2d = canvas2d.getContext('2d');
    ctx2d.drawImage(renderer.domElement, 0, 0, w, h);
    return ctx2d.getImageData(0, 0, w, h);
  }

  _addSpriteCard(imageData, w, h, dirName, frameIdx, totalFrames) {
    const card = document.createElement('div');
    card.className = 'render-sprite-card';

    const canvas = document.createElement('canvas');
    const displaySize = Math.max(64, Math.min(128, 128));
    canvas.width = w; canvas.height = h;
    canvas.style.width = displaySize+'px';
    canvas.style.height = displaySize+'px';
    canvas.getContext('2d').putImageData(imageData, 0, 0);

    const label = document.createElement('span');
    label.textContent = totalFrames > 1
      ? `${dirName} f${frameIdx+1}`
      : `Dir: ${dirName}`;

    card.appendChild(canvas);
    card.appendChild(label);
    this.renderGrid.appendChild(card);
  }

  importToEditor(layerMgr, timeline, canvasEngine) {
    if (this.renderedSprites.length === 0) return;

    const { width, height } = this.renderedSprites[0];

    // Group sprites by direction name
    const byDir = {};
    this.renderedSprites.forEach(s => {
      if (!byDir[s.dirName]) byDir[s.dirName] = [];
      byDir[s.dirName].push(s);
    });
    const dirs = Object.keys(byDir);
    const maxFrames = Math.max(...dirs.map(d => byDir[d].length));

    if (timeline.playing) timeline.pause();

    // Resize canvas if needed (preserves existing content top-left)
    if (layerMgr.width !== width || layerMgr.height !== height) {
      layerMgr.resize(width, height);
      canvasEngine.reinit(width, height);
    }

    // Ensure enough animation frames
    while (timeline.frameCount < maxFrames) {
      layerMgr.frameCount++;
      layerMgr.layers.forEach(l => l.frames.push(new ImageData(width, height)));
      timeline.frameDurations.push(Math.round(1000 / timeline.fps));
    }
    timeline.currentFrame = 0;

    // Add each direction as a NEW layer on top of existing layers
    // Iterate in reverse so direction 0 ends up on top
    dirs.slice().reverse().forEach(dirName => {
      const layer = {
        id: layerMgr._mkId(),
        name: `3D ${dirName}`,
        visible: true,
        opacity: 100,
        locked: false,
        frames: Array.from({length: layerMgr.frameCount}, () => new ImageData(width, height))
      };
      byDir[dirName].forEach((sprite, fi) => {
        if (fi < layer.frames.length) layer.frames[fi] = sprite.imageData;
      });
      layerMgr.layers.unshift(layer);
    });
    layerMgr.activeIdx = 0;

    // Render everything
    layerMgr.renderUI();
    canvasEngine.render();
    canvasEngine.renderThumbs();
    timeline.render();

    // Switch to editor then re-fit so the new canvas fills the viewport
    document.getElementById('tab-editor').click();
    requestAnimationFrame(() => {
      canvasEngine.fitToWindow();
      canvasEngine.render();
    });
  }

  _setCameraFromUI() {
    const preset = document.getElementById('camera-preset').value;
    this._setCameraToPreset(preset);
  }

  _initBoneOverlay() {
    this.boneOverlayCanvas = document.getElementById('bone-overlay-canvas');
    if (this.boneOverlayCanvas) {
      this.boneOverlayCtx = this.boneOverlayCanvas.getContext('2d');
    }
  }

  _initBoneInteraction() {
    const canvas = this.previewCanvas;

    // Helper: get canvas-pixel coords from a mouse or touch event
    const cvPos = e => {
      const rect = canvas.getBoundingClientRect();
      const pr = window.devicePixelRatio || 1;
      const cx = (e.clientX !== undefined ? e.clientX : e.touches[0].clientX);
      const cy = (e.clientY !== undefined ? e.clientY : e.touches[0].clientY);
      return { x: (cx - rect.left) * pr, y: (cy - rect.top) * pr };
    };

    const startDrag = (e, pos) => {
      if (!this.poseMode) return false;
      const bone = this._findNearestBone(pos.x, pos.y);
      if (!bone) return false;
      e.stopPropagation();
      this._selectBone(bone);
      this._boneDragging = true;
      this._boneDragStart = pos;
      this._boneStartWorldQ = new THREE.Quaternion();
      bone.getWorldQuaternion(this._boneStartWorldQ);
      return true;
    };

    const moveDrag = (e, pos) => {
      if (!this.poseMode || !this._boneDragging) return;
      e.stopPropagation();
      this._rotateBoneByDrag(pos.x, pos.y);
      this._updateBoneSliders();
    };

    const endDrag = e => {
      if (!this.poseMode || !this._boneDragging) return;
      e.stopPropagation();
      this._boneDragging = false;
      canvas.style.cursor = '';
    };

    canvas.addEventListener('mousedown', e => {
      const p = cvPos(e);
      if (startDrag(e, p)) canvas.style.cursor = 'grabbing';
    }, true);
    canvas.addEventListener('mousemove', e => moveDrag(e, cvPos(e)), true);
    canvas.addEventListener('mouseup', e => endDrag(e), true);

    canvas.addEventListener('touchstart', e => {
      startDrag(e, cvPos(e.touches[0]));
    }, true);
    canvas.addEventListener('touchmove', e => {
      if (this._boneDragging) moveDrag(e, cvPos(e.touches[0]));
    }, true);
    canvas.addEventListener('touchend', e => endDrag(e), true);
  }

  _enterPoseMode() {
    this.poseMode = true;
    document.getElementById('bone-overlay-canvas').style.display = '';
    document.getElementById('pose-controls').style.display = 'flex';
    document.getElementById('pose-toggle-btn').textContent = '✕ Exit Pose Mode';
    document.getElementById('pose-toggle-btn').classList.add('active');
    document.getElementById('pose-hint').style.display = '';
    document.getElementById('orbit-hint').style.display = 'none';
    this._buildBoneList();
  }

  _exitPoseMode() {
    this.poseMode = false;
    this.selectedBone = null;
    this._boneDragging = false;
    document.getElementById('bone-overlay-canvas').style.display = 'none';
    if (this.boneOverlayCtx) {
      const c = this.boneOverlayCanvas;
      this.boneOverlayCtx.clearRect(0, 0, c.width, c.height);
    }
    document.getElementById('pose-controls').style.display = 'none';
    document.getElementById('pose-toggle-btn').textContent = '⚙ Pose Mode';
    document.getElementById('pose-toggle-btn').classList.remove('active');
    document.getElementById('pose-hint').style.display = 'none';
    document.getElementById('orbit-hint').style.display = '';
  }

  _drawBoneOverlay() {
    if (!this.poseMode || !this.boneOverlayCtx || !this.bones.length) return;
    const ctx = this.boneOverlayCtx;
    const c = this.boneOverlayCanvas;
    ctx.clearRect(0, 0, c.width, c.height);

    // Draw bone connection lines
    ctx.lineWidth = 1.5;
    this.bones.forEach(bone => {
      if (!bone.parent || !bone.parent.isBone) return;
      const p1 = this._boneToScreen(bone.parent);
      const p2 = this._boneToScreen(bone);
      if (!p1 || !p2) return;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = 'rgba(255,215,50,0.45)';
      ctx.stroke();
    });

    // Draw bone joints (selected on top)
    const drawJoint = (bone, isSelected) => {
      const p = this._boneToScreen(bone);
      if (!p) return;
      const r = isSelected ? 8 : 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#ff5555' : 'rgba(255,215,50,0.85)';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(180,130,0,0.9)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();
    };

    this.bones.forEach(b => { if (b !== this.selectedBone) drawJoint(b, false); });
    if (this.selectedBone) {
      drawJoint(this.selectedBone, true);
      // Label
      const p = this._boneToScreen(this.selectedBone);
      if (p) {
        ctx.font = `${11 * (window.devicePixelRatio || 1)}px monospace`;
        const label = this.selectedBone.name;
        const tw = ctx.measureText(label).width;
        const pr = window.devicePixelRatio || 1;
        const pad = 5 * pr;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(p.x + 12 * pr, p.y - 9 * pr, tw + pad * 2, 16 * pr);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, p.x + 12 * pr + pad, p.y + 4 * pr);
      }
    }
  }

  _boneToScreen(bone) {
    if (!this.camera || !this.boneOverlayCanvas) return null;
    const pos = new THREE.Vector3();
    bone.getWorldPosition(pos);
    pos.project(this.camera);
    if (pos.z > 1) return null; // clipped
    const c = this.boneOverlayCanvas;
    return {
      x: (pos.x + 1) / 2 * c.width,
      y: (-pos.y + 1) / 2 * c.height
    };
  }

  _findNearestBone(sx, sy, radius) {
    radius = radius || (14 * (window.devicePixelRatio || 1));
    let best = null, bestDist = radius;
    this.bones.forEach(bone => {
      const p = this._boneToScreen(bone);
      if (!p) return;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestDist) { bestDist = d; best = bone; }
    });
    return best;
  }

  _selectBone(bone) {
    this.selectedBone = bone;
    document.querySelectorAll('.bone-item').forEach(el => {
      el.classList.toggle('active', el.dataset.uuid === bone.uuid);
    });
    document.getElementById('selected-bone-name').textContent = bone.name || '(bone)';
    document.getElementById('selected-bone-panel').style.display = 'flex';
    this._updateBoneSliders();
    // Scroll into view in list
    const el = document.querySelector(`.bone-item[data-uuid="${bone.uuid}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  _updateBoneSliders() {
    if (!this.selectedBone) return;
    const r = this.selectedBone.rotation;
    const deg = v => Math.round(v * 180 / Math.PI);
    ['x','y','z'].forEach(axis => {
      const val = deg(r[axis]);
      document.getElementById(`bone-rot-${axis}`).value = val;
      document.getElementById(`bone-rot-${axis}-val`).textContent = val + '°';
    });
  }

  _buildBoneList() {
    const list = document.getElementById('bone-list');
    list.innerHTML = '';
    const depthOf = bone => {
      let d = 0, b = bone;
      while (b.parent && b.parent.isBone) { d++; b = b.parent; }
      return Math.min(d, 5);
    };
    this.bones.forEach(bone => {
      const item = document.createElement('div');
      item.className = 'bone-item';
      item.dataset.uuid = bone.uuid;
      item.style.paddingLeft = (8 + depthOf(bone) * 8) + 'px';
      item.textContent = bone.name || '(bone)';
      item.title = bone.name;
      item.addEventListener('click', () => this._selectBone(bone));
      list.appendChild(item);
    });
  }

  _rotateBoneByDrag(x, y) {
    if (!this.selectedBone || !this._boneDragStart || !this._boneStartWorldQ) return;
    const sensitivity = 0.006;
    const dx = (x - this._boneDragStart.x) * sensitivity;
    const dy = (y - this._boneDragStart.y) * sensitivity;

    // Rotate in camera/screen space: dx → camera-up axis, dy → camera-right axis
    const camQ = this.camera.quaternion;
    const worldUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(camQ).normalize();
    const worldRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camQ).normalize();

    const qDelta = new THREE.Quaternion()
      .setFromAxisAngle(worldUp, dx)
      .premultiply(new THREE.Quaternion().setFromAxisAngle(worldRight, -dy));

    const newWorldQ = qDelta.clone().multiply(this._boneStartWorldQ);

    const bone = this.selectedBone;
    if (bone.parent) {
      const parentWorldQ = new THREE.Quaternion();
      bone.parent.getWorldQuaternion(parentWorldQ);
      bone.quaternion.copy(parentWorldQ.clone().invert().multiply(newWorldQ));
    } else {
      bone.quaternion.copy(newWorldQ);
    }
    bone.updateMatrixWorld(true);
  }

  _resetPose() {
    this.bones.forEach(bone => {
      const orig = this.boneOriginalQuaternions.get(bone.uuid);
      if (orig) {
        bone.quaternion.copy(orig);
        bone.updateMatrixWorld(true);
      }
    });
    if (this.selectedBone) this._updateBoneSliders();
  }

  _bindUI() {
    // File drop zone
    const dropZone = document.getElementById('model-drop-zone');
    const fileInput = document.getElementById('model-file-input');
    const browseBtn = document.getElementById('model-browse');

    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) this.loadModel(fileInput.files[0]);
    });

    dropZone.addEventListener('dragover', e => {
      e.preventDefault(); dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
        this.loadModel(file);
      } else {
        alert('Please drop a .glb or .gltf file.');
      }
    });

    // Camera preset
    document.getElementById('camera-preset').addEventListener('change', () => {
      const preset = document.getElementById('camera-preset').value;
      document.getElementById('custom-camera-controls').style.display =
        preset === 'custom' ? 'flex' : 'none';
      this._setCameraFromUI();
    });
    document.getElementById('custom-camera-controls').style.display = 'none';

    // Reset view button
    document.getElementById('reset-view-btn').addEventListener('click', () => {
      this._setCameraFromUI();
    });

    // Frame model button — re-fit camera to model bounds at any time
    document.getElementById('frame-model-btn').addEventListener('click', () => {
      this._frameModel();
    });

    // Custom camera sliders
    ['camera-elev','camera-dist','camera-zoom'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        document.getElementById('elev-val').textContent = document.getElementById('camera-elev').value;
        document.getElementById('dist-val').textContent = document.getElementById('camera-dist').value;
        document.getElementById('zoom-val').textContent = (document.getElementById('camera-zoom').value/10).toFixed(1);
        this._setCameraFromUI();
      });
    });

    // Lighting
    document.getElementById('lighting-preset').addEventListener('change', () => {
      this._applyLighting(document.getElementById('lighting-preset').value);
    });

    // Single direction controls: show/hide based on dirs selection
    document.querySelectorAll('input[name="dirs"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('single-dir-controls').style.display =
          radio.value === '1' && radio.checked ? '' : 'none';
      });
    });

    // Capture mode radios: show/hide custom angle sliders
    document.querySelectorAll('input[name="capmode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('single-custom-angles').style.display =
          radio.value === 'custom' && radio.checked ? 'flex' : 'none';
      });
    });

    // Custom angle sliders: update value displays
    document.getElementById('cap-azimuth').addEventListener('input', e => {
      document.getElementById('cap-az-val').textContent = e.target.value;
    });
    document.getElementById('cap-elevation').addEventListener('input', e => {
      document.getElementById('cap-elev-val').textContent = e.target.value;
    });

    // Copy current view → angle sliders
    document.getElementById('copy-view-btn').addEventListener('click', () => {
      const az = Math.round(((this.getCameraAzimuth() % 360) + 360) % 360);
      const el = Math.round(this.getCameraElevation());
      document.getElementById('cap-azimuth').value = az;
      document.getElementById('cap-az-val').textContent = az;
      document.getElementById('cap-elevation').value = el;
      document.getElementById('cap-elev-val').textContent = el;
      // Switch to custom mode
      const customRadio = document.querySelector('input[name="capmode"][value="custom"]');
      if (customRadio) { customRadio.checked = true; customRadio.dispatchEvent(new Event('change')); }
    });

    // Render button
    this.renderBtn.addEventListener('click', () => this.renderSprites());

    // Render background color visibility
    document.querySelectorAll('input[name="bg"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('render-bg-color').style.display =
          radio.value === 'color' ? 'block' : 'none';
      });
    });
    document.getElementById('render-bg-color').style.display = 'none';

    // Animation slider
    document.getElementById('anim-frame-slider').addEventListener('input', e => {
      if (!this.mixer || !this.animActions.length) return;
      const t = (+e.target.value / this.totalAnimFrames) * this.animActions[0].getClip().duration;
      this.mixer.setTime(t);
    });

    // Anim play button
    document.getElementById('anim-play-btn').addEventListener('click', () => {
      if (!this.animActions.length) return;
      if (this.isPlaying) {
        this.animActions.forEach(a => a.paused = true);
        this.isPlaying = false;
        document.getElementById('anim-play-btn').textContent = '▶ Play';
      } else {
        this.animActions.forEach(a => { a.reset(); a.play(); a.paused = false; });
        this.isPlaying = true;
        document.getElementById('anim-play-btn').textContent = '⏸ Pause';
      }
    });

    // Pose mode toggle
    document.getElementById('pose-toggle-btn').addEventListener('click', () => {
      this.poseMode ? this._exitPoseMode() : this._enterPoseMode();
    });

    // Reset pose
    document.getElementById('pose-reset-btn').addEventListener('click', () => this._resetPose());

    // Bone rotation sliders
    ['x','y','z'].forEach(axis => {
      document.getElementById(`bone-rot-${axis}`).addEventListener('input', e => {
        if (!this.selectedBone) return;
        const rad = +e.target.value * Math.PI / 180;
        this.selectedBone.rotation[axis] = rad;
        this.selectedBone.updateMatrixWorld(true);
        document.getElementById(`bone-rot-${axis}-val`).textContent = e.target.value + '°';
      });
    });

    // Resize renderer on window resize
    window.addEventListener('resize', () => this._resizeRenderer());
  }
}
