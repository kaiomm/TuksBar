// GIF Frame Parser - Extract frames from animated GIFs
// Full GIF89a specification implementation with LZW decompression

class LZWDecoder {
    constructor(minCodeSize) {
        this.minCodeSize = minCodeSize;
        this.clearCode = 1 << minCodeSize;
        this.eoiCode = this.clearCode + 1;
        this.codeSize = minCodeSize + 1;
        this.codeTable = [];
        this.initCodeTable();
    }

    initCodeTable() {
        this.codeTable = [];
        for (let i = 0; i < this.clearCode; i++) {
            this.codeTable[i] = [i];
        }
        this.codeTable[this.clearCode] = [];
        this.codeTable[this.eoiCode] = null;
        this.nextCode = this.eoiCode + 1;
        this.codeSize = this.minCodeSize + 1;
    }

    decode(data) {
        const output = [];
        let bitBuffer = 0;
        let bitCount = 0;
        let byteIndex = 0;
        let prevCode = null;

        while (byteIndex < data.length) {
            // Fill bit buffer
            while (bitCount < this.codeSize && byteIndex < data.length) {
                bitBuffer |= data[byteIndex++] << bitCount;
                bitCount += 8;
            }

            if (bitCount < this.codeSize) break;

            // Extract code
            const code = bitBuffer & ((1 << this.codeSize) - 1);
            bitBuffer >>= this.codeSize;
            bitCount -= this.codeSize;

            if (code === this.clearCode) {
                this.initCodeTable();
                prevCode = null;
                continue;
            }

            if (code === this.eoiCode) break;

            if (code < this.nextCode) {
                // Code is in table
                const sequence = this.codeTable[code];
                output.push(...sequence);

                if (prevCode !== null) {
                    const prevSequence = this.codeTable[prevCode];
                    this.codeTable[this.nextCode++] = [...prevSequence, sequence[0]];
                }
            } else {
                // Code not in table yet
                const prevSequence = this.codeTable[prevCode];
                const sequence = [...prevSequence, prevSequence[0]];
                output.push(...sequence);
                this.codeTable[this.nextCode++] = sequence;
            }

            prevCode = code;

            // Increase code size if needed
            if (this.nextCode >= (1 << this.codeSize) && this.codeSize < 12) {
                this.codeSize++;
            }
        }

        return new Uint8Array(output);
    }
}

class GifReader {
    constructor(buf) {
        this.data = new Uint8Array(buf);
        this.pos = 0;
    }

    readByte() {
        if (this.pos >= this.data.length) return 0;
        return this.data[this.pos++];
    }

    readBytes(n) {
        const bytes = this.data.slice(this.pos, this.pos + n);
        this.pos += n;
        return bytes;
    }

    readString(n) {
        return String.fromCharCode.apply(null, Array.from(this.readBytes(n)));
    }

    readUInt16() {
        const b1 = this.readByte();
        const b2 = this.readByte();
        return b1 | (b2 << 8);
    }

