const db = new Dexie("BarDatabase");
db.version(2).stores({
    drinks: '++id, name, rating',
    ingredients: '++id, name'
});

// Separate database to store images only
const imageDb = new Dexie("BarImageDatabase");
imageDb.version(1).stores({
    images: '++id, entityType, entityId'
});

const isDataUrl = (value) => typeof value === 'string' && value.startsWith('data:');

// Get the base path for assets (works on both localhost and GitHub Pages)
const getAssetPath = (assetPath) => {
    const basePath = window.location.pathname.includes('/TuksBar/') ? '/TuksBar' : '';
    return basePath + assetPath;
};

// Media helpers
const isVideoSrc = (src) => {
    if (typeof src !== 'string') return false;
    const lower = src.toLowerCase();
    return lower.startsWith('data:video') || /\.(mp4|mov|webm|ogg)(\?|$)/i.test(lower);
};

const renderMediaElement = (src, className = 'media-el', opts = {}) => {
    const { withControls = false, muted = true, loop = true, autoplay = false } = opts;
    const safeSrc = src || getAssetPath('/asset/camera-512.png');
    if (isVideoSrc(safeSrc)) {
        const controlsAttr = withControls ? ' controls' : '';
        const loopAttr = loop ? ' loop' : '';
        const mutedAttr = muted ? ' muted playsinline' : ' playsinline';
        const autoplayAttr = autoplay ? ' autoplay' : '';
        return `<video src="${safeSrc}" class="${className}"${controlsAttr}${loopAttr}${mutedAttr}${autoplayAttr} preload="metadata"></video>`;
    }
    const fallbackPath = getAssetPath('/asset/camera-512.png');
    return `<img src="${safeSrc}" class="${className}" onerror="this.src='${fallbackPath}'">`;
};

function setMediaPreview(containerId, src, withControls = false, autoplay = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const mediaSrc = src || getAssetPath('/asset/camera-512.png');
    container.dataset.mediaSrc = mediaSrc;
    container.innerHTML = renderMediaElement(mediaSrc, 'media-el', { withControls, muted: true, loop: true, autoplay });
}

async function persistImage(dataUrl, currentImageId, entityType, entityId) {
    if (!isDataUrl(dataUrl)) return currentImageId || null;
    const putId = (typeof currentImageId === 'number' && !Number.isNaN(currentImageId)) ? currentImageId : undefined;
    return imageDb.images.put({ id: putId, entityType, entityId, data: dataUrl });
}

async function loadImageData(imageId, fallback = '') {
    if (!imageId) return fallback || '';
    const record = await imageDb.images.get(imageId);
    return record?.data || fallback || '';
}

async function bulkLoadImages(ids = []) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return {};
    const records = await imageDb.images.bulkGet(uniqueIds);
    const map = {};
    uniqueIds.forEach((id, idx) => {
        if (records[idx]?.data) map[id] = records[idx].data;
    });
    return map;
}

async function migrateImagesToImageDb() {
    try {
        const drinks = await db.drinks.toArray();
        for (const drink of drinks) {
            if (!drink.imageId && isDataUrl(drink.image)) {
                const imageId = await imageDb.images.put({ entityType: 'drink', entityId: drink.id, data: drink.image });
                await db.drinks.update(drink.id, { imageId, image: null });
            }
        }

        const ingredients = await db.ingredients.toArray();
        for (const ing of ingredients) {
            if (!ing.imageId && isDataUrl(ing.image)) {
                const imageId = await imageDb.images.put({ entityType: 'ingredient', entityId: ing.id, data: ing.image });
                await db.ingredients.update(ing.id, { imageId, image: null });
            }
        }
    } catch (err) {
        console.warn('Image migration skipped:', err);
    }
}

const content = document.getElementById('app-content');
const title = document.getElementById('view-title');
const actionBtn = document.getElementById('main-action-btn');

let currentSort = 'date';
let searchQuery = '';
let isPickingForDrink = false;
let drinkDraft = { id: undefined, name: '', rating: 0, image: '', imageId: null, ingredients: [] };

// Migrate any legacy inline images into the dedicated image database
migrateImagesToImageDb();

// --- NAVIGATION & SIDEBAR ---
function toggleMenu() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('show');
}

const router = {
    currentView: 'drinks',
    async navigate(view, id = null, clearSearch = true) {
        content.innerHTML = '';
        if (document.getElementById('sidebar').classList.contains('open')) toggleMenu();
        
        // Track current view for highlighting bottom nav
        this.currentView = view;
        this.updateBottomNav();
        
        if (view === 'drinks' || view === 'ingredients') isPickingForDrink = false;

        if ((view === 'drinks' || view === 'ingredients') && clearSearch) {
            searchQuery = '';
        }

        if (view === 'drinks') renderDrinks();
        else if (view === 'ingredients') renderIngredients();
        else if (view === 'drink-detail') renderDrinkDetail(id);
        else if (view === 'drink-edit') renderDrinkEdit(id);
        else if (view === 'ingredient-edit') renderIngredientEdit(id);
        else if (view === 'ingredient-picker') renderIngredientPicker();
    },
    updateBottomNav() {
        const navButtons = document.querySelectorAll('.bottom-nav button');
        navButtons.forEach((btn, idx) => {
            const isDrinksTab = idx === 0;
            // ingredient-edit and ingredient-picker are part of drinks tab when in drink workflow
            const isActive = (isDrinksTab && (this.currentView === 'drinks' || this.currentView === 'drink-detail' || this.currentView === 'drink-edit' || this.currentView === 'ingredient-picker' || (this.currentView === 'ingredient-edit' && isPickingForDrink))) ||
                           (!isDrinksTab && (this.currentView === 'ingredients' || (this.currentView === 'ingredient-edit' && !isPickingForDrink)));
            btn.classList.toggle('active', isActive);
        });
    }
};

function setContentHasSearch(hasSearch) {
    const container = document.getElementById('app-content');
    if (!container) return;
    container.classList.toggle('with-search', !!hasSearch);
}

