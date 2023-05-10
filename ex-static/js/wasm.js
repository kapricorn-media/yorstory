let gl = null;
let _ext = null;
let _memoryPtr = null;
let _canvas = null;

let _lastOuterWidth = null;
let _lastOuterHeight = null;
let _currentHeight = null;
let _loadTextureJobs = [];

function readUint8Array(ptr, len) {
    return new Uint8Array(_wasmInstance.exports.memory.buffer, ptr, len);
}

function createLoadTextureJob(width, height, chunkSize, textureId, pngData, i, loaded) {
    return {
        width: width,
        height: height,
        chunkSize: chunkSize,
        textureId: textureId,
        pngData: pngData,
        i: i,
        loaded: loaded,
    };
}

function queueLoadTextureJob(width, height, chunkSize, textureId, pngData, i, loaded) {
    _loadTextureJobs.push(createLoadTextureJob(width, height, chunkSize, textureId, pngData, i, loaded));
}

function doLoadTextureJob(job) {
    const image = new Image();
    image.onload = function() {
        const chunkSizeRows = Math.round(job.chunkSize / job.width);

        const level = 0;
        const xOffset = 0;
        const yOffset = job.height - chunkSizeRows * job.i - image.height;
        const srcFormat = gl.RGBA;
        const srcType = gl.UNSIGNED_BYTE;

        const texture = _glTextures[job.textureId];
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texSubImage2D(gl.TEXTURE_2D, level, xOffset, yOffset, srcFormat, srcType, image);

        job.loaded[job.i] = true;
        const allLoaded = job.loaded.every(function(el) { return el; });
        if (allLoaded) {
            _wasmInstance.exports.onTextureLoaded(_memoryPtr, job.textureId, job.width, job.height);
        }
    };
    uint8ArrayToImageSrcAsync(job.pngData, function(src) {
        image.src = src;
    });
}

function doNextLoadTextureJob() {
    const job = _loadTextureJobs.shift();
    if (!job) {
        return;
    }
    doLoadTextureJob(job);
}

function clearAllEmbeds()
{
    Array.from(document.getElementsByClassName("_wasmEmbedAll")).forEach(function(el) {
        el.remove();
    });
}

function addYoutubeEmbed(left, top, width, height, youtubeIdPtr, youtubeIdLen)
{
    const youtubeId = readCharStr(youtubeIdPtr, youtubeIdLen);

    const div = document.createElement("div");
    div.classList.add("_wasmEmbedAll");
    div.classList.add("_wasmYoutubeEmbed");
    div.style.left = px(toDevicePx(left));
    div.style.top = px(toDevicePx(top));
    div.style.width = px(toDevicePx(width));
    div.style.height = px(toDevicePx(height));

    const iframe = document.createElement("iframe");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.src = "https://www.youtube.com/embed/" + youtubeId;
    iframe.title = "YouTube video player";
    iframe.frameborder = "0";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;

    div.appendChild(iframe);
    document.getElementById("dummyBackground").appendChild(div);
}

function setCursor(cursorPtr, cursorLen) {
    const cursor = readCharStr(cursorPtr, cursorLen);
    document.body.style.cursor = cursor;
}

function getUri(outUriPtr, outUriLen) {
    return writeCharStr(outUriPtr, outUriLen, window.location.pathname);
}

function setUri(uriPtr, uriLen) {
    const uri = readCharStr(uriPtr, uriLen);
    window.location.href = uri;
}

const _glBuffers = [];
const _glFramebuffers = [];
const _glRenderbuffers = [];
const _glPrograms = [];
const _glShaders = [];
const _glTextures = [];
const _glUniformLocations = [];

function compileShader(sourcePtr, sourceLen, type) {
    const source = readCharStr(sourcePtr, sourceLen);
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw "Error compiling shader:" + gl.getShaderInfoLog(shader);
    }

    _glShaders.push(shader);
    return _glShaders.length - 1;
}

function linkShaderProgram(vertexShaderId, fragmentShaderId) {
    const program = gl.createProgram();
    gl.attachShader(program, _glShaders[vertexShaderId]);
    gl.attachShader(program, _glShaders[fragmentShaderId]);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw ("Error linking program:" + gl.getProgramInfoLog (program));
    }

    _glPrograms.push(program);
    return _glPrograms.length - 1;
}

function createTexture(width, height, wrap, filter) {
    const textureId = env.glCreateTexture();
    const texture = _glTextures[textureId];
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const level = 0;
    const internalFormat = gl.RGBA;
    const border = 0;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    const pixels = new Uint8Array(width * height * 4);
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

    return textureId;
}

