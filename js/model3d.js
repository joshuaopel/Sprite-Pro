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
    this._transformControls = null;

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

    // Rotation gizmo for pose mode (hidden until a bone is selected)
    if (typeof THREE.TransformControls !== 'undefined') {
      this._transformControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
      this._transformControls.setMode('rotate');
      this._transformControls.setSpace('local');
      this._transformControls.visible = false;
      this.scene.add(this._transformControls);

      // While dragging the gizmo, disable orbit so the camera stays still
      this._transformControls.addEventListener('dragging-changed', e => {
        if (this.controls) this.controls.enabled = !e.value;
      });

      // Keep sliders in sync as the gizmo rotates the bone
      this._transformControls.addEventListener('objectChange', () => {
        if (this.selectedBone) {
          this.selectedBone.updateMatrixWorld(true);
          this._updateBoneSliders();
        }
      });
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

  // Scale the model by `factor` relative to the normalized 2-unit size.
  // baseScale is only passed the first time (from loadModel); after that
  // the stored this._baseNormScale is reused.
  // Does NOT auto-frame — caller decides whether to frame.
  _applyModelScale(factor, baseScale) {
    if (!this.model || !this._modelCenter || !this._modelSize) return;
    if (baseScale !== undefined) this._baseNormScale = baseScale;
    const s = this._baseNormScale * factor;
    const c = this._modelCenter, sz = this._modelSize;
    this.model.scale.setScalar(s);
    this.model.position.set(
      -c.x * s,
      -c.y * s + (sz.y * s) / 2,
      -c.z * s
    );
    this.model.updateMatrixWorld(true);
  }

  // Auto-fit camera distance and target to the loaded model's bounding sphere.
  // Also updates camera near/far so models of any size are never clipped.
  _frameModel() {
    if (!this.model || !this.camera || !this.controls) return;
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const r = Math.max(sphere.radius, 0.1);
    const halfFovRad = (this.camera.fov / 2) * Math.PI / 180;
    const dist = (r / Math.sin(halfFovRad)) * 1.25;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.001) dir.set(0, 0, 1); // guard against zero vector
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.controls.minDistance = r * 0.05;
    this.controls.maxDistance = dist * 10;
    // Scale near/far dynamically so any model size stays visible
    this.camera.near = Math.max(0.001, r * 0.001);
    this.camera.far = Math.max(1000, dist * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  _applyLighting(preset) {
    this.scene.children.filter(c => c.isLight).forEach(l => this.scene.remove(l));
    this._keyLight = null;
    this._ambientLight = null;
    this._fillLight = null;

    const keyInt  = parseFloat(document.getElementById('light-key-int')?.value  ?? 1.0);
    const ambInt  = parseFloat(document.getElementById('light-ambient')?.value  ?? 0.6);

    switch (preset) {
      case 'standard': {
        this._ambientLight = new THREE.AmbientLight(0xffffff, ambInt);
        this._keyLight = new THREE.DirectionalLight(0xffffff, keyInt);
        this._keyLight.castShadow = true;
        this.scene.add(this._ambientLight, this._keyLight);
        break;
      }
      case 'soft': {
        this._ambientLight = new THREE.AmbientLight(0xffffff, ambInt);
        this._fillLight = new THREE.HemisphereLight(0xffeeb1, 0x080820, keyInt * 0.8);
        this.scene.add(this._ambientLight, this._fillLight);
        break;
      }
      case 'hard': {
        this._ambientLight = new THREE.AmbientLight(0x111111, ambInt * 0.2);
        this._keyLight = new THREE.DirectionalLight(0xffffff, keyInt * 2);
        this._keyLight.castShadow = true;
        this.scene.add(this._ambientLight, this._keyLight);
        break;
      }
      case 'flat': {
        this._ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
        this.scene.add(this._ambientLight);
        break;
      }
    }
    this._updateLightDir();
    const hasDirLight = !!this._keyLight;
    const dirEl = document.getElementById('light-dir-controls');
    if (dirEl) dirEl.style.display = hasDirLight ? '' : 'none';
  }

  _updateLightDir() {
    if (!this._keyLight) return;
    const az = parseFloat(document.getElementById('light-key-az')?.value ?? 45) * Math.PI / 180;
    const el = parseFloat(document.getElementById('light-key-el')?.value ?? 60) * Math.PI / 180;
    const d = 10;
    this._keyLight.position.set(
      d * Math.cos(el) * Math.sin(az),
      d * Math.sin(el),
      d * Math.cos(el) * Math.cos(az)
    );
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
        // Keep near plane proportional to zoom distance so close-up views never clip
        if (this.controls) {
          const camDist = this.camera.position.distanceTo(this.controls.target);
          const dynamicNear = Math.max(0.0001, camDist * 0.001);
          if (Math.abs(this.camera.near - dynamicNear) / dynamicNear > 0.1) {
            this.camera.near = dynamicNear;
            this.camera.updateProjectionMatrix();
          }
        }
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

        // Add to scene first so internal GLTF node transforms (root rotations,
        // Y-up/Z-up corrections, etc.) are included in the bounding box
        this.scene.add(this.model);
        this.model.updateMatrixWorld(true);

        // Compute bounds in world space with all transforms applied
        const box = new THREE.Box3().setFromObject(this.model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        // Store unscaled bounds so the scale slider can rescale from scratch
        this._modelCenter = center.clone();
        this._modelSize = size.clone();

        const baseScale = 2 / maxDim;
        this._applyModelScale(1.0, baseScale);

        // Reset camera and controls to a clean state before framing,
        // so any previous zoom/pan position doesn't carry over
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = 0.01;
        this.controls.maxDistance = 10000;
        this.camera.position.set(0, 2, 5);
        this.camera.near = 0.01;
        this.camera.far = 10000;
        this.camera.updateProjectionMatrix();
        this.controls.update();

        this._frameModel(); // frame AFTER scale + camera reset

        // Reset scale slider to 1×
        const scaleSlider = document.getElementById('model-scale');
        if (scaleSlider) { scaleSlider.value = 0; document.getElementById('model-scale-val').textContent = '1.0×'; }
        document.getElementById('model-scale-section').style.display = '';

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

    // Resize the existing preview renderer to sprite dimensions and render
    // directly to its canvas. This is the only reliable approach for rigged
    // (SkinnedMesh) models: the GL context is the same one the preview uses,
    // so bone textures, shaders, and geometry are already resident. A separate
    // renderer or WebGLRenderTarget both fail because Three.js r134 does not
    // re-upload bone matrix textures across framebuffer boundaries mid-session.
    // preserveDrawingBuffer:true (set at construction) lets us read pixels via
    // drawImage after each render call.
    const area = document.getElementById('model-preview-area');
    const prevW = area.clientWidth || 600;
    const prevH = area.clientHeight || 400;
    const prevNear = this.camera.near;
    const prevFar  = this.camera.far;

    this.renderer.setSize(w, h, false); // false = don't change CSS size
    this.renderer.setPixelRatio(1);     // 1:1 pixel for exact capture

    const cameraPreset = document.getElementById('camera-preset').value;
    const { elevation: baseElev } = this._presetAngles(cameraPreset);
    const elevation = overrideElev !== null ? overrideElev : baseElev;
    const elevRad = elevation * Math.PI / 180;
    const aspect = w / h;

    this.model.updateMatrixWorld(true);
    const _box = new THREE.Box3().setFromObject(this.model);
    // Expand bounds to include current bone world positions for posed/animated models
    if (this.bones && this.bones.length > 0) {
      const _bonePos = new THREE.Vector3();
      this.bones.forEach(bone => {
        bone.getWorldPosition(_bonePos);
        _box.expandByPoint(_bonePos);
      });
    }
    const _sphere = new THREE.Sphere();
    _box.getBoundingSphere(_sphere);
    const modelCenter = _sphere.center.clone();
    const r = Math.max(_sphere.radius, 0.1);
    // Ensure sphere fits both horizontally and vertically regardless of aspect ratio
    const s = (r * 1.2) / Math.min(1, aspect);
    const renderDist = Math.max(r * 6, 10);
    const offCamera = new THREE.OrthographicCamera(
      -s * aspect, s * aspect, s, -s,
      0.01, renderDist * 2 + r * 2
    );

    this._applyLighting(document.getElementById('lighting-preset').value);

    const savedClearColor = new THREE.Color();
    this.renderer.getClearColor(savedClearColor);
    const savedClearAlpha = this.renderer.getClearAlpha();

    // Reusable 2D canvas for pixel readback
    const capCanvas = document.createElement('canvas');
    capCanvas.width = w; capCanvas.height = h;
    const capCtx = capCanvas.getContext('2d');

    dirAngles.forEach((dirAngle, di) => {
      const baseAzRad = dirAngle * Math.PI / 180;

      for (let fi = 0; fi < framesPerDir; fi++) {
        if (this.mixer && this.animActions.length > 0) {
          const t = (fi / framesPerDir) * this.animActions[0].getClip().duration;
          this.mixer.setTime(t);
        }

        const azRad = baseAzRad;
        offCamera.position.set(
          modelCenter.x + renderDist * Math.cos(elevRad) * Math.sin(azRad),
          modelCenter.y + renderDist * Math.sin(elevRad),
          modelCenter.z + renderDist * Math.cos(elevRad) * Math.cos(azRad)
        );
        offCamera.lookAt(modelCenter);
        offCamera.updateProjectionMatrix();

        if (bgMode === 'transparent') {
          this.renderer.setClearColor(0x000000, 0);
        } else {
          this.renderer.setClearColor(new THREE.Color(bgColor), 1);
        }

        this.renderer.render(this.scene, offCamera);

        // Read pixels via 2D canvas drawImage — works because preserveDrawingBuffer:true
        capCtx.clearRect(0, 0, w, h);
        capCtx.drawImage(this.renderer.domElement, 0, 0, w, h);
        const imageData = capCtx.getImageData(0, 0, w, h);

        this.renderedSprites.push({
          dir: dirAngles[di],
          dirName: (dirNames[dirs] || ['?'])[di] || di,
          frame: fi,
          imageData,
          width: w,
          height: h
        });

        this._addSpriteCard(imageData, w, h, (dirNames[dirs]||['?'])[di]||di, fi, framesPerDir);
      }
    });

    // Restore renderer to preview dimensions and camera state
    this.renderer.setClearColor(savedClearColor, savedClearAlpha);
    this.renderer.setSize(prevW, prevH);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.camera.near = prevNear;
    this.camera.far  = prevFar;
    this.camera.aspect = prevW / prevH;
    this.camera.updateProjectionMatrix();
    if (this.controls) this.controls.update();

    this.importBtn.disabled = false;
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
      // Don't intercept clicks on the TransformControls gizmo handles
      // (.axis is non-null when the pointer is hovering over a handle)
      if (this._transformControls && this._transformControls.axis !== null) return false;
      const bone = this._findNearestBone(pos.x, pos.y);
      if (!bone) {
        // Click in empty space — deselect the current bone and hide gizmo
        this._deselectBone();
        return false;
      }
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
    if (this._transformControls) {
      this._transformControls.detach();
      this._transformControls.visible = false;
    }
    if (this.controls) this.controls.enabled = true;
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

  _deselectBone() {
    if (!this.selectedBone) return;
    this.selectedBone = null;
    document.querySelectorAll('.bone-item').forEach(el => el.classList.remove('active'));
    document.getElementById('selected-bone-panel').style.display = 'none';
    if (this._transformControls) {
      this._transformControls.detach();
      this._transformControls.visible = false;
    }
  }

  _selectBone(bone) {
    this.selectedBone = bone;
    document.querySelectorAll('.bone-item').forEach(el => {
      el.classList.toggle('active', el.dataset.uuid === bone.uuid);
    });
    document.getElementById('selected-bone-name').textContent = bone.name || '(bone)';
    document.getElementById('selected-bone-panel').style.display = 'flex';
    this._updateBoneSliders();
    // Attach rotation gizmo to the selected bone
    if (this._transformControls) {
      this._transformControls.attach(bone);
      this._transformControls.visible = true;
    }
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

    // Model scale slider — rescale model; camera stays put so the size change is visible.
    // User can press ⊡ Frame to re-fit the camera after scaling.
    document.getElementById('model-scale').addEventListener('input', e => {
      const factor = Math.pow(2, +e.target.value);
      document.getElementById('model-scale-val').textContent = factor.toFixed(2) + '×';
      this._applyModelScale(factor);
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

    // Live light direction / intensity controls
    const updateLightDir = () => {
      const azVal = document.getElementById('light-key-az').value;
      const elVal = document.getElementById('light-key-el').value;
      const kiVal = parseFloat(document.getElementById('light-key-int').value);
      const amVal = parseFloat(document.getElementById('light-ambient').value);
      document.getElementById('light-az-val').textContent = azVal + '°';
      document.getElementById('light-el-val').textContent = elVal + '°';
      document.getElementById('light-ki-val').textContent = kiVal.toFixed(1);
      document.getElementById('light-am-val').textContent = amVal.toFixed(1);
      if (this._keyLight) this._keyLight.intensity = kiVal;
      if (this._ambientLight) this._ambientLight.intensity = amVal;
      if (this._fillLight) this._fillLight.intensity = kiVal * 0.8;
      this._updateLightDir();
    };
    ['light-key-az','light-key-el','light-key-int','light-ambient'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateLightDir);
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

    // Gizmo space toggle
    ['local','world'].forEach(space => {
      document.getElementById(`gizmo-space-${space}`).addEventListener('click', () => {
        document.getElementById('gizmo-space-local').classList.toggle('active', space === 'local');
        document.getElementById('gizmo-space-world').classList.toggle('active', space === 'world');
        if (this._transformControls) this._transformControls.setSpace(space);
      });
    });

    // Resize renderer on window resize
    window.addEventListener('resize', () => this._resizeRenderer());
  }
}