// --- DRINKS LIST (SMOOTH FILTERING) ---
async function renderDrinks() {
    setContentHasSearch(true);
    title.innerText = "Drinks";
    actionBtn.innerText = "+";
    actionBtn.onclick = () => {
        drinkDraft = { id: undefined, name: '', rating: 0, image: '', imageId: null, ingredients: [] };
        router.navigate('drink-edit');
    };

    // 1. Static Search Header (Only render if it doesn't exist)
    content.innerHTML = `
        <div class="search-container">
            <input type="text" id="main-search" placeholder="Buscar drinks ou ingredientes..." 
                   value="${searchQuery}" oninput="updateSearch(this.value)">
            <div style="display:flex; gap:15px; font-size:0.75rem; margin-top:8px; color:var(--text-dim)">
                <span>ORGANIZAR POR:</span>
                <span class="sort-btn" data-sort="date" onclick="currentSort='date'; refreshDrinkList()" style="cursor:pointer; color:${currentSort==='date'?'var(--primary)':'white'}">DATA</span>
                <span class="sort-btn" data-sort="name" onclick="currentSort='name'; refreshDrinkList()" style="cursor:pointer; color:${currentSort==='name'?'var(--primary)':'white'}">NOME</span>
                <span class="sort-btn" data-sort="rating" onclick="currentSort='rating'; refreshDrinkList()" style="cursor:pointer; color:${currentSort==='rating'?'var(--primary)':'white'}">AVALIAÇÃO</span>
            </div>
        </div>
        <div id="list-container"></div>
    `;

    // Initial load of the list
    refreshDrinkList();

    // Deselect/blur the search bar on mobile to prevent keyboard overlay
    const searchInput = document.getElementById('main-search');
    if (searchQuery) {
        searchInput.blur();
    }
}

// 2. New Helper function to only refresh the list items
async function refreshDrinkList() {
    const container = document.getElementById('list-container');
    if (!container) return;

    // Update sort button colors
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.style.color = btn.dataset.sort === currentSort ? 'var(--primary)' : 'white';
    });

    let drinks = await db.drinks.toArray();

    // Filtering Logic - Multi-term search
    if (searchQuery) {
        const terms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 0);
        drinks = drinks.filter(d => {
            const drinkName = d.name.toLowerCase();
            const ingredientNames = (d.ingredients || []).map(i => i.name.toLowerCase()).join(' ');
            const fullText = drinkName + ' ' + ingredientNames;
            return terms.every(term => fullText.includes(term));
        });
    }

    // Sorting Logic
    drinks.sort((a,b) => currentSort === 'rating' ? b.rating - a.rating : currentSort === 'date' ? b.id - a.id : a.name.localeCompare(b.name));

    const imageMap = await bulkLoadImages(drinks.map(d => d.imageId).filter(Boolean));

    // Update ONLY the inner list content
    container.innerHTML = drinks.map(drink => {
        const ingText = (drink.ingredients || []).map(i => i.name).join(', ');
        const imgSrc = (drink.imageId && imageMap[drink.imageId]) || drink.image || getAssetPath('/asset/drink-512.png');
        return `
            <div class="list-item" data-drink-id="${drink.id}">
                ${renderMediaElement(imgSrc, 'thumb-media', { withControls: false })}
                <div class="item-info">
                    <h4>${drink.name}</h4>
                    <p>${ingText || 'Sem ingredientes'}</p>
                </div>
                <div style="color:var(--primary); display:flex; align-items:center; gap:5px">
                    ${drink.rating === 6 ? `<img src="${getAssetPath('/asset/tucano-256.png')}" style="width:2rem; height:2rem" title="Tucano!">` : `★ ${drink.rating}`}
                </div>
            </div>
        `;
    }).join('');

    // Attach long-press handlers for drink items
    container.querySelectorAll('.list-item').forEach(el => {
        let timer = null;
        const drinkId = el.dataset.drinkId;
        const start = (e) => { timer = setTimeout(() => router.navigate('drink-edit', Number(drinkId)), 600); };
        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
        el.addEventListener('mousedown', start);
        el.addEventListener('touchstart', start);
        el.addEventListener('mouseup', cancel);
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchcancel', cancel);
        el.addEventListener('touchmove', cancel);
        el.addEventListener('click', () => {
            if (timer === null) router.navigate('drink-detail', Number(drinkId));
        });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); router.navigate('drink-edit', Number(drinkId)); });
    });
}

// 3. Updated Search Handler
function updateSearch(val) {
    searchQuery = val;
    refreshDrinkList(); // Only refreshes the items, not the input box
}

// Image upload modal - shows options to use camera or upload from gallery
function showImageUploadModal(type) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: flex-end;
        z-index: 2000;
    `;
    
    const options = document.createElement('div');
    options.style.cssText = `
        background: var(--surface);
        width: 100%;
        border-radius: 12px 12px 0 0;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;
    
    const cameraBtn = document.createElement('button');
    cameraBtn.innerText = '📷 Usar Câmera';
    cameraBtn.style.cssText = `
        background: var(--primary);
        color: black;
        border: none;
        padding: 14px;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
    `;
    cameraBtn.onclick = () => {
        modal.remove();
        document.getElementById(type === 'drink' ? 'file-input-camera' : 'ing-file-camera').click();
    };
    
    const galleryBtn = document.createElement('button');
    galleryBtn.innerText = '🖼️ Galeria';
    galleryBtn.style.cssText = `
        background: var(--surface-light);
        color: var(--primary);
        border: 1px solid var(--primary);
        padding: 14px;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
    `;
    galleryBtn.onclick = () => {
        modal.remove();
        document.getElementById(type === 'drink' ? 'file-input-gallery' : 'ing-file-gallery').click();
    };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'Cancelar';
    cancelBtn.style.cssText = `
        background: none;
        color: var(--text-dim);
        border: none;
        padding: 14px;
        cursor: pointer;
    `;
    cancelBtn.onclick = () => modal.remove();
    
    options.appendChild(cameraBtn);
    options.appendChild(galleryBtn);
    options.appendChild(cancelBtn);
    modal.appendChild(options);
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    document.body.appendChild(modal);
}

// Check if image is a GIF
function isGifImage(src) {
    // Check for gif extension or data URL with gif type
    if (typeof src === 'string') {
        return src.toLowerCase().includes('.gif') || src.includes('image/gif');
    }
    return false;
}