function createTextureWithData(width, height, channels, dataPtr, dataLen, wrap, filter) {
    const textureId = env.glCreateTexture();
    const texture = _glTextures[textureId];
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const level = 0;
    let internalFormat = gl.RGBA;
    if (channels === 1) {
        internalFormat = gl.LUMINANCE;
    } else if (channels === 3) {
        internalFormat = gl.RGB;
    } else if (channels !== 4) {
        throw `Unexpected channels=${channels}`;
    }
    const border = 0;
    const srcFormat = internalFormat;
    const srcType = gl.UNSIGNED_BYTE;
    const data = readUint8Array(dataPtr, dataLen);
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

    return textureId;
}

function initBufferIt(buffer)
{
    return {
        index: 0,
        array: new Uint8Array(buffer),
    };
}

function readBigEndianU64(bufferIt)
{
    if (bufferIt.index + 8 > bufferIt.array.length) {
        throw "BE U64 out of bounds";
    }
    let value = 0;
    for (let i = 0; i < 8; i++) {
        value += bufferIt.array[bufferIt.index + i] * (1 << ((7 - i) * 8));
    }
    bufferIt.index += 8;
    return value;
}

function loadTexture(textureId, imgUrlPtr, imgUrlLen, wrap, filter) {
    const imgUrl = readCharStr(imgUrlPtr, imgUrlLen);
    const chunkSizeMax = 512 * 1024;

    const texture = _glTextures[textureId];
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const uri = `/webgl_png?path=${imgUrl}`;
    httpGet(uri, function(status, data) {
        if (status !== 200) {
            console.log(`webgl_png failed with status ${status} for URL ${imgUrl}`);
            _wasmInstance.exports.onTextureLoaded(_memoryPtr, textureId, 0, 0);
            return;
        }

        const it = initBufferIt(data);
        const width = readBigEndianU64(it);
        const height = readBigEndianU64(it);
        const chunkSize = readBigEndianU64(it);
        const numChunks = readBigEndianU64(it);

        if (chunkSize % width !== 0) {
            console.error("chunk size is not a multiple of image width");
            return;
        }

        const level = 0;
        const internalFormat = gl.RGBA;
        const border = 0;
        const srcFormat = gl.RGBA;
        const srcType = gl.UNSIGNED_BYTE;

        const pixels = new Uint8Array(width * height * 4);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, pixels);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

        const loaded = new Array(numChunks).fill(false);
        for (let i = 0; i < numChunks; i++) {
            const chunkLen = readBigEndianU64(it);
            const chunkData = it.array.subarray(it.index, it.index + chunkLen);
            it.index += chunkLen;
            queueLoadTextureJob(width, height, chunkSize, textureId, chunkData, i, loaded);
        }
    });
}

function loadFontDataJs(fontUrlPtr, fontUrlLen, fontSize, scale, atlasSize)
{
    const fontUrl = readCharStr(fontUrlPtr, fontUrlLen);

    const atlasTextureId = env.glCreateTexture();
    const texture = _glTextures[atlasTextureId];
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const level = 0;
    const internalFormat = gl.LUMINANCE;
    const border = 0;
    const srcFormat = internalFormat;
    const srcType = gl.UNSIGNED_BYTE;
    const data = new Uint8Array(atlasSize * atlasSize);
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, atlasSize, atlasSize, border, srcFormat, srcType, data);
    // TODO pass wrap + filter as params?
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    httpGet(fontUrl, function(status, data) {
        if (status !== 200) {
            console.error(`Failed to get font ${fontUrl} status ${status}`);
            return;
        }

        const worker = new Worker("/js/wasm_worker.js");
        worker.postMessage(["/worker.wasm", "loadFontData", atlasSize, data, fontSize, scale]);
        worker.onmessage = function(e) {
            worker.terminate();

            const success = e.data[0];
            if (success !== 1) {
                console.error(`Failed to load font data for ${fontUrl}`);
                return;
            }
            const pixelData = e.data[1];
            const fontData = e.data[2];

            const xOffset = 0;
            const yOffset = 0;
            const pixelData2 = new Uint8Array(pixelData);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texSubImage2D(gl.TEXTURE_2D, level, xOffset, yOffset, atlasSize, atlasSize, srcFormat, srcType, pixelData2);

            callWasmFunction(_wasmInstance.exports.onFontLoaded, [_memoryPtr, atlasTextureId, fontData]);
        };
    });

    return atlasTextureId;
}