    parseGIF() {
        // Read header
        const sig = this.readString(3);
        const ver = this.readString(3);
        
        if (sig !== 'GIF') {
            throw new Error('Not a GIF file');
        }

        // Logical screen descriptor
        const width = this.readUInt16();
        const height = this.readUInt16();
        const packed = this.readByte();
        const bgIndex = this.readByte();
        const aspect = this.readByte();

        const gctFlag = (packed & 0x80) !== 0;
        const colorRes = ((packed & 0x70) >> 4) + 1;
        const gctSize = 2 << (packed & 0x07);

        let globalColorTable = null;
        if (gctFlag) {
            globalColorTable = Array.from(this.readBytes(gctSize * 3));
        }

        const frames = [];
        let transparentIndex = -1;
        let delayTime = 100;
        let disposalMethod = 0;

        while (this.pos < this.data.length) {
            const blockType = this.readByte();

            if (blockType === 0x21) { // Extension
                const label = this.readByte();
                
                if (label === 0xF9) { // Graphic Control Extension
                    const blockSize = this.readByte();
                    const packed = this.readByte();
                    delayTime = this.readUInt16() * 10; // Convert to ms
                    transparentIndex = this.readByte();
                    this.readByte(); // Block terminator
                    disposalMethod = (packed & 0x1C) >> 2;
                    const transparentFlag = (packed & 0x01) !== 0;
                    if (!transparentFlag) transparentIndex = -1;
                } else {
                    this.skipSubBlocks();
                }
            } else if (blockType === 0x2C) { // Image descriptor
                const left = this.readUInt16();
                const top = this.readUInt16();
                const frameWidth = this.readUInt16();
                const frameHeight = this.readUInt16();
                const packed = this.readByte();

                const lctFlag = (packed & 0x80) !== 0;
                const interlaced = (packed & 0x40) !== 0;
                const lctSize = lctFlag ? (2 << (packed & 0x07)) : 0;

                let colorTable = globalColorTable;
                if (lctFlag) {
                    colorTable = Array.from(this.readBytes(lctSize * 3));
                }

                // LZW minimum code size
                const codeSize = this.readByte();
                const compressedData = this.readSubBlocks();

                // Decompress LZW data
                const decoder = new LZWDecoder(codeSize);
                const indices = decoder.decode(compressedData);

                frames.push({
                    left, top,
                    width: frameWidth,
                    height: frameHeight,
                    colorTable: colorTable || globalColorTable,
                    transparentIndex,
                    delayTime,
                    disposalMethod,
                    indices,
                    interlaced
                });

                transparentIndex = -1;
                delayTime = 100;
            } else if (blockType === 0x3B) { // Trailer
                break;
            } else if (blockType === 0x00) {
                continue;
            } else {
                break;
            }
        }

        return {
            width,
            height,
            globalColorTable,
            bgIndex,
            frames
        };
    }

    skipSubBlocks() {
        let blockSize = this.readByte();
        while (blockSize !== 0) {
            this.pos += blockSize;
            blockSize = this.readByte();
        }
    }

    readSubBlocks() {
        const data = [];
        let blockSize = this.readByte();
        while (blockSize !== 0) {
            data.push(...Array.from(this.readBytes(blockSize)));
            blockSize = this.readByte();
        }
        return new Uint8Array(data);
    }
}

// Convert GIF frame indices to RGBA ImageData
function frameToImageData(frame, canvasWidth, canvasHeight) {
    const imageData = new ImageData(canvasWidth, canvasHeight);
    const pixels = imageData.data;
    const colorTable = frame.colorTable;

    for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
            const srcIdx = y * frame.width + x;
            const colorIdx = frame.indices[srcIdx];
            
            const destX = frame.left + x;
            const destY = frame.top + y;
            const destIdx = (destY * canvasWidth + destX) * 4;

            if (colorIdx === frame.transparentIndex) {
                pixels[destIdx + 3] = 0; // Transparent
            } else {
                pixels[destIdx] = colorTable[colorIdx * 3];
                pixels[destIdx + 1] = colorTable[colorIdx * 3 + 1];
                pixels[destIdx + 2] = colorTable[colorIdx * 3 + 2];
                pixels[destIdx + 3] = 255;
            }
        }
    }

    return imageData;
}

// Parse GIF from ArrayBuffer or DataURL
async function parseGIF(source) {
    let arrayBuffer;
    
    if (typeof source === 'string') {
        if (source.startsWith('data:')) {
            const base64 = source.split(',')[1];
            const binary = atob(base64);
            arrayBuffer = new ArrayBuffer(binary.length);
            const view = new Uint8Array(arrayBuffer);
            for (let i = 0; i < binary.length; i++) {
                view[i] = binary.charCodeAt(i);
            }
        } else {
            const response = await fetch(source);
            arrayBuffer = await response.arrayBuffer();
        }
    } else {
        arrayBuffer = source;
    }

    const reader = new GifReader(arrayBuffer);
    return reader.parseGIF();
}

window.parseGIF = parseGIF;
window.GifReader = GifReader;
window.frameToImageData = frameToImageData;