// Process GIF file to crop all frames
async function processGifCrop(blob, imageState, canvasSize) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // Use gifshot library if available, otherwise return static crop
                const gif = new GIF({
                    workers: 2,
                    quality: 10,
                    width: canvasSize,
                    height: canvasSize,
                    workerScript: 'lib/gif.worker.js'
                });

                // For now, convert GIF to single frame crop (static image)
                // Full animated GIF support would require frame extraction
                const canvas = document.createElement('canvas');
                canvas.width = canvasSize;
                canvas.height = canvasSize;
                const ctx = canvas.getContext('2d');

                const img = new Image();
                img.onload = () => {
                    ctx.save();
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.translate(imageState.x, imageState.y);
                    ctx.rotate(imageState.rotation);
                    ctx.scale(imageState.scale, imageState.scale);
                    ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
                    ctx.restore();
                    
                    canvas.toBlob((blob) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            resolve(reader.result); // Return as data URL
                        };
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                };
                img.src = e.target.result;
            } catch (error) {
                // Fallback: return as is
                resolve(e.target.result);
            }
        };
        reader.readAsDataURL(blob);
    });
}

// Image/Video crop modal with pan, zoom, and rotate functionality
function showImageCropModal(imageSrc, callback, mediaType = 'image') {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: var(--bg-dark);
        z-index: 2000;
        display: flex;
        flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        background: var(--surface);
        padding: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 60px;
        box-sizing: border-box;
    `;
    header.innerHTML = `
        <button onclick="this.closest('.crop-modal').remove()" style="background:none; border:none; color:white; font-size:1rem; cursor:pointer;">Cancelar</button>
        <span style="color:var(--text-main); font-weight:bold;">Ajustar Imagem</span>
        <button id="crop-done-btn" style="background:none; border:none; color:var(--primary); font-size:1rem; cursor:pointer; font-weight:bold;">Concluir</button>
    `;
    modal.classList.add('crop-modal');

    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
        flex: 1;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
    `;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'touch-action: none; max-width: 100%; max-height: 100%;';
    canvasContainer.appendChild(canvas);

    const controls = document.createElement('div');
    controls.style.cssText = `
        background: var(--surface);
        padding: 20px;
        display: flex;
        gap: 15px;
        justify-content: center;
    `;
    controls.innerHTML = `
        <button id="rotate-left-btn" style="background:var(--surface-light); border:none; color:white; padding:12px 20px; border-radius:4px; cursor:pointer;">↶ Girar</button>
        <button id="rotate-right-btn" style="background:var(--surface-light); border:none; color:white; padding:12px 20px; border-radius:4px; cursor:pointer;">↷ Girar</button>
    `;

    modal.appendChild(header);
    modal.appendChild(canvasContainer);
    modal.appendChild(controls);
    document.body.appendChild(modal);

    // Media cropper state
    const isVideo = mediaType === 'video';
    const mediaEl = isVideo ? document.createElement('video') : new Image();
    const ctx = canvas.getContext('2d');
    let imageState = {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        minScale: 1,
        maxScale: 4
    };

    let touchState = {
        lastX: 0,
        lastY: 0,
        lastDist: 0,
        lastAngle: 0,
        isDragging: false
    };

    if (isVideo) {
        mediaEl.muted = true;
        mediaEl.playsInline = true;
        mediaEl.preload = 'auto';
    }

    const getMediaSize = () => {
        if (isVideo) {
            return { w: mediaEl.videoWidth, h: mediaEl.videoHeight };
        }
        return { w: mediaEl.naturalWidth || mediaEl.width, h: mediaEl.naturalHeight || mediaEl.height };
    };

    const initDimensions = () => {
        const { w: naturalWidth, h: naturalHeight } = getMediaSize();
        if (!naturalWidth || !naturalHeight) return;

        // Set canvas size to viewport
        const size = Math.min(window.innerWidth, window.innerHeight - 200);
        canvas.width = size;
        canvas.height = size;

        // Calculate initial scale to fit image inside crop square
        const imgAspect = naturalWidth / naturalHeight;
        if (imgAspect > 1) {
            // Landscape: fit height
            imageState.scale = size / naturalHeight;
        } else {
            // Portrait or square: fit width
            imageState.scale = size / naturalWidth;
        }
        imageState.minScale = imageState.scale;
        
        // Calculate max scale (where image resolution is half screen resolution)
        const maxScaleByResolution = Math.min(naturalWidth, naturalHeight) / (size * 0.5);
        imageState.maxScale = Math.max(maxScaleByResolution, imageState.minScale * 4);

        drawImage();
    };

    function drawImage() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw media
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.translate(imageState.x, imageState.y);
        ctx.rotate(imageState.rotation);
        ctx.scale(imageState.scale, imageState.scale);

        const { w, h } = getMediaSize();
        if (w && h) ctx.drawImage(mediaEl, -w / 2, -h / 2, w, h);
        ctx.restore();

        // Draw semi-transparent overlay outside crop area
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        // Top
        ctx.fillRect(0, 0, canvas.width, 0);
        // Left
        ctx.fillRect(0, 0, 0, canvas.height);
        // Right
        ctx.fillRect(canvas.width, 0, 0, canvas.height);
        // Bottom
        ctx.fillRect(0, canvas.height, canvas.width, 0);
        
        // Use clipping to create overlay only outside crop area
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Draw crop square border (dotted)
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
        ctx.setLineDash([]);
    }

    function getTouchCenter(touches) {
        if (touches.length === 1) {
            return { x: touches[0].clientX, y: touches[0].clientY };
        }
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function getTouchDistance(touches) {
        if (touches.length < 2) return 0;
        const dx = touches[1].clientX - touches[0].clientX;
        const dy = touches[1].clientY - touches[0].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchAngle(touches) {
        if (touches.length < 2) return 0;
        return Math.atan2(
            touches[1].clientY - touches[0].clientY,
            touches[1].clientX - touches[0].clientX
        );
    }

    // Touch event handlers
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touches = e.touches;
        const center = getTouchCenter(touches);
        touchState.lastX = center.x;
        touchState.lastY = center.y;
        touchState.isDragging = true;

        if (touches.length === 2) {
            touchState.lastDist = getTouchDistance(touches);
            touchState.lastAngle = getTouchAngle(touches);
        }
    });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!touchState.isDragging) return;

        const touches = e.touches;
        const center = getTouchCenter(touches);

        // Pan
        const dx = center.x - touchState.lastX;
        const dy = center.y - touchState.lastY;
        imageState.x += dx;
        imageState.y += dy;
        touchState.lastX = center.x;
        touchState.lastY = center.y;

        // Pinch zoom and rotate (two fingers)
        if (touches.length === 2) {
            const dist = getTouchDistance(touches);
            const angle = getTouchAngle(touches);

            if (touchState.lastDist > 0) {
                const scaleDelta = dist / touchState.lastDist;
                imageState.scale = Math.max(
                    imageState.minScale,
                    Math.min(imageState.maxScale, imageState.scale * scaleDelta)
                );
            }

            if (touchState.lastAngle !== 0) {
                imageState.rotation += angle - touchState.lastAngle;
            }

            touchState.lastDist = dist;
            touchState.lastAngle = angle;
        }

        drawImage();
    });

    function snapToEdges() {
        const snapThreshold = 30; // pixels - tightened from 30
        const rotationThreshold = (5 * Math.PI) / 180; // 3 degrees in radians - tightened from 5

        // Calculate image bounds and corners with CURRENT rotation
        const { w: baseW, h: baseH } = getMediaSize();
        if (!baseW || !baseH) return;
        const scaledWidth = baseW * imageState.scale;
        const scaledHeight = baseH * imageState.scale;
        const cos = Math.cos(imageState.rotation);
        const sin = Math.sin(imageState.rotation);

        const half = canvas.width / 2;
        const centerX = half + imageState.x;
        const centerY = half + imageState.y;

        // Calculate the four corners of the rotated image in local space
        const corners = [
            { x: -scaledWidth / 2, y: -scaledHeight / 2 }, // corner 0
            { x: scaledWidth / 2, y: -scaledHeight / 2 },  // corner 1
            { x: scaledWidth / 2, y: scaledHeight / 2 },   // corner 2
            { x: -scaledWidth / 2, y: scaledHeight / 2 }   // corner 3
        ];

        // Rotate and translate corners to world space
        const rotatedCorners = corners.map(corner => ({
            x: centerX + corner.x * cos - corner.y * sin,
            y: centerY + corner.x * sin + corner.y * cos
        }));

        // Calculate the four edge midpoints
        const edges = [
            { mid: { x: (rotatedCorners[0].x + rotatedCorners[1].x) / 2, y: (rotatedCorners[0].y + rotatedCorners[1].y) / 2 }, corners: [0, 1] },
            { mid: { x: (rotatedCorners[1].x + rotatedCorners[2].x) / 2, y: (rotatedCorners[1].y + rotatedCorners[2].y) / 2 }, corners: [1, 2] },
            { mid: { x: (rotatedCorners[2].x + rotatedCorners[3].x) / 2, y: (rotatedCorners[2].y + rotatedCorners[3].y) / 2 }, corners: [2, 3] },
            { mid: { x: (rotatedCorners[3].x + rotatedCorners[0].x) / 2, y: (rotatedCorners[3].y + rotatedCorners[0].y) / 2 }, corners: [3, 0] }
        ];

        // Find edges that are closest to each frame side
        let minYEdge = edges.reduce((min, e) => e.mid.y < min.mid.y ? e : min);
        let maxYEdge = edges.reduce((max, e) => e.mid.y > max.mid.y ? e : max);
        let minXEdge = edges.reduce((min, e) => e.mid.x < min.mid.x ? e : min);
        let maxXEdge = edges.reduce((max, e) => e.mid.x > max.mid.x ? e : max);

        // Check if rotation is close to a cardinal direction (0, 90, 180, 270)
        const rotations = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        let closestRotation = null;

        for (let r of rotations) {
            const angleDiff = Math.abs(imageState.rotation - r);
            // Normalize angle difference to be between 0 and PI
            const normalizedDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
            if (normalizedDiff < rotationThreshold) {
                closestRotation = r;
                break;
            }
        }

        // Exit early if rotation won't snap
        if (closestRotation === null) {
            return;
        }

        // Check if any edge would be within threshold AFTER rotation snapping
        // Simulate the snapped rotation to check edge positions
        const snapCos = Math.cos(closestRotation);
        const snapSin = Math.sin(closestRotation);
        const snapRotatedCorners = corners.map(corner => ({
            x: centerX + corner.x * snapCos - corner.y * snapSin,
            y: centerY + corner.x * snapSin + corner.y * snapCos
        }));
        
        const snapEdges = [
            { mid: { x: (snapRotatedCorners[0].x + snapRotatedCorners[1].x) / 2, y: (snapRotatedCorners[0].y + snapRotatedCorners[1].y) / 2 } },
            { mid: { x: (snapRotatedCorners[1].x + snapRotatedCorners[2].x) / 2, y: (snapRotatedCorners[1].y + snapRotatedCorners[2].y) / 2 } },
            { mid: { x: (snapRotatedCorners[2].x + snapRotatedCorners[3].x) / 2, y: (snapRotatedCorners[2].y + snapRotatedCorners[3].y) / 2 } },
            { mid: { x: (snapRotatedCorners[3].x + snapRotatedCorners[0].x) / 2, y: (snapRotatedCorners[3].y + snapRotatedCorners[0].y) / 2 } }
        ];
        
        const snapMinYEdge = snapEdges.reduce((min, e) => e.mid.y < min.mid.y ? e : min);
        const snapMaxYEdge = snapEdges.reduce((max, e) => e.mid.y > max.mid.y ? e : max);
        const snapMinXEdge = snapEdges.reduce((min, e) => e.mid.x < min.mid.x ? e : min);
        const snapMaxXEdge = snapEdges.reduce((max, e) => e.mid.x > max.mid.x ? e : max);

        const topDist = Math.abs(snapMinYEdge.mid.y);
        const bottomDist = Math.abs(snapMaxYEdge.mid.y - canvas.height);
        const leftDist = Math.abs(snapMinXEdge.mid.x);
        const rightDist = Math.abs(snapMaxXEdge.mid.x - canvas.width);

        const willSnapTop = topDist <= snapThreshold && topDist <= bottomDist;
        const willSnapBottom = bottomDist <= snapThreshold && bottomDist < topDist;
        const willSnapLeft = leftDist <= snapThreshold && leftDist <= rightDist;
        const willSnapRight = rightDist <= snapThreshold && rightDist < leftDist;

        // Only snap if at least one edge will snap after rotation snapping
        if (!willSnapTop && !willSnapBottom && !willSnapLeft && !willSnapRight) {
            return;
        }

        // SNAP ROTATION: Now we know edges will align, so snap the rotation
        imageState.rotation = closestRotation;
        
        // Use the pre-calculated snapped edge positions
        minYEdge = snapMinYEdge;
        maxYEdge = snapMaxYEdge;
        minXEdge = snapMinXEdge;
        maxXEdge = snapMaxXEdge;

        // Y axis: snap only the closest edge (either top OR bottom, not both)
        if (willSnapTop) {
            const offset = minYEdge.mid.y;
            imageState.y -= offset;
        } else if (willSnapBottom) {
            const offset = maxYEdge.mid.y - canvas.height;
            imageState.y -= offset;
        }

        // X axis: snap only the closest edge (either left OR right, not both)
        if (willSnapLeft) {
            const offset = minXEdge.mid.x;
            imageState.x -= offset;
        } else if (willSnapRight) {
            const offset = maxXEdge.mid.x - canvas.width;
            imageState.x -= offset;
        }
    }

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
            touchState.isDragging = false;
            touchState.lastDist = 0;
            touchState.lastAngle = 0;
            snapToEdges();
            drawImage();
        } else if (e.touches.length === 1) {
            const center = getTouchCenter(e.touches);
            touchState.lastX = center.x;
            touchState.lastY = center.y;
            touchState.lastDist = 0;
            touchState.lastAngle = 0;
        }
    });

    // Mouse events for desktop
    canvas.addEventListener('mousedown', (e) => {
        touchState.isDragging = true;
        touchState.lastX = e.clientX;
        touchState.lastY = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!touchState.isDragging) return;
        const dx = e.clientX - touchState.lastX;
        const dy = e.clientY - touchState.lastY;
        imageState.x += dx;
        imageState.y += dy;
        touchState.lastX = e.clientX;
        touchState.lastY = e.clientY;
        drawImage();
    });

    canvas.addEventListener('mouseup', () => {
        touchState.isDragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        imageState.scale = Math.max(
            imageState.minScale,
            Math.min(imageState.maxScale, imageState.scale * delta)
        );
        drawImage();
    });

    // Rotate buttons
    document.getElementById('rotate-left-btn').onclick = () => {
        imageState.rotation -= Math.PI / 2;
        drawImage();
    };

    document.getElementById('rotate-right-btn').onclick = () => {
        imageState.rotation += Math.PI / 2;
        drawImage();
    };

    // Done button - crop and return
    document.getElementById('crop-done-btn').onclick = async () => {
        const doneBtn = document.getElementById('crop-done-btn');

        // Video pipeline: render frames with transforms to canvas and record to WebM
        if (isVideo) {
            modal.style.opacity = '1';
            doneBtn.textContent = 'Processando vídeo...';
            doneBtn.disabled = true;

            const outCanvas = document.createElement('canvas');
            outCanvas.width = canvas.width;
            outCanvas.height = canvas.height;
            const outCtx = outCanvas.getContext('2d');

            const stream = outCanvas.captureStream();
            // Remove audio tracks to ensure silent video output
            const videoOnlyStream = new MediaStream(stream.getVideoTracks());
            let aborted = false;
            const recorder = new MediaRecorder(videoOnlyStream, { mimeType: 'video/webm' });
            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = () => {
                if (aborted) return;
                const blob = new Blob(chunks, { type: 'video/webm' });
                const reader = new FileReader();
                reader.onload = () => {
                    callback(reader.result);
                    modal.remove();
                };
                reader.readAsDataURL(blob);
            };

            const finalize = () => {
                try { recorder.stop(); } catch (e) { console.warn('Recorder stop failed', e); }
                mediaEl.pause();
            };

            const renderFrame = () => {
                outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);

                outCtx.save();
                outCtx.translate(outCanvas.width / 2, outCanvas.height / 2);
                outCtx.translate(imageState.x, imageState.y);
                outCtx.rotate(imageState.rotation);
                outCtx.scale(imageState.scale, imageState.scale);
                const { w, h } = getMediaSize();
                if (w && h) outCtx.drawImage(mediaEl, -w / 2, -h / 2, w, h);
                outCtx.restore();

                if (!mediaEl.paused && !mediaEl.ended) {
                    requestAnimationFrame(renderFrame);
                }
            };

            mediaEl.currentTime = 0;
            recorder.start();
            mediaEl.onended = finalize;
            mediaEl.play().then(() => {
                renderFrame();
            }).catch((err) => {
                console.error('Video play error', err);
                alert('Erro ao processar vídeo.');
                modal.style.opacity = '1';
                doneBtn.textContent = 'Concluir';
                doneBtn.disabled = false;
                aborted = true;
                mediaEl.pause();
                try { recorder.stop(); } catch (stopErr) { console.warn('Recorder stop failed', stopErr); }
            });
            return;
        }

        // GIF pipeline
        if (isGifImage(imageSrc)) {
            modal.style.opacity = '0.5';
            doneBtn.textContent = 'Processando...';
            doneBtn.disabled = true;
            
            try {
                const transformedGif = await processGifWithTransforms(imageSrc, imageState, canvas.width);
                callback(transformedGif);
                modal.remove();
            } catch (error) {
                console.error('GIF processing error:', error);
                alert('Erro ao processar GIF. Tente novamente.');
                modal.style.opacity = '1';
                doneBtn.textContent = 'Concluir';
                doneBtn.disabled = false;
            }
            return;
        }

        // Static images
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = canvas.width;
        croppedCanvas.height = canvas.height;
        const croppedCtx = croppedCanvas.getContext('2d');

        croppedCtx.save();
        croppedCtx.translate(croppedCanvas.width / 2, croppedCanvas.height / 2);
        croppedCtx.translate(imageState.x, imageState.y);
        croppedCtx.rotate(imageState.rotation);
        croppedCtx.scale(imageState.scale, imageState.scale);
        const { w, h } = getMediaSize();
        if (w && h) croppedCtx.drawImage(mediaEl, -w / 2, -h / 2, w, h);
        croppedCtx.restore();

        const croppedImage = croppedCanvas.toDataURL('image/jpeg', 0.9);
        callback(croppedImage);
        modal.remove();
    };

    if (isVideo) {
        mediaEl.onloadedmetadata = () => {
            initDimensions();
            mediaEl.currentTime = 0;
            drawImage();
        };
        mediaEl.addEventListener('timeupdate', drawImage);
        mediaEl.addEventListener('seeked', drawImage);
        mediaEl.addEventListener('loadeddata', drawImage);
        mediaEl.src = imageSrc;
    } else {
        mediaEl.onload = () => initDimensions();
        mediaEl.src = imageSrc;
    }
}

