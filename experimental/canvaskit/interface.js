// Adds JS functions to augment the CanvasKit interface.
// For example, if there is a wrapper around the C++ call or logic to allow
// chaining, it should go here.
(function(CanvasKit) {
  // CanvasKit.onRuntimeInitialized is called after the WASM library has loaded.
  // Anything that modifies an exposed class (e.g. SkPath) should be set
  // after onRuntimeInitialized, otherwise, it can happen outside of that scope.
  CanvasKit.onRuntimeInitialized = function() {
    // All calls to 'this' need to go in externs.js so closure doesn't minify them away.


    // Add some helpers for matrices. This is ported from SkMatrix.cpp
    // to save complexity and overhead of going back and forth between
    // C++ and JS layers.
    // I would have liked to use something like DOMMatrix, except it
    // isn't widely supported (would need polyfills) and it doesn't
    // have a mapPoints() function (which could maybe be tacked on here).
    // If DOMMatrix catches on, it would be worth re-considering this usage.
    CanvasKit.SkMatrix = {};
    function sdot(a, b, c, d, e, f) {
      e = e || 0;
      f = f || 0;
      return a * b + c * d + e * f;
    }

    CanvasKit.SkMatrix.identity = function() {
      return [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
      ];
    };

    // Return the inverse (if it exists) of this matrix.
    // Otherwise, return the identity.
    CanvasKit.SkMatrix.invert = function(m) {
      var det = m[0]*m[4]*m[8] + m[1]*m[5]*m[6] + m[2]*m[3]*m[7]
              - m[2]*m[4]*m[6] - m[1]*m[3]*m[8] - m[0]*m[5]*m[7];
      if (!det) {
        SkDebug('Warning, uninvertible matrix');
        return CanvasKit.SkMatrix.identity();
      }
      return [
        (m[4]*m[8] - m[5]*m[7])/det, (m[2]*m[7] - m[1]*m[8])/det, (m[1]*m[5] - m[2]*m[4])/det,
        (m[5]*m[6] - m[3]*m[8])/det, (m[0]*m[8] - m[2]*m[6])/det, (m[2]*m[3] - m[0]*m[5])/det,
        (m[3]*m[7] - m[4]*m[6])/det, (m[1]*m[6] - m[0]*m[7])/det, (m[0]*m[4] - m[1]*m[3])/det,
      ];
    };

    // Maps the given points according to the passed in matrix.
    // Results are done in place.
    // See SkMatrix.h::mapPoints for the docs on the math.
    CanvasKit.SkMatrix.mapPoints = function(matrix, ptArr) {
      if (ptArr.length % 2) {
        throw 'mapPoints requires an even length arr';
      }
      for (var i = 0; i < ptArr.length; i+=2) {
        var x = ptArr[i], y = ptArr[i+1];
        // Gx+Hy+I
        var denom  = matrix[6]*x + matrix[7]*y + matrix[8];
        // Ax+By+C
        var xTrans = matrix[0]*x + matrix[1]*y + matrix[2];
        // Dx+Ey+F
        var yTrans = matrix[3]*x + matrix[4]*y + matrix[5];
        ptArr[i]   = xTrans/denom;
        ptArr[i+1] = yTrans/denom;
      }
      return ptArr;
    };

    CanvasKit.SkMatrix.multiply = function(m1, m2) {
      var result = [0,0,0, 0,0,0, 0,0,0];
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          // m1 and m2 are 1D arrays pretending to be 2D arrays
          result[3*r + c] = sdot(m1[3*r + 0], m2[3*0 + c],
                                 m1[3*r + 1], m2[3*1 + c],
                                 m1[3*r + 2], m2[3*2 + c]);
        }
      }
      return result;
    }

    // Return a matrix representing a rotation by n radians.
    // px, py optionally say which point the rotation should be around
    // with the default being (0, 0);
    CanvasKit.SkMatrix.rotated = function(radians, px, py) {
      px = px || 0;
      py = py || 0;
      var sinV = Math.sin(radians);
      var cosV = Math.cos(radians);
      return [
        cosV, -sinV, sdot( sinV, py, 1 - cosV, px),
        sinV,  cosV, sdot(-sinV, px, 1 - cosV, py),
        0,        0,                             1,
      ];
    };

    CanvasKit.SkMatrix.scaled = function(sx, sy, px, py) {
      px = px || 0;
      py = py || 0;
      return [
        sx, 0, px - sx * px,
        0, sy, py - sy * py,
        0,  0,            1,
      ];
    };

    CanvasKit.SkMatrix.skewed = function(kx, ky, px, py) {
      px = px || 0;
      py = py || 0;
      return [
        1, kx, -kx * px,
        ky, 1, -ky * py,
        0,  0,        1,
      ];
    };

    CanvasKit.SkMatrix.translated = function(dx, dy) {
      return [
        1, 0, dx,
        0, 1, dy,
        0, 0,  1,
      ];
    };

    CanvasKit.SkPath.prototype.addArc = function(oval, startAngle, sweepAngle) {
      // see arc() for the HTMLCanvas version
      // note input angles are degrees.
      this._addArc(oval, startAngle, sweepAngle);
      return this;
    };

    CanvasKit.SkPath.prototype.addPath = function() {
      // Takes 1, 2, 7, or 10 required args, where the first arg is always the path.
      // The last arg is optional and chooses between add or extend mode.
      // The options for the remaining args are:
      //   - an array of 6 or 9 parameters (perspective is optional)
      //   - the 9 parameters of a full matrix or
      //     the 6 non-perspective params of a matrix.
      var args = Array.prototype.slice.call(arguments);
      var path = args[0];
      var extend = false;
      if (typeof args[args.length-1] === "boolean") {
        extend = args.pop();
      }
      if (args.length === 1) {
        // Add path, unchanged.  Use identity matrix
        this._addPath(path, 1, 0, 0,
                            0, 1, 0,
                            0, 0, 1,
                            extend);
      } else if (args.length === 2) {
        // User provided the 9 params of a full matrix as an array.
        var a = args[1];
        this._addPath(path, a[0],      a[1],      a[2],
                            a[3],      a[4],      a[5],
                            a[6] || 0, a[7] || 0, a[8] || 1,
                            extend);
      } else if (args.length === 7 || args.length === 10) {
        // User provided the 9 params of a (full) matrix directly.
        // (or just the 6 non perspective ones)
        // These are in the same order as what Skia expects.
        var a = args;
        this._addPath(path, a[1],      a[2],      a[3],
                            a[4],      a[5],      a[6],
                            a[7] || 0, a[8] || 0, a[9] || 1,
                            extend);
      } else {
        SkDebug('addPath expected to take 1, 2, 7, or 10 required args. Got ' + args.length);
        return null;
      }
      return this;
    };

    CanvasKit.SkPath.prototype.addRect = function() {
      // Takes 1, 2, 4 or 5 args
      //  - SkRect
      //  - SkRect, isCCW
      //  - left, top, right, bottom
      //  - left, top, right, bottom, isCCW
      if (arguments.length === 1 || arguments.length === 2) {
        var r = arguments[0];
        var ccw = arguments[1] || false;
        this._addRect(r.fLeft, r.fTop, r.fRight, r.fBottom, ccw);
      } else if (arguments.length === 4 || arguments.length === 5) {
        var a = arguments;
        this._addRect(a[0], a[1], a[2], a[3], a[4] || false);
      } else {
        SkDebug('addRect expected to take 1, 2, 4, or 5 args. Got ' + arguments.length);
        return null;
      }
      return this;
    };

    CanvasKit.SkPath.prototype.arc = function(x, y, radius, startAngle, endAngle, ccw) {
      // emulates the HTMLCanvas behavior.  See addArc() for the SkPath version.
      // Note input angles are radians.
      var bounds = CanvasKit.LTRBRect(x-radius, y-radius, x+radius, y+radius);
      var sweep = radiansToDegrees(endAngle - startAngle) - (360 * !!ccw);
      var temp = new CanvasKit.SkPath();
      temp.addArc(bounds, radiansToDegrees(startAngle), sweep);
      this.addPath(temp, true);
      temp.delete();
      return this;
    };

    CanvasKit.SkPath.prototype.arcTo = function() {
      // takes 4, 5 or 7 args
      // - 5 x1, y1, x2, y2, radius
      // - 4 oval (as Rect), startAngle, sweepAngle, forceMoveTo
      // - 7 x1, y1, x2, y2, startAngle, sweepAngle, forceMoveTo
      var args = arguments;
      if (args.length === 5) {
        this._arcTo(args[0], args[1], args[2], args[3], args[4]);
      } else if (args.length === 4) {
        this._arcTo(args[0], args[1], args[2], args[3]);
      } else if (args.length === 7) {
        this._arcTo(CanvasKit.LTRBRect(args[0], args[1], args[2], args[3]),
                    args[4], args[5], args[6]);
      } else {
        throw 'Invalid args for arcTo. Expected 4, 5, or 7, got '+ args.length;
      }

      return this;
    };

    CanvasKit.SkPath.prototype.close = function() {
      this._close();
      return this;
    };

    CanvasKit.SkPath.prototype.conicTo = function(x1, y1, x2, y2, w) {
      this._conicTo(x1, y1, x2, y2, w);
      return this;
    };

    CanvasKit.SkPath.prototype.cubicTo = function(cp1x, cp1y, cp2x, cp2y, x, y) {
      this._cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
      return this;
    };

    CanvasKit.SkPath.prototype.dash = function(on, off, phase) {
      if (this._dash(on, off, phase)) {
        return this;
      }
      return null;
    };

    CanvasKit.SkPath.prototype.lineTo = function(x, y) {
      this._lineTo(x, y);
      return this;
    };

    CanvasKit.SkPath.prototype.moveTo = function(x, y) {
      this._moveTo(x, y);
      return this;
    };

    CanvasKit.SkPath.prototype.op = function(otherPath, op) {
      if (this._op(otherPath, op)) {
        return this;
      }
      return null;
    };

    CanvasKit.SkPath.prototype.quadTo = function(cpx, cpy, x, y) {
      this._quadTo(cpx, cpy, x, y);
      return this;
    };

    CanvasKit.SkPath.prototype.simplify = function() {
      if (this._simplify()) {
        return this;
      }
      return null;
    };

    CanvasKit.SkPath.prototype.stroke = function(opts) {
      // Fill out any missing values with the default values.
      /**
       * See externs.js for this definition
       * @type {StrokeOpts}
       */
      opts = opts || {};
      opts.width = opts.width || 1;
      opts.miter_limit = opts.miter_limit || 4;
      opts.cap = opts.cap || CanvasKit.StrokeCap.Butt;
      opts.join = opts.join || CanvasKit.StrokeJoin.Miter;
      opts.precision = opts.precision || 1;
      if (this._stroke(opts)) {
        return this;
      }
      return null;
    };

    CanvasKit.SkPath.prototype.transform = function() {
      // Takes 1 or 9 args
      if (arguments.length === 1) {
        // argument 1 should be a 6 or 9 element array.
        var a = arguments[0];
        this._transform(a[0], a[1], a[2],
                        a[3], a[4], a[5],
                        a[6] || 0, a[7] || 0, a[8] || 1);
      } else if (arguments.length === 6 || arguments.length === 9) {
        // these arguments are the 6 or 9 members of the matrix
        var a = arguments;
        this._transform(a[0], a[1], a[2],
                        a[3], a[4], a[5],
                        a[6] || 0, a[7] || 0, a[8] || 1);
      } else {
        throw 'transform expected to take 1 or 9 arguments. Got ' + arguments.length;
      }
      return this;
    };
    // isComplement is optional, defaults to false
    CanvasKit.SkPath.prototype.trim = function(startT, stopT, isComplement) {
      if (this._trim(startT, stopT, !!isComplement)) {
        return this;
      }
      return null;
    };

    // bones should be a 3d array.
    // Each bone is a 3x2 transformation matrix in column major order:
    // | scaleX   skewX transX |
    // |  skewY  scaleY transY |
    // and bones is an array of those matrices.
    // Returns a copy of this (SkVertices) with the bones applied.
    CanvasKit.SkVertices.prototype.applyBones = function(bones) {
      var bPtr = copy3dArray(bones, CanvasKit.HEAPF32);
      var vert = this._applyBones(bPtr, bones.length);
      CanvasKit._free(bPtr);
      return vert;
    }

    CanvasKit.SkImage.prototype.encodeToData = function() {
      if (!arguments.length) {
        return this._encodeToData();
      }

      if (arguments.length === 2) {
        var a = arguments;
        return this._encodeToDataWithFormat(a[0], a[1]);
      }

      throw 'encodeToData expected to take 0 or 2 arguments. Got ' + arguments.length;
    }

    // returns Uint8Array
    CanvasKit.SkCanvas.prototype.readPixels = function(x, y, w, h, alphaType,
                                                       colorType, dstRowBytes) {
      // supply defaults (which are compatible with HTMLCanvas's getImageData)
      alphaType = alphaType || CanvasKit.AlphaType.Unpremul;
      colorType = colorType || CanvasKit.ColorType.RGBA_8888;
      dstRowBytes = dstRowBytes || (4 * w);

      var len = h * dstRowBytes
      var pptr = CanvasKit._malloc(len);
      var ok = this._readPixels({
        'width': w,
        'height': h,
        'colorType': colorType,
        'alphaType': alphaType,
      }, pptr, dstRowBytes, x, y);
      if (!ok) {
        CanvasKit._free(pptr);
        return null;
      }

      // The first typed array is just a view into memory. Because we will
      // be free-ing that, we call slice to make a persistent copy.
      var pixels = new Uint8Array(CanvasKit.HEAPU8.buffer, pptr, len).slice();
      CanvasKit._free(pptr);
      return pixels;
    }

    // pixels is a TypedArray. No matter the input size, it will be treated as
    // a Uint8Array (essentially, a byte array).
    CanvasKit.SkCanvas.prototype.writePixels = function(pixels, srcWidth, srcHeight,
                                                        destX, destY, alphaType, colorType) {
      if (pixels.byteLength % (srcWidth * srcHeight)) {
        throw 'pixels length must be a multiple of the srcWidth * srcHeight';
      }
      var bytesPerPixel = pixels.byteLength / (srcWidth * srcHeight);
      // supply defaults (which are compatible with HTMLCanvas's putImageData)
      alphaType = alphaType || CanvasKit.AlphaType.Unpremul;
      colorType = colorType || CanvasKit.ColorType.RGBA_8888;
      var srcRowBytes = bytesPerPixel * srcWidth;

      var pptr = CanvasKit._malloc(pixels.byteLength);
      CanvasKit.HEAPU8.set(pixels, pptr);

      var ok = this._writePixels({
        'width': srcWidth,
        'height': srcHeight,
        'colorType': colorType,
        'alphaType': alphaType,
      }, pptr, srcRowBytes, destX, destY);

      CanvasKit._free(pptr);
      return ok;
    }

    // fontData should be an arrayBuffer
    CanvasKit.SkFontMgr.prototype.MakeTypefaceFromData = function(fontData) {
      var data = new Uint8Array(fontData);

      var fptr = CanvasKit._malloc(data.byteLength);
      CanvasKit.HEAPU8.set(data, fptr);
      var font = this._makeTypefaceFromData(fptr, data.byteLength);
      if (!font) {
        SkDebug('Could not decode font data');
        // We do not need to free the data since the C++ will do that for us
        // when the font is deleted (or fails to decode);
        return null;
      }
      return font;
    }

    // Run through the JS files that are added at compile time.
    if (CanvasKit._extraInitializations) {
      CanvasKit._extraInitializations.forEach(function(init) {
        init();
      });
    }
  } // end CanvasKit.onRuntimeInitialized, that is, anything changing prototypes or dynamic.

  CanvasKit.LTRBRect = function(l, t, r, b) {
    return {
      fLeft: l,
      fTop: t,
      fRight: r,
      fBottom: b,
    };
  }

  CanvasKit.XYWHRect = function(x, y, w, h) {
    return {
      fLeft: x,
      fTop: y,
      fRight: x+w,
      fBottom: y+h,
    };
  }

  var nullptr = 0; // emscripten doesn't like to take null as uintptr_t

  // arr can be a normal JS array or a TypedArray
  // dest is something like CanvasKit.HEAPF32
  function copy1dArray(arr, dest) {
    if (!arr || !arr.length) {
      return nullptr;
    }
    var ptr = CanvasKit._malloc(arr.length * dest.BYTES_PER_ELEMENT);
    // In c++ terms, the WASM heap is a uint8_t*, a long buffer/array of single
    // byte elements. When we run _malloc, we always get an offset/pointer into
    // that block of memory.
    // CanvasKit exposes some different views to make it easier to work with
    // different types. HEAPF32 for example, exposes it as a float*
    // However, to make the ptr line up, we have to do some pointer arithmetic.
    // Concretely, we need to convert ptr to go from an index into a 1-byte-wide
    // buffer to an index into a 4-byte-wide buffer (in the case of HEAPF32)
    // and thus we divide ptr by 4.
    dest.set(arr, ptr / dest.BYTES_PER_ELEMENT);
    return ptr;
  }

  // arr should be a non-jagged 2d JS array (TypeyArrays can't be nested
  //     inside themselves.)
  // dest is something like CanvasKit.HEAPF32
  function copy2dArray(arr, dest) {
    if (!arr || !arr.length) {
      return nullptr;
    }
    var ptr = CanvasKit._malloc(arr.length * arr[0].length * dest.BYTES_PER_ELEMENT);
    var idx = 0;
    var adjustedPtr = ptr / dest.BYTES_PER_ELEMENT;
    for (var r = 0; r < arr.length; r++) {
      for (var c = 0; c < arr[0].length; c++) {
        dest[adjustedPtr + idx] = arr[r][c];
        idx++;
      }
    }
    return ptr;
  }

  // arr should be a non-jagged 3d JS array (TypeyArrays can't be nested
  //     inside themselves.)
  // dest is something like CanvasKit.HEAPF32
  function copy3dArray(arr, dest) {
    if (!arr || !arr.length || !arr[0].length) {
      return nullptr;
    }
    var ptr = CanvasKit._malloc(arr.length * arr[0].length * arr[0][0].length * dest.BYTES_PER_ELEMENT);
    var idx = 0;
    var adjustedPtr = ptr / dest.BYTES_PER_ELEMENT;
    for (var x = 0; x < arr.length; x++) {
      for (var y = 0; y < arr[0].length; y++) {
        for (var z = 0; z < arr[0][0].length; z++) {
          dest[adjustedPtr + idx] = arr[x][y][z];
          idx++;
        }
      }
    }
    return ptr;
  }

  CanvasKit.MakeSkDashPathEffect = function(intervals, phase) {
    if (!phase) {
      phase = 0;
    }
    if (!intervals.length || intervals.length % 2 === 1) {
      throw 'Intervals array must have even length';
    }
    var ptr = copy1dArray(intervals, CanvasKit.HEAPF32);
    var dpe = CanvasKit._MakeSkDashPathEffect(ptr, intervals.length, phase);
    CanvasKit._free(ptr);
    return dpe;
  }

  // data is a TypedArray or ArrayBuffer e.g. from fetch().then(resp.arrayBuffer())
  CanvasKit.MakeImageFromEncoded = function(data) {
    data = new Uint8Array(data);

    var iptr = CanvasKit._malloc(data.byteLength);
    CanvasKit.HEAPU8.set(data, iptr);
    var img = CanvasKit._decodeImage(iptr, data.byteLength);
    if (!img) {
      SkDebug('Could not decode image');
      CanvasKit._free(iptr);
      return null;
    }
    var realDelete = img.delete.bind(img);
    img.delete = function() {
      CanvasKit._free(iptr);
      realDelete();
    }
    return img;
  }

  // imgData is an Encoded SkImage, e.g. from MakeImageFromEncoded
  CanvasKit.MakeImageShader = function(img, xTileMode, yTileMode, clampUnpremul, localMatrix) {
    if (!img) {
      return null;
    }
    clampUnpremul = clampUnpremul || false;
    if (localMatrix) {
      // Add perspective args if not provided.
      if (localMatrix.length === 6) {
        localMatrix.push(0, 0, 1);
      }
      return CanvasKit._MakeImageShader(img, xTileMode, yTileMode, clampUnpremul, localMatrix);
    } else {
      return CanvasKit._MakeImageShader(img, xTileMode, yTileMode, clampUnpremul);
    }
  }

  // pixels is a Uint8Array
  CanvasKit.MakeImage = function(pixels, width, height, alphaType, colorType) {
    var bytesPerPixel = pixels.byteLength / (width * height);
    var info = {
      'width': width,
      'height': height,
      'alphaType': alphaType,
      'colorType': colorType,
    };
    var pptr = CanvasKit._malloc(pixels.byteLength);
    CanvasKit.HEAPU8.set(pixels, pptr);
    // No need to _free iptr, Image takes it with SkData::MakeFromMalloc

    return CanvasKit._MakeImage(info, pptr, pixels.byteLength, width * bytesPerPixel);
  }

  CanvasKit.MakeLinearGradientShader = function(start, end, colors, pos, mode, localMatrix, flags) {
    var colorPtr = copy1dArray(colors, CanvasKit.HEAP32);
    var posPtr =   copy1dArray(pos,    CanvasKit.HEAPF32);
    flags = flags || 0;

    if (localMatrix) {
      // Add perspective args if not provided.
      if (localMatrix.length === 6) {
        localMatrix.push(0, 0, 1);
      }
      var lgs = CanvasKit._MakeLinearGradientShader(start, end, colorPtr, posPtr,
                                                    colors.length, mode, flags, localMatrix);
    } else {
      var lgs = CanvasKit._MakeLinearGradientShader(start, end, colorPtr, posPtr,
                                                    colors.length, mode, flags);
    }

    CanvasKit._free(colorPtr);
    CanvasKit._free(posPtr);
    return lgs;
  }

  CanvasKit.MakeRadialGradientShader = function(center, radius, colors, pos, mode, localMatrix, flags) {
    var colorPtr = copy1dArray(colors, CanvasKit.HEAP32);
    var posPtr =   copy1dArray(pos,    CanvasKit.HEAPF32);
    flags = flags || 0;

    if (localMatrix) {
      // Add perspective args if not provided.
      if (localMatrix.length === 6) {
        localMatrix.push(0, 0, 1);
      }
      var rgs = CanvasKit._MakeRadialGradientShader(center, radius, colorPtr, posPtr,
                                                    colors.length, mode, flags, localMatrix);
    } else {
      var rgs = CanvasKit._MakeRadialGradientShader(center, radius, colorPtr, posPtr,
                                                    colors.length, mode, flags);
    }

    CanvasKit._free(colorPtr);
    CanvasKit._free(posPtr);
    return rgs;
  }

  CanvasKit.MakeTwoPointConicalGradientShader = function(start, startRadius, end, endRadius,
                                                         colors, pos, mode, localMatrix, flags) {
    var colorPtr = copy1dArray(colors, CanvasKit.HEAP32);
    var posPtr =   copy1dArray(pos,    CanvasKit.HEAPF32);
    flags = flags || 0;

    if (localMatrix) {
      // Add perspective args if not provided.
      if (localMatrix.length === 6) {
        localMatrix.push(0, 0, 1);
      }
      var rgs = CanvasKit._MakeTwoPointConicalGradientShader(
                          start, startRadius, end, endRadius,
                          colorPtr, posPtr, colors.length, mode, flags, localMatrix);
    } else {
      var rgs = CanvasKit._MakeTwoPointConicalGradientShader(
                          start, startRadius, end, endRadius,
                          colorPtr, posPtr, colors.length, mode, flags);
    }

    CanvasKit._free(colorPtr);
    CanvasKit._free(posPtr);
    return rgs;
  }

  CanvasKit.MakeSkVertices = function(mode, positions, textureCoordinates, colors,
                                      boneIndices, boneWeights, indices) {
    var positionPtr = copy2dArray(positions,          CanvasKit.HEAPF32);
    var texPtr =      copy2dArray(textureCoordinates, CanvasKit.HEAPF32);
    // Since we write the colors to memory as signed integers (JSColor), we can
    // read them out on the other side as unsigned ints (SkColor) just fine
    // - it's effectively casting.
    var colorPtr =    copy1dArray(colors,             CanvasKit.HEAP32);

    var boneIdxPtr =  copy2dArray(boneIndices,        CanvasKit.HEAP32);
    var boneWtPtr  =  copy2dArray(boneWeights,        CanvasKit.HEAPF32);
    var idxPtr =      copy1dArray(indices,            CanvasKit.HEAPU16);

    var idxCount = (indices && indices.length) || 0;
    // _MakeVertices will copy all the values in, so we are free to release
    // the memory after.
    var vertices = CanvasKit._MakeSkVertices(mode, positions.length, positionPtr,
                                             texPtr, colorPtr, boneIdxPtr, boneWtPtr,
                                             idxCount, idxPtr);
    positionPtr && CanvasKit._free(positionPtr);
    texPtr && CanvasKit._free(texPtr);
    colorPtr && CanvasKit._free(colorPtr);
    idxPtr && CanvasKit._free(idxPtr);
    boneIdxPtr && CanvasKit._free(boneIdxPtr);
    boneWtPtr && CanvasKit._free(boneWtPtr);
    return vertices;
  }

}(Module)); // When this file is loaded in, the high level object is "Module";

// Intentionally added outside the scope to allow usage in canvas2d.js and other
// pre-js files. These names are unlikely to cause emscripten collisions.
function radiansToDegrees(rad) {
  return (rad / Math.PI) * 180;
}

function degreesToRadians(deg) {
  return (deg / 180) * Math.PI;
}