function bindNullFramebuffer() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function vertexAttribDivisorANGLE(attrLoc, divisor) {
    _ext.vertexAttribDivisorANGLE(attrLoc, divisor);
}

function drawArraysInstancedANGLE(mode, first, count, primcount) {
    _ext.drawArraysInstancedANGLE(mode, first, count, primcount);
}

const env = {
    // Debug functions
    consoleMessage,

    // Custom
    fillDataBuffer,
    loadFontDataJs,

    // browser / DOM functions
    clearAllEmbeds,
    addYoutubeEmbed,
    setCursor,
    getUri,
    setUri,

    // GL derived functions
    compileShader,
    linkShaderProgram,
    createTexture,
    createTextureWithData,
    loadTexture,
    bindNullFramebuffer,
    vertexAttribDivisorANGLE,
    drawArraysInstancedANGLE,
};

function fillGlFunctions(env)
{
    if (gl === null) {
        console.error("gl is null");
        return;
    }

    for (let k in gl) {
        const type = typeof gl[k];
        if (type === "function") {
            const prefixed = "gl" + k[0].toUpperCase() + k.substring(1);
            env[prefixed] = function() {
                return gl[k].apply(gl, arguments);
            };
        }
    }

    env.glCreateBuffer = function() {
        _glBuffers.push(gl.createBuffer());
        return _glBuffers.length - 1;
    };
    env.glBindBuffer = function(type, id) {
        gl.bindBuffer(type, _glBuffers[id]);
    };
    env.glBufferData3 = function(type, count, drawType) {
        gl.bufferData(type, count, drawType);
    };
    env.glBufferData = function(type, dataPtr, count, drawType) {
        const floats = new Float32Array(_wasmInstance.exports.memory.buffer, dataPtr, count);
        gl.bufferData(type, floats, drawType);
    };
    env.glBufferSubData = function(type, offset, dataPtr, count) {
        const floats = new Float32Array(_wasmInstance.exports.memory.buffer, dataPtr, count);
        gl.bufferSubData(type, offset, floats);
    };

    env.glCreateFramebuffer = function() {
        _glFramebuffers.push(gl.createFramebuffer());
        return _glFramebuffers.length - 1;
    };
    env.glBindFramebuffer = function(type, id) {
        gl.bindFramebuffer(type, _glFramebuffers[id]);
    };
    env.glFramebufferTexture2D = function(type, attachment, textureType, textureId, level) {
        gl.framebufferTexture2D(type, attachment, textureType, _glTextures[textureId], level);
    };
    env.glFramebufferRenderbuffer = function(type, attachment, renderbufferTarget, renderbufferId) {
        gl.framebufferRenderbuffer(type, attachment, renderbufferTarget, _glRenderbuffers[renderbufferId]);
    };

    env.glCreateRenderbuffer = function() {
        _glRenderbuffers.push(gl.createRenderbuffer());
        return _glRenderbuffers.length - 1;
    };
    env.glBindRenderbuffer = function(type, id) {
        gl.bindRenderbuffer(type, _glRenderbuffers[id]);
    };

    env.glCreateTexture = function() {
        _glTextures.push(gl.createTexture());
        return _glTextures.length - 1;
    };
    env.glBindTexture = function(type, id) {
        gl.bindTexture(type, _glTextures[id]);
    };
    env.glDeleteTexture = function(id) {
        gl.deleteTexture(_glTextures[id]);
    };

    env.glUseProgram = function(programId) {
        gl.useProgram(_glPrograms[programId]);
    };
    env.glGetAttribLocation = function(programId, namePtr, nameLen) {
        const name = readCharStr(namePtr, nameLen);
        return  gl.getAttribLocation(_glPrograms[programId], name);
    };
    env.glGetUniformLocation = function(programId, namePtr, nameLen)  {
        const name = readCharStr(namePtr, nameLen);
        const uniformLocation = gl.getUniformLocation(_glPrograms[programId], name);
        _glUniformLocations.push(uniformLocation);
        return _glUniformLocations.length - 1;
    };
    env.glUniform1i = function(locationId, value) {
        gl.uniform1i(_glUniformLocations[locationId], value);
    };
    env.glUniform1fv = function(locationId, x) {
        gl.uniform1fv(_glUniformLocations[locationId], [x]);
    };
    env.glUniform2fv = function(locationId, x, y) {
        gl.uniform2fv(_glUniformLocations[locationId], [x, y]);
    };
    env.glUniform3fv = function(locationId, x, y, z) {
        gl.uniform3fv(_glUniformLocations[locationId], [x, y, z]);
    };
    env.glUniform4fv = function(locationId, x, y, z, w) {
        gl.uniform4fv(_glUniformLocations[locationId], [x, y, z, w]);
    };
}