// --- DRINK EDIT & STAR RATING ---
async function renderDrinkEdit(id = null) {
    setContentHasSearch(false);
    if (id && drinkDraft.id !== id) drinkDraft = await db.drinks.get(id);

    drinkDraft.imageId = drinkDraft.imageId || null;
    drinkDraft.image = await loadImageData(drinkDraft.imageId, drinkDraft.image || '');

    title.innerText = id ? "Editar Drink" : "Novo Drink";
    actionBtn.innerText = id ? "🗑️" : "";
    actionBtn.onclick = async () => {
        if(id && confirm("Excluir Drink?")) {
            if (drinkDraft.imageId) await imageDb.images.delete(drinkDraft.imageId);
            await db.drinks.delete(id);
            router.navigate('drinks');
        }
    };

    content.innerHTML = `
        <div style="padding:15px">
            <input type="file" id="file-input-camera" class="hidden" accept="image/*" capture="environment">
            <input type="file" id="file-input-gallery" class="hidden" accept="image/*,video/*">
            <div id="preview" class="media-preview" onclick="showImageUploadModal('drink')"></div>
            <input type="text" id="drink-name" placeholder="Nome do Drink" value="${drinkDraft.name}">
            
            <div class="star-rating" id="stars-container"></div>
            
            <div id="ing-list-edit"></div>
            <button class="btn-outline" onclick="saveDraft(); router.navigate('ingredient-picker')">+ ADICIONAR INGREDIENTE</button>
            <button class="btn-primary" onclick="saveDrink()">SALVAR DRINK</button>
            <button class="btn-outline" style="border:none; color:var(--text-dim)" onclick="router.navigate('drinks')">Cancelar</button>
        </div>
    `;

    updateStars();
    renderDraftIngredients();

    setMediaPreview('preview', drinkDraft.image || getAssetPath('/asset/camera-512.png'), false, true);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const isVideoFile = file.type.startsWith('video');
        const reader = new FileReader();
        reader.onload = () => {
            showImageCropModal(reader.result, (croppedMedia) => {
                drinkDraft.image = croppedMedia;
                setMediaPreview('preview', croppedMedia, false, true);
            }, isVideoFile ? 'video' : 'image');
        };
        reader.readAsDataURL(file);
    };
    document.getElementById('file-input-camera').onchange = handleFileChange;
    document.getElementById('file-input-gallery').onchange = handleFileChange;
}

