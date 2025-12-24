// GIF Frame Extractor and Transformer
// Extracts frames from GIF, applies canvas transformations, and re-encodes

// Process animated GIF with transformations frame-by-frame
async function processAnimatedGif(gifDataUrl, imageState, canvasSize) {
    try {
        // Parse the GIF to extract all frames
        const gifData = await parseGIF(gifDataUrl);
        
        if (!gifData.frames || gifData.frames.length === 0) {
            throw new Error('No frames found in GIF');
        }

        // Create GIF encoder
        const gif = new GIF({
            workers: 2,
            quality: 10,
            width: canvasSize,
            height: canvasSize,
            repeat: 0, // Loop forever
            transparent: 0x000000
        });

        // Create a temporary canvas to render original frames
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = gifData.width;
        tempCanvas.height = gifData.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Create output canvas with transformations
        const outCanvas = document.createElement('canvas');
        outCanvas.width = canvasSize;
        outCanvas.height = canvasSize;
        const outCtx = outCanvas.getContext('2d');

        // Track previous frame for disposal
        let prevImageData = null;

        // Process each frame
        for (let i = 0; i < gifData.frames.length; i++) {
            const frame = gifData.frames[i];

            // Handle disposal method
            if (prevImageData && frame.disposalMethod === 2) {
                // Restore to background
                tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
            } else if (frame.disposalMethod === 3 && prevImageData) {
                // Restore to previous
                tempCtx.putImageData(prevImageData, 0, 0);
            }
            // Disposal method 0 or 1: do nothing or keep

            // Store current state before drawing new frame
            if (frame.disposalMethod === 3) {
                prevImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            }

            // Draw this frame onto temp canvas
            const frameImageData = frameToImageData(frame, gifData.width, gifData.height);
            tempCtx.putImageData(frameImageData, 0, 0);

            // Clear output canvas
            outCtx.clearRect(0, 0, canvasSize, canvasSize);

            // Apply transformations and draw to output canvas
            outCtx.save();
            outCtx.translate(canvasSize / 2, canvasSize / 2);
            outCtx.translate(imageState.x, imageState.y);
            outCtx.rotate(imageState.rotation);
            outCtx.scale(imageState.scale, imageState.scale);
            outCtx.drawImage(tempCanvas, -tempCanvas.width / 2, -tempCanvas.height / 2);
            outCtx.restore();

            // Add frame to output GIF
            gif.addFrame(outCtx, {
                delay: frame.delayTime || 100,
                copy: true
            });
        }

        // Render the GIF
        return new Promise((resolve) => {
            gif.on('finished', function(blob) {
                const reader = new FileReader();
                reader.onload = () => {
                    resolve(reader.result);
                };
                reader.readAsDataURL(blob);
            });

            gif.render();
        });

    } catch (error) {
        console.error('Error processing animated GIF:', error);
        
        // Fallback: create single-frame version with transformations
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = canvasSize;
                canvas.height = canvasSize;
                const ctx = canvas.getContext('2d');

                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.translate(imageState.x, imageState.y);
                ctx.rotate(imageState.rotation);
                ctx.scale(imageState.scale, imageState.scale);
                ctx.drawImage(img, -img.width / 2, -img.height / 2);
                ctx.restore();

                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => resolve(gifDataUrl);
            img.src = gifDataUrl;
        });
    }
}

// Process GIF with transformations
async function processGifWithTransforms(gifDataUrl, imageState, canvasSize) {
    return processAnimatedGif(gifDataUrl, imageState, canvasSize);
}