function getViewSizes()
{
    return {
        outer: {
            width: _canvas.width,
            height: _canvas.height,
        },
        inner: {
            width: toRealPx(window.innerWidth),
            height: toRealPx(window.innerHeight),
        },
    };
}

function updateCanvasSize()
{
    _lastOuterWidth = window.outerWidth;
    _lastOuterHeight = window.outerHeight;

    // Canvas should cover the entire window size to avoid blank spots on mobile address bar
    // resizes, hence the use of "outer" instead of "inner".
    const width = window.outerWidth;
    const height = window.outerHeight;

    _canvas.style.width = px(width);
    _canvas.style.height = px(height);
    _canvas.width = toRealPx(width);
    _canvas.height = toRealPx(height);
    gl.viewport(0, 0, _canvas.width, _canvas.height);
    console.log(`canvas resize: ${_canvas.width} x ${_canvas.height}`);
}

function wasmInit(wasmUri, memoryBytes)
{
    _canvas = document.getElementById("canvas");
    gl = _canvas.getContext("webgl") || _canvas.getContext("experimental-webgl");
    if (!gl) {
        console.error("no webGL support");
        return;
    }
    _ext = gl.getExtension("ANGLE_instanced_arrays");
    if (!_ext) {
        console.error("no webGL instanced arrays support");
        return;
    }
    updateCanvasSize();

    document.addEventListener("mousemove", function(event) {
        if (_wasmInstance !== null) {
            _wasmInstance.exports.onMouseMove(
                _memoryPtr, toRealPx(event.clientX), toRealPx(event.clientY)
            );
        }
    });
    document.addEventListener("mousedown", function(event) {
        if (_wasmInstance !== null) {
            _wasmInstance.exports.onMouseDown(
                _memoryPtr, event.button, toRealPx(event.clientX), toRealPx(event.clientY)
            );
        }
    });
    document.addEventListener("mouseup", function(event) {
        if (_wasmInstance !== null) {
            _wasmInstance.exports.onMouseUp(
                _memoryPtr, event.button, toRealPx(event.clientX), toRealPx(event.clientY)
            );
        }
    });
    document.addEventListener("keydown", function(event) {
        if (_wasmInstance !== null) {
            _wasmInstance.exports.onKeyDown(_memoryPtr, event.keyCode);
        }
    });
    window.addEventListener("deviceorientation", function(event) {
        if (_wasmInstance !== null) {
            _wasmInstance.exports.onDeviceOrientation(_memoryPtr, event.alpha, event.beta, event.gamma);
        }
    });

    addEventListener("resize", function() {
        if (window.outerWidth === _lastOuterWidth && window.outerHeight === _lastOuterHeight) {
            // Avoid resizing canvas if the actual window size hasn't changed.
            // This is mainly to avoid excessive resizing when mobile address bar is hidden.
            return;
        }

        updateCanvasSize();
    });

    let importObject = {
        env: env,
    };
    fillGlFunctions(importObject.env, gl);

    WebAssembly.instantiateStreaming(fetch(wasmUri), importObject).then(function(obj) {
        _wasmInstance = obj.instance;
        _memoryPtr = _wasmInstance.exports.onInit(_canvas.width, _canvas.height);

        const onAnimationFrame = _wasmInstance.exports.onAnimationFrame;
        const dummyBackground = document.getElementById("dummyBackground");

        function step(timestamp) {
            doNextLoadTextureJob(); // TODO make fancier?

            const scrollY = toRealPx(window.scrollY);
            const viewSizes = getViewSizes();
            const totalHeight = onAnimationFrame(
                _memoryPtr,
                viewSizes.outer.width, viewSizes.outer.height,
                viewSizes.inner.width, viewSizes.inner.height,
                scrollY,
                timestamp
            );
            const totalHeightDevice = toDevicePx(totalHeight);
            if (totalHeightDevice !== 0 && _currentHeight !== totalHeightDevice) {
                _currentHeight = totalHeightDevice;
                dummyBackground.style.height = px(totalHeightDevice);
            }
            window.requestAnimationFrame(step);
        }
        window.requestAnimationFrame(step);
    });
}