function updateStars() {
    const container = document.getElementById('stars-container');
    if (drinkDraft.rating === 6) {
        // Secret 6-star rating with toucan only
        container.innerHTML = `
            <img src="${getAssetPath('/asset/tucano-256.png')}" style="width:3rem; height:3rem; cursor:pointer" onclick="handleStarClick(6)" title="Tucano!">
        `;
    } else {
        container.innerHTML = [1,2,3,4,5].map(i => `
            <span class="star ${i <= drinkDraft.rating ? 'active' : ''}" onclick="handleStarClick(${i})">★</span>
        `).join('');
    }
}

function handleStarClick(n) {
    // If clicking 1 star and current rating is 1, set to 0.
    // If clicking 5 stars and current rating is 5, upgrade to secret 6-star toucan rating.
    // Otherwise set to N.
    if (n === 1 && drinkDraft.rating === 1) drinkDraft.rating = 0;
    else if (n === 5 && drinkDraft.rating === 5) drinkDraft.rating = 6;
    else if (n === 6) drinkDraft.rating = 5; // Click toucan to downgrade
    else drinkDraft.rating = n;
    updateStars();
}

function renderDraftIngredients() {
    const container = document.getElementById('ing-list-edit');
    container.innerHTML = drinkDraft.ingredients.map((ing, idx) => `
        <div class="ing-row">
            <span style="flex:2">${ing.name}</span>
            <input type="text" style="flex:1; margin:0" value="${ing.amount}" onchange="drinkDraft.ingredients[${idx}].amount = this.value">
            <button onclick="drinkDraft.ingredients.splice(${idx},1); renderDraftIngredients()" style="background:none; border:none; color:var(--danger)">✕</button>
        </div>
    `).join('');
}

function saveDraft() { drinkDraft.name = document.getElementById('drink-name').value; }

async function saveDrink() {
    saveDraft();
    if(!drinkDraft.name) return alert("Nome do drink é obrigatório!");
    const imageId = await persistImage(drinkDraft.image, drinkDraft.imageId ?? undefined, 'drink', drinkDraft.id);
    drinkDraft.imageId = imageId;

    await db.drinks.put({
        id: drinkDraft.id || undefined,
        name: drinkDraft.name,
        rating: drinkDraft.rating,
        imageId,
        image: null,
        ingredients: drinkDraft.ingredients
    });
    router.navigate('drinks');
}

// --- INGREDIENT LIST & EDIT ---
async function renderIngredients() {
    setContentHasSearch(true);
    title.innerText = "Ingredientes";
    actionBtn.innerText = "+";
    actionBtn.onclick = () => router.navigate('ingredient-edit');

    content.innerHTML = `
        <div class="search-container">
            <input type="text" id="main-search" placeholder="Buscar ingredientes..."
                   value="${searchQuery}" oninput="updateIngredientSearch(this.value)">
            <div style="display:flex; gap:15px; font-size:0.75rem; margin-top:8px; color:var(--text-dim)">
                <span>ORGANIZAR POR:</span>
                <span class="sort-btn" data-sort="date" onclick="currentSort='date'; refreshIngredientList()" style="cursor:pointer; color:${currentSort==='date'?'var(--primary)':'white'}">DATA</span>
                <span class="sort-btn" data-sort="name" onclick="currentSort='name'; refreshIngredientList()" style="cursor:pointer; color:${currentSort==='name'?'var(--primary)':'white'}">NOME</span>
            </div>
        </div>
        <div id="list-container"></div>
    `;

    refreshIngredientList();

    // Restore focus + cursor position
    const searchInput = document.getElementById('main-search');
    if (searchQuery) {
        searchInput.focus();
        searchInput.setSelectionRange(searchQuery.length, searchQuery.length);
    }
}

async function refreshIngredientList() {
    const container = document.getElementById('list-container');
    if (!container) return;

    let ings = await db.ingredients.toArray();

    // Filtering - Multi-term search
    if (searchQuery) {
        const terms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 0);
        ings = ings.filter(i => terms.every(term => i.name.toLowerCase().includes(term)));
    }

    // Sorting Logic
    ings.sort((a, b) => currentSort === 'date' ? b.id - a.id : a.name.localeCompare(b.name));

    const imageMap = await bulkLoadImages(ings.map(i => i.imageId).filter(Boolean));

    // Update sort button colors
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.style.color = btn.dataset.sort === currentSort ? 'var(--primary)' : 'white';
    });

    container.innerHTML = ings.map(ing => {
        const imgSrc = (ing.imageId && imageMap[ing.imageId]) || ing.image || getAssetPath('/asset/bottle-512.png');
        return `
        <div class="list-item" data-ing-id="${ing.id}">
            ${renderMediaElement(imgSrc, 'thumb-media', { withControls: false })}
            <h4>${ing.name}</h4>
        </div>
    `;
    }).join('');

    // Attach long-press (mouse/touch) to open edit on hold (~600ms)
    container.querySelectorAll('.list-item').forEach(el => {
        let timer = null;
        const id = el.dataset.ingId;
        // Start the long-press timer. Do NOT call preventDefault here — it was blocking click events.
        const start = (e) => { timer = setTimeout(() => router.navigate('ingredient-edit', Number(id)), 600); };
        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
        el.addEventListener('mousedown', start);
        el.addEventListener('touchstart', start);
        el.addEventListener('mouseup', cancel);
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchcancel', cancel);
        el.addEventListener('touchmove', cancel); // Cancel long-press on scroll
        el.addEventListener('click', () => {
            if (timer === null) {
                const ingName = el.querySelector('h4').innerText;
                searchQuery = ingName + ' ';
                router.navigate('drinks', null, false);
            }
        });
        // Fallback: right-click/context menu opens edit immediately
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); router.navigate('ingredient-edit', Number(id)); });
    });
}

function updateIngredientSearch(val) {
    searchQuery = val;
    refreshIngredientList();
}

async function renderIngredientEdit(id = null) {
    setContentHasSearch(false);
    const ing = id ? await db.ingredients.get(id) : { name: '', image: '', imageId: null };
    const imageData = await loadImageData(ing.imageId, ing.image || '');
    const previewSrc = imageData || getAssetPath('/asset/camera-512.png');
    title.innerText = id ? "Editar Ingrediente" : "Novo Ingrediente";
    actionBtn.innerText = id ? "🗑️" : "";
    actionBtn.onclick = async () => { if(id && confirm("Excluir Ingrediente?")) { await db.ingredients.delete(id); router.navigate('ingredients'); }};
    
    content.innerHTML = `
        <div style="padding:15px">
            <input type="file" id="ing-file-camera" class="hidden" accept="image/*" capture="environment">
            <input type="file" id="ing-file-gallery" class="hidden" accept="image/*,video/*">
            <div id="ing-prev" class="media-preview" onclick="showImageUploadModal('ingredient')"></div>
            <input type="text" id="ing-name" placeholder="Nome" value="${ing.name}">
            <input type="hidden" id="ing-image-id" value="${ing.imageId || ''}">
            <button class="btn-primary" onclick="saveIng(${id})">SALVAR</button>
            <button class="btn-outline" style="border:none; color:var(--text-dim)" onclick="(isPickingForDrink ? router.navigate('drink-edit', drinkDraft.id) : router.navigate('ingredients'))">CANCELAR</button>
        </div>
    `;

    setMediaPreview('ing-prev', previewSrc, false, true);

    const handleIngFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const isVideoFile = file.type.startsWith('video');
        const reader = new FileReader();
        reader.onload = () => {
            showImageCropModal(reader.result, (croppedMedia) => {
                setMediaPreview('ing-prev', croppedMedia, false, true);
            }, isVideoFile ? 'video' : 'image');
        };
        reader.readAsDataURL(file);
    };
    document.getElementById('ing-file-camera').onchange = handleIngFileChange;
    document.getElementById('ing-file-gallery').onchange = handleIngFileChange;
}

async function saveIng(id) {
    const name = document.getElementById('ing-name').value;
    const imageContainer = document.getElementById('ing-prev');
    const image = imageContainer?.dataset.mediaSrc || getAssetPath('/asset/camera-512.png');
    const rawId = document.getElementById('ing-image-id').value;
    const currentImageId = rawId ? Number(rawId) : undefined;
    const imageId = await persistImage(image, currentImageId, 'ingredient', id);
    document.getElementById('ing-image-id').value = imageId || '';

    const newId = await db.ingredients.put({ id: id || undefined, name, imageId, image: null });
    
    // Propagate ingredient changes to all drinks that use this ingredient
    if (id) {
        const drinks = await db.drinks.toArray();
        for (const drink of drinks) {
            const updatedIngredients = drink.ingredients.map(ing => 
                ing.id === id ? { ...ing, name } : ing
            );
            if (updatedIngredients.some((ing, idx) => ing.name !== drink.ingredients[idx]?.name)) {
                await db.drinks.update(drink.id, { ingredients: updatedIngredients });
            }
        }
    }
    
    if(isPickingForDrink) {
        drinkDraft.ingredients.push({ id: newId, name, amount: '' });
        router.navigate('drink-edit', drinkDraft.id);
    } else router.navigate('ingredients');
}

async function deleteIng(id) {
    if(confirm("Excluir Ingrediente?")) {
        const ing = await db.ingredients.get(id);
        if (ing?.imageId) await imageDb.images.delete(ing.imageId);
        await db.ingredients.delete(id);
        router.navigate('ingredients');
    }
}

// --- PICKER & DETAIL ---
async function renderIngredientPicker() {
    isPickingForDrink = true;
    setContentHasSearch(true);
    title.innerText = "Selecionar Ingrediente";
    actionBtn.innerText = "+";
    actionBtn.onclick = () => router.navigate('ingredient-edit');
    
    content.innerHTML = `
        <div class="search-container">
            <input type="text" id="picker-search" placeholder="Buscar ingredientes..."
                   oninput="searchIng(this.value)">
            <div style="display:flex; gap:15px; font-size:0.75rem; margin-top:8px; color:var(--text-dim)">
                <span>ORGANIZAR POR:</span>
                <span class="sort-btn" data-sort="date" onclick="currentSort='date'; searchIng(document.getElementById('picker-search').value)" style="cursor:pointer; color:${currentSort==='date'?'var(--primary)':'white'}">DATA</span>
                <span class="sort-btn" data-sort="name" onclick="currentSort='name'; searchIng(document.getElementById('picker-search').value)" style="cursor:pointer; color:${currentSort==='name'?'var(--primary)':'white'}">NOME</span>
            </div>
        </div>
        <div id="picker-list"></div>
    `;
    searchIng('');
}

async function searchIng(q) {
    const list = document.getElementById('picker-list');
    list.innerHTML = '';
    const terms = q.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    let ings = await db.ingredients.toArray();
    const filtered = terms.length === 0 ? ings : ings.filter(i => terms.every(term => i.name.toLowerCase().includes(term)));
    
    // Sorting Logic
    filtered.sort((a, b) => currentSort === 'date' ? b.id - a.id : a.name.localeCompare(b.name));

    const imageMap = await bulkLoadImages(filtered.map(i => i.imageId).filter(Boolean));

    // Update sort button colors
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.style.color = btn.dataset.sort === currentSort ? 'var(--primary)' : 'white';
    });
    
    filtered.forEach(ing => {
        const imgSrc = (ing.imageId && imageMap[ing.imageId]) || ing.image || getAssetPath('/asset/bottle-512.png');
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `${renderMediaElement(imgSrc, 'thumb-media', { withControls: false })}<h4>${ing.name}</h4>`;
        div.onclick = () => {
            drinkDraft.ingredients.push({ id: ing.id, name: ing.name, amount: '' });
            router.navigate('drink-edit', drinkDraft.id);
        };
        list.appendChild(div);
    });
}

async function renderDrinkDetail(id) {
    setContentHasSearch(false);
    const d = await db.drinks.get(id);
    const imgSrc = await loadImageData(d.imageId, d.image || getAssetPath('/asset/drink-512.png'));
    title.innerText = d.name;
    actionBtn.innerText = "✎";
    actionBtn.onclick = () => router.navigate('drink-edit', id);
    
    // Build stars display
    let starsHtml;
    if (d.rating === 6) {
        starsHtml = `<img src="${getAssetPath('/asset/tucano-256.png')}" style="width:4rem; height:4rem" title="Tucano!">`;
    } else {
        starsHtml = [1,2,3,4,5].map(i => `<span class="star ${i <= d.rating ? 'active' : ''}">★</span>`).join('');
    }
    
    content.innerHTML = `
        <div class="media-preview">${renderMediaElement(imgSrc, 'media-el', { withControls: false, autoplay: true })}</div>
        <div style="padding:15px">
            <div class="star-rating" style="justify-content:center">
                ${starsHtml}
            </div>
            <h3>Ingredientes</h3>
            ${d.ingredients.map(i => `
                <div class="ing-line">
                    <span class="ing-name">${i.name}</span>
                    <span class="ing-amt">${i.amount || ''}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// --- BACKUP SYSTEMS ---
async function exportDatabase(includeImages = false) {
    const drinks = await db.drinks.toArray();
    const ingredients = await db.ingredients.toArray();
    const payload = { drinks, ingredients };

    if (includeImages) {
        payload.images = await imageDb.images.toArray();
    }

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = includeImages ? 'bar_backup_with_images.json' : 'bar_backup.json';
    a.click();
}

function exportDatabaseWithoutImages() { exportDatabase(false); }
function exportDatabaseWithImages() { exportDatabase(true); }

async function importDatabase(e) {
    const reader = new FileReader();
    reader.onload = async (event) => {
        const data = JSON.parse(event.target.result);
        const drinks = data.drinks || [];
        const ingredients = data.ingredients || [];
        const hasImages = Array.isArray(data.images);

        if (hasImages) {
            await imageDb.images.clear();
            await imageDb.images.bulkPut(data.images);
        } else {
            await imageDb.images.clear();
            drinks.forEach(d => { if (d.imageId) d.imageId = null; });
            ingredients.forEach(i => { if (i.imageId) i.imageId = null; });
        }

        await db.drinks.bulkPut(drinks);
        await db.ingredients.bulkPut(ingredients);
        router.navigate('drinks');
    };
    reader.readAsText(e.target.files[0]);
}

async function checkDatabaseSize() {
    try {
        // Get database size
        const drinks = await db.drinks.toArray();
        const ingredients = await db.ingredients.toArray();
        const images = await imageDb.images.toArray();
        
        // Convert to JSON string to get approximate size
        const drinksJson = JSON.stringify(drinks);
        const ingredientsJson = JSON.stringify(ingredients);
        const imagesJson = JSON.stringify(images);
        const dataDbSize = new Blob([drinksJson + ingredientsJson]).size;
        const imageDbSize = new Blob([imagesJson]).size;
        const totalSize = dataDbSize + imageDbSize;
        
        // Format sizes for display
        const formatSize = (bytes) => {
            const kb = (bytes / 1024).toFixed(2);
            const mb = (bytes / (1024 * 1024)).toFixed(2);
            return bytes > 1024 * 1024 ? `${mb} MB` : `${kb} KB`;
        };
        
        let message = `📊 ARMAZENAMENTO\n\n`;
        message += `Drinks: ${drinks.length} itens\n`;
        message += `Ingredientes: ${ingredients.length} itens\n`;
        message += `Imagens: ${images.length} arquivos\n`;
        message += `Tamanho dados: ${formatSize(dataDbSize)}\n`;
        message += `Tamanho imagens: ${formatSize(imageDbSize)}\n`;
        message += `Total: ${formatSize(totalSize)}\n\n`;
        
        // Check if Storage API is available
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const quota = estimate.quota;
            const usage = estimate.usage;
            const available = quota - usage;
            const remainingAfterDb = available - totalSize;
            
            const usagePercent = ((usage / quota) * 100).toFixed(1);
            const dbPercent = ((totalSize / quota) * 100).toFixed(2);
            
            message += `─────────────────────\n`;
            message += `Quota total: ${formatSize(quota)}\n`;
            message += `Espaço usado: ${formatSize(usage)} (${usagePercent}%)\n`;
            message += `Espaço disponível: ${formatSize(available)}\n`;
            message += `Sobra: ${formatSize(remainingAfterDb)}`;
        } else {
            message += `(Storage API não disponível neste navegador)`;
        }
        
        alert(message);
    } catch (error) {
        alert("Erro ao calcular armazenamento: " + error.message);
    }
}

async function resetDatabase() {
    if(confirm("Limpar tudo?")) { await db.drinks.clear(); await db.ingredients.clear(); router.navigate('drinks'); }
}

// Register service worker to support PWA installability
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => {
        console.log('Service Worker registered');
    }).catch(err => console.warn('Service Worker registration failed', err));
}

// --- PWA Install Button Handling ---
let deferredPrompt = null;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return alert("Instalação não disponível");
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
            installBtn.classList.add('hidden');
            deferredPrompt = null;
        }
    });
}

window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.classList.add('hidden');
    deferredPrompt = null;
});

router.navigate('drinks